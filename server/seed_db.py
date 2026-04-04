"""Scan all SF volumes and populate the database with exercise metadata."""

import asyncio
import sys
from pathlib import Path

# Ensure we can import server modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.config import VOLUMES, CHAPTER_ORDER, SKIP_CHAPTERS, SKIP_PREFIXES
from server.database import engine, async_session, Base
from server.models import Volume, Chapter, Exercise
from server.services.parser import parse_exercises, parse_test_file


async def seed():
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

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

            # Get chapter ordering
            chapter_names = CHAPTER_ORDER.get(vol_id, [])

            # Parse test files for point values
            all_test_points: dict[str, float] = {}
            if has_tests:
                for test_file in vol_path.glob("*Test.v"):
                    points = parse_test_file(test_file)
                    all_test_points.update(points)

            # Process chapters
            vol_exercise_count = 0
            vol_pts_standard = 0.0
            vol_pts_advanced = 0.0
            chapters_created = []

            for order, ch_name in enumerate(chapter_names):
                # Skip non-content chapters
                if ch_name in SKIP_CHAPTERS:
                    continue
                if any(ch_name.startswith(p) for p in SKIP_PREFIXES):
                    continue

                v_file = vol_path / f"{ch_name}.v"
                if not v_file.exists():
                    print(f"  WARN: {ch_name}.v not found, skipping")
                    continue

                exercises = parse_exercises(v_file)

                # Match exercises with test file points
                ch_pts_standard = 0.0
                ch_pts_advanced = 0.0
                for ex in exercises:
                    if ex.name in all_test_points:
                        ex_points = all_test_points[ex.name]
                    elif not has_tests:
                        # SLF: infer points from stars
                        ex_points = float(ex.stars)
                    else:
                        ex_points = float(ex.stars)  # fallback

                    if ex.difficulty == "standard":
                        ch_pts_standard += ex_points
                    else:
                        ch_pts_advanced += ex_points

                has_test = (vol_path / f"{ch_name}Test.v").exists()

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
                await session.flush()  # Get the chapter ID

                seen_names: dict[str, int] = {}
                for ex in exercises:
                    # Handle duplicate exercise names in the same chapter
                    ex_name = ex.name
                    if ex_name in seen_names:
                        seen_names[ex_name] += 1
                        ex_name = f"{ex.name}_{seen_names[ex_name]}"
                    else:
                        seen_names[ex_name] = 1

                    if ex.name in all_test_points:
                        pts = all_test_points[ex.name]
                    elif not has_tests:
                        pts = float(ex.stars)
                    else:
                        pts = float(ex.stars)

                    exercise = Exercise(
                        chapter_id=chapter.id,
                        name=ex_name,
                        stars=ex.stars,
                        difficulty=ex.difficulty,
                        modifier=ex.modifier,
                        is_manual=ex.is_manual,
                        points=pts,
                        line_start=ex.line_start,
                        line_end=ex.line_end,
                    )
                    session.add(exercise)

                vol_exercise_count += len(exercises)
                vol_pts_standard += ch_pts_standard
                vol_pts_advanced += ch_pts_advanced
                chapters_created.append((ch_name, len(exercises)))

                if exercises:
                    print(f"  {ch_name}: {len(exercises)} exercises")

            # Create volume record
            volume = Volume(
                id=vol_id,
                name=vol_name,
                namespace=namespace,
                chapter_count=len(chapters_created),
                exercise_count=vol_exercise_count,
                total_points_standard=vol_pts_standard,
                total_points_advanced=vol_pts_advanced,
            )
            session.add(volume)

            total_exercises += vol_exercise_count
            print(f"  TOTAL: {vol_exercise_count} exercises across {len(chapters_created)} chapters")

        await session.commit()
        print(f"\n{'='*60}")
        print(f"Database seeded: {total_exercises} total exercises")
        print(f"Database: {engine.url}")


if __name__ == "__main__":
    asyncio.run(seed())
