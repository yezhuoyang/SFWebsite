"""Volume, chapter, and exercise metadata endpoints."""

import re
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from server.config import VOLUMES as VOLUME_CFG
from server.database import get_session
from server.models import Chapter, Exercise, Progress, User, Volume
from server.routers.auth import get_optional_user
from server.schemas import ChapterOut, ExerciseOut, VolumeOut


def _get_chapter_meta(volume_id: str, chapter_name: str) -> tuple[str, str, int]:
    """Extract (title, summary, line_count) from a chapter's .v file.

    The title is the text of the first top-level `(** * Title *)` doc comment
    (e.g. "Imp: Simple Imperative Programs"); the summary is the first
    substantial prose paragraph after the title.
    """
    vol = VOLUME_CFG.get(volume_id)
    if not vol:
        return "", "", 0
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        return "", "", 0
    try:
        text = v_file.read_text(encoding="utf-8", errors="replace")
        line_count = text.count("\n") + 1
        # Find doc comments
        doc_matches = list(re.finditer(r'\(\*\*\s+(.*?)\s*\*\)', text, re.DOTALL))

        # Title — first doc comment matching `* Title Here` (exactly one star)
        title = ""
        for m in doc_matches[:3]:
            t = m.group(1).strip()
            title_match = re.match(r'^\*\s+(.+)$', t, re.DOTALL)
            if title_match:
                title = re.sub(r'\s+', ' ', title_match.group(1)).strip()
                break

        summary = ""
        for m in doc_matches[1:6]:
            t = m.group(1).strip()
            # Skip section markers, short comments, exercise headers
            if t.startswith("*") or len(t) < 40 or "Exercise:" in t:
                continue
            # Clean up whitespace
            t = re.sub(r'\s+', ' ', t)
            # Remove [code] markers
            t = re.sub(r'\[([^\]]+)\]', r'\1', t)
            # Remove _emphasis_ markers
            t = re.sub(r'_([^_]+)_', r'\1', t)
            summary = t[:150]
            if len(t) > 150:
                summary = summary.rsplit(' ', 1)[0] + '...'
            break
        return title, summary, line_count
    except Exception:
        return "", "", 0

router = APIRouter(tags=["volumes"])


@router.get("/volumes", response_model=list[VolumeOut])
async def list_volumes(
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_optional_user),
):
    """List volumes with the CURRENT user's completion counts.
    For unauthenticated callers, completed_count and total_points_earned
    are reported as zero — never aggregated across all users.
    """
    result = await session.execute(
        select(Volume).order_by(Volume.id)
    )
    volumes = result.scalars().all()

    user_id = user.id if user else None
    out = []
    for v in volumes:
        if user_id is not None:
            completed = await session.execute(
                select(func.count(Progress.id))
                .join(Exercise, Progress.exercise_id == Exercise.id)
                .join(Chapter, Exercise.chapter_id == Chapter.id)
                .where(
                    Chapter.volume_id == v.id,
                    Progress.status == "completed",
                    Progress.user_id == user_id,
                )
            )
            completed_count = completed.scalar() or 0

            pts = await session.execute(
                select(func.coalesce(func.sum(Progress.points_earned), 0.0))
                .join(Exercise, Progress.exercise_id == Exercise.id)
                .join(Chapter, Exercise.chapter_id == Chapter.id)
                .where(Chapter.volume_id == v.id, Progress.user_id == user_id)
            )
            total_pts = pts.scalar() or 0.0
        else:
            completed_count = 0
            total_pts = 0.0

        out.append(VolumeOut(
            id=v.id, name=v.name, namespace=v.namespace,
            chapter_count=v.chapter_count, exercise_count=v.exercise_count,
            total_points_standard=v.total_points_standard,
            total_points_advanced=v.total_points_advanced,
            completed_count=completed_count, total_points_earned=total_pts,
        ))
    return out


@router.get("/volumes/{volume_id}/chapters", response_model=list[ChapterOut])
async def list_chapters(
    volume_id: str,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_optional_user),
):
    """List chapters with the CURRENT user's completion counts."""
    result = await session.execute(
        select(Chapter)
        .where(Chapter.volume_id == volume_id)
        .order_by(Chapter.display_order)
    )
    chapters = result.scalars().all()

    user_id = user.id if user else None
    out = []
    for ch in chapters:
        if user_id is not None:
            completed = await session.execute(
                select(func.count(Progress.id))
                .join(Exercise, Progress.exercise_id == Exercise.id)
                .where(
                    Exercise.chapter_id == ch.id,
                    Progress.status == "completed",
                    Progress.user_id == user_id,
                )
            )
            completed_count = completed.scalar() or 0

            pts = await session.execute(
                select(func.coalesce(func.sum(Progress.points_earned), 0.0))
                .join(Exercise, Progress.exercise_id == Exercise.id)
                .where(Exercise.chapter_id == ch.id, Progress.user_id == user_id)
            )
            total_pts = pts.scalar() or 0.0
        else:
            completed_count = 0
            total_pts = 0.0

        title, summary, line_count = _get_chapter_meta(volume_id, ch.name)

        out.append(ChapterOut(
            id=ch.id, volume_id=ch.volume_id, name=ch.name, title=title,
            display_order=ch.display_order, exercise_count=ch.exercise_count,
            max_points_standard=ch.max_points_standard,
            max_points_advanced=ch.max_points_advanced,
            has_test_file=ch.has_test_file,
            completed_count=completed_count, total_points_earned=total_pts,
            summary=summary, line_count=line_count,
        ))
    return out


@router.get("/chapters/{volume_id}/{chapter_name}/exercises", response_model=list[ExerciseOut])
async def list_exercises(
    volume_id: str,
    chapter_name: str,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_optional_user),
):
    """List exercises with the CURRENT user's per-exercise status.
    PRIVACY: previously this used `selectinload(Exercise.progress)` which
    grabbed whichever Progress row happened to exist for the exercise —
    leaking another user's completion status. Now we fetch this user's
    Progress rows in a side query and join them in Python.
    """
    result = await session.execute(
        select(Exercise)
        .join(Chapter)
        .where(Chapter.volume_id == volume_id, Chapter.name == chapter_name)
        .order_by(Exercise.line_start)
    )
    exercises = result.scalars().all()

    user_id = user.id if user else None
    progress_by_ex: dict[int, Progress] = {}
    if user_id is not None and exercises:
        ex_ids = [ex.id for ex in exercises]
        prog_rows = (await session.execute(
            select(Progress).where(
                Progress.user_id == user_id,
                Progress.exercise_id.in_(ex_ids),
            )
        )).scalars().all()
        progress_by_ex = {p.exercise_id: p for p in prog_rows}

    out = []
    for ex in exercises:
        p = progress_by_ex.get(ex.id)
        status = p.status if p else "not_started"
        pts = p.points_earned if p else 0.0
        out.append(ExerciseOut(
            id=ex.id, name=ex.name, stars=ex.stars,
            difficulty=ex.difficulty, modifier=ex.modifier,
            is_manual=ex.is_manual, points=ex.points,
            line_start=ex.line_start, line_end=ex.line_end,
            status=status, points_earned=pts,
        ))
    return out
