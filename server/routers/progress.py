"""Progress tracking endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session
from server.services.progress_tracker import get_progress_summary, get_streak_info

router = APIRouter(tags=["progress"])


@router.get("/progress/summary")
async def progress_summary(session: AsyncSession = Depends(get_session)):
    return await get_progress_summary(session)


@router.get("/progress/streak")
async def streak_info(session: AsyncSession = Depends(get_session)):
    return await get_streak_info(session)
