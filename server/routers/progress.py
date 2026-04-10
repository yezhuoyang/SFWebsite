"""Progress tracking endpoints (user-aware)."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session
from server.models import User
from server.routers.auth import get_optional_user
from server.services.progress_tracker import get_progress_summary, get_streak_info

router = APIRouter(tags=["progress"])


@router.get("/progress/summary")
async def progress_summary(
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
):
    uid = user.id if user else None
    return await get_progress_summary(session, uid)


@router.get("/progress/streak")
async def streak_info(
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
):
    uid = user.id if user else None
    return await get_streak_info(session, uid)
