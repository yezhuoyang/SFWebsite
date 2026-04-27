"""Scan all SF volumes and (re)populate the database with exercise metadata.

By default, this script is **idempotent**: it preserves all user-data
tables (users, progress, daily_activity, discussions, votes, …) and only
upserts the metadata tables (volumes, chapters, exercises).

For a true fresh start (DESTROYS user data), pass `--fresh`.
"""

import argparse
import asyncio
import sys
from pathlib import Path

# Ensure we can import server modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from server.config import VOLUMES, CHAPTER_ORDER, SKIP_CHAPTERS, SKIP_PREFIXES
from server.database import engine, async_session, Base
from server.models import Volume, Chapter, Exercise
from server.services.parser import parse_exercises, parse_test_file


async def seed(fresh: bool = False):
    # 1. Schema: create_all is a no-op for existing tables. drop_all only
    #    runs with --fresh and only after the user has been warned.
    async with engine.begin() as conn:
        if fresh:
            print("!! --fresh: dropping ALL tables (users, progress, etc. will be lost)")
            await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    # 2. Upsert volume / chapter / exercise rows from the .v sources.
    #    We reuse existing rows by their unique key (so primary-key IDs
    #    stay stable and Progress.exercise_id FKs remain valid).
    async with async_session() as session:
        total_exercises = 0

        for vol_id, vol_cfg in VOLUMES.items():
            vol_path = vol_cfg["path"]
            vol_name = vol_cfg["name"]
            namespace = vol_cfg["namespace"]
            has_tests = vol_cfg["has_test_files"]

            print(f"\n{'='*60}")
            print(f"Volume: {vol_name} ({vol_id})")
            print(f"Path: {vol_path}")

            chapter_names = CHAPTER_ORDER.get(vol_id, [])

            # Parse test files for point values.
            all_test_points: dict[str, float] = {}
            if has_tests:
                for test_file in vol_path.glob("*Test.v"):
                    points = parse_test_file(test_file)
                    all_test_points.update(points)

            vol_exercise_count = 0
            vol_pts_standard = 0.0
            vol_pts_advanced = 0.0
            chapters_created: list[tuple[str, int]] = []

            for order, ch_name in enumerate(chapter_names):
                if ch_name in SKIP_CHAPTERS:
                    continue
                if any(ch_name.startswith(p) for p in SKIP_PREFIXES):
                    continue

                v_file = vol_path / f"{ch_name}.v"
                if not v_file.exists():
                    print(f"  WARN: {ch_name}.v not found, skipping")
                    continue

                exercises = parse_exercises(v_file)

                # Compute point totals for this chapter.
                ch_pts_standard = 0.0
                ch_pts_advanced = 0.0
                for ex in exercises:
                    if ex.name in all_test_points:
                        ex_points = all_test_points[ex.name]
                    else:
                        ex_points = float(ex.stars)
                    if ex.difficulty == "standard":
                        ch_pts_standard += ex_points
                    else:
                        ch_pts_advanced += ex_points

                has_test = (vol_path / f"{ch_name}Test.v").exists()

                # Upsert Chapter (key = volume_id + name).
                existing_ch = await session.scalar(
                    select(Chapter).where(
                        Chapter.volume_id == vol_id,
                        Chapter.name == ch_name,
                    )
                )
                if existing_ch is None:
                    chapter = Chapter(
                        volume_id=vol_id,
                        name=ch_name,
                        display_order=order,
                        exercise_count=len(exercises),
                        max_points_standard=ch_pts_standard,
                        max_points_advanced=ch_pts_advanced,
                        has_test_file=has_test,
                    )
                    session.add(chapter)
                    await session.flush()
                else:
                    chapter = existing_ch
                    chapter.display_order = order
                    chapter.exercise_count = len(exercises)
                    chapter.max_points_standard = ch_pts_standard
                    chapter.max_points_advanced = ch_pts_advanced
                    chapter.has_test_file = has_test

                # Upsert each Exercise (key = chapter_id + name).
                seen_names: dict[str, int] = {}
                for ex in exercises:
                    ex_name = ex.name
                    if ex_name in seen_names:
                        seen_names[ex_name] += 1
                        ex_name = f"{ex.name}_{seen_names[ex_name]}"
                    else:
                        seen_names[ex_name] = 1

                    if ex.name in all_test_points:
                        pts = all_test_points[ex.name]
                    else:
                        pts = float(ex.stars)

                    existing_ex = await session.scalar(
                        select(Exercise).where(
                            Exercise.chapter_id == chapter.id,
                            Exercise.name == ex_name,
                        )
                    )
                    if existing_ex is None:
                        session.add(Exercise(
                            chapter_id=chapter.id,
                            name=ex_name,
                            stars=ex.stars,
                            difficulty=ex.difficulty,
                            modifier=ex.modifier,
                            is_manual=ex.is_manual,
                            points=pts,
                            line_start=ex.line_start,
                            line_end=ex.line_end,
                        ))
                    else:
                        existing_ex.stars = ex.stars
                        existing_ex.difficulty = ex.difficulty
                        existing_ex.modifier = ex.modifier
                        existing_ex.is_manual = ex.is_manual
                        existing_ex.points = pts
                        existing_ex.line_start = ex.line_start
                        existing_ex.line_end = ex.line_end

                vol_exercise_count += len(exercises)
                vol_pts_standard += ch_pts_standard
                vol_pts_advanced += ch_pts_advanced
                chapters_created.append((ch_name, len(exercises)))

                if exercises:
                    print(f"  {ch_name}: {len(exercises)} exercises")

            # Upsert Volume (key = id).
            existing_vol = await session.scalar(
                select(Volume).where(Volume.id == vol_id)
            )
            if existing_vol is None:
                session.add(Volume(
                    id=vol_id,
                    name=vol_name,
                    namespace=namespace,
                    chapter_count=len(chapters_created),
                    exercise_count=vol_exercise_count,
                    total_points_standard=vol_pts_standard,
                    total_points_advanced=vol_pts_advanced,
                ))
            else:
                existing_vol.name = vol_name
                existing_vol.namespace = namespace
                existing_vol.chapter_count = len(chapters_created)
                existing_vol.exercise_count = vol_exercise_count
                existing_vol.total_points_standard = vol_pts_standard
                existing_vol.total_points_advanced = vol_pts_advanced

            total_exercises += vol_exercise_count
            print(f"  TOTAL: {vol_exercise_count} exercises across {len(chapters_created)} chapters")

        await session.commit()
        print(f"\n{'='*60}")
        print(f"Database seeded: {total_exercises} total exercises")
        print(f"Database: {engine.url}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--fresh", action="store_true",
        help="DESTRUCTIVE: drop ALL tables (including users / progress / "
             "daily_activity) before seeding. Use only for a brand-new deploy.",
    )
    args = parser.parse_args()
    asyncio.run(seed(fresh=args.fresh))
