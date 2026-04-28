"""Progress tracking endpoints. All endpoints REQUIRE authentication —
progress is per-user and never aggregated across the platform."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session
from server.models import Chapter, Exercise, Progress, User
from server.routers.auth import get_current_user
from server.services.progress_tracker import get_progress_summary, get_streak_info

router = APIRouter(tags=["progress"])


@router.get("/progress/summary")
async def progress_summary(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await get_progress_summary(session, user.id)


@router.get("/progress/streak")
async def streak_info(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await get_streak_info(session, user.id)


@router.get("/progress/chapter/{volume_id}/{chapter_name}")
async def chapter_progress(
    volume_id: str,
    chapter_name: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Per-exercise grading status for the current user in one chapter.

    Returns: { volume_id, chapter_name, exercises: [{name, status,
    points, points_earned, last_graded_at}], completed, total,
    points_total, points_earned }.
    """
    chapter = (await session.execute(
        select(Chapter).where(
            Chapter.volume_id == volume_id,
            Chapter.name == chapter_name,
        )
    )).scalar_one_or_none()
    if chapter is None:
        raise HTTPException(status_code=404, detail=f"Unknown chapter: {volume_id}/{chapter_name}")

    # Pull all exercises in this chapter + this user's progress for each.
    rows = (await session.execute(
        select(Exercise, Progress)
        .join(
            Progress,
            (Progress.exercise_id == Exercise.id) & (Progress.user_id == user.id),
            isouter=True,
        )
        .where(Exercise.chapter_id == chapter.id)
        .order_by(Exercise.line_start)
    )).all()

    exercises = []
    completed = 0
    points_total = 0.0
    points_earned = 0.0
    for ex, prog in rows:
        status = prog.status if prog is not None else "not_started"
        pts_earned = prog.points_earned if prog is not None else 0.0
        last_graded = prog.last_graded_at.isoformat() if (prog and prog.last_graded_at) else None
        if status == "completed":
            completed += 1
        points_total += float(ex.points or 0)
        points_earned += float(pts_earned)
        exercises.append({
            "name": ex.name,
            "stars": ex.stars,
            "difficulty": ex.difficulty,
            "modifier": ex.modifier,
            "status": status,
            "points": float(ex.points or 0),
            "points_earned": float(pts_earned),
            "last_graded_at": last_graded,
            # Manual-grade exercises (`Definition manual_grade_for_<name>`)
            # are paragraph-form answers, not auto-gradable Coq proofs.
            # The client uses this to hide the per-exercise Submit button
            # on these (it would always return "not found" through coqc).
            "is_manual": bool(ex.is_manual),
        })

    return {
        "volume_id": volume_id,
        "chapter_name": chapter_name,
        "exercises": exercises,
        "completed": completed,
        "total": len(exercises),
        "points_total": points_total,
        "points_earned": points_earned,
    }
