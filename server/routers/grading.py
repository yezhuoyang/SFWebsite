"""Grading endpoints. All endpoints REQUIRE authentication: every grade is
attributed to the calling user, never to a default account."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session
from server.models import User
from server.routers.auth import get_current_user
from server.services.grader import full_grade, quick_grade
from server.services.progress_tracker import update_progress_from_grade

router = APIRouter(tags=["grading"])


@router.post("/grade/{volume_id}/{chapter_name}")
async def grade_chapter(
    volume_id: str,
    chapter_name: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Full grade: compile with coqc + static analysis. Per-user."""
    result = await full_grade(volume_id, chapter_name)
    await update_progress_from_grade(session, result, user.id)

    return {
        "volume_id": result.volume_id,
        "chapter_name": result.chapter_name,
        "success": result.success,
        "compile_output": result.compile_output,
        "exercises": [
            {
                "name": ex.exercise_name,
                "status": ex.status,
                "points_earned": ex.points_earned,
                "feedback": ex.feedback,
                "error_detail": ex.error_detail,
            }
            for ex in result.exercises
        ],
    }


@router.post("/grade/{volume_id}/{chapter_name}/quick")
async def quick_grade_chapter(
    volume_id: str,
    chapter_name: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Quick grade: static analysis only (no compilation). Per-user."""
    result = await quick_grade(volume_id, chapter_name)
    await update_progress_from_grade(session, result, user.id)

    return {
        "volume_id": result.volume_id,
        "chapter_name": result.chapter_name,
        "success": result.success,
        "exercises": [
            {
                "name": ex.exercise_name,
                "status": ex.status,
                "points_earned": ex.points_earned,
                "feedback": ex.feedback,
                "error_detail": ex.error_detail,
            }
            for ex in result.exercises
        ],
    }
