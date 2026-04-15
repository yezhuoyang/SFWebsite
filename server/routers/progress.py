"""Progress tracking endpoints. All endpoints REQUIRE authentication —
progress is per-user and never aggregated across the platform."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session
from server.models import User
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
