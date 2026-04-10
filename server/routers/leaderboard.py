"""Leaderboard: global rankings by points, exercises, streaks."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, case, literal
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session
from server.models import User, Progress, DailyActivity
from server.routers.auth import get_current_user, get_optional_user

router = APIRouter(tags=["leaderboard"])


def _build_leaderboard_query(sort: str):
    """Build the leaderboard query sorted by the given field."""
    q = (
        select(
            User.id.label("user_id"),
            User.username,
            User.display_name,
            func.count(case((Progress.status == "completed", 1))).label("exercises_completed"),
            func.coalesce(func.sum(case((Progress.status == "completed", Progress.points_earned))), 0).label("total_points"),
        )
        .outerjoin(Progress, Progress.user_id == User.id)
        .group_by(User.id)
    )

    if sort == "exercises":
        q = q.order_by(func.count(case((Progress.status == "completed", 1))).desc())
    else:  # default: points
        q = q.order_by(
            func.coalesce(func.sum(case((Progress.status == "completed", Progress.points_earned))), 0).desc()
        )

    return q


@router.get("/leaderboard")
async def get_leaderboard(
    sort: str = Query("points", regex="^(points|exercises)$"),
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    q = _build_leaderboard_query(sort).limit(limit)
    result = await session.execute(q)
    rows = result.all()

    return [
        {
            "rank": i + 1,
            "user_id": r.user_id,
            "username": r.username,
            "display_name": r.display_name,
            "exercises_completed": r.exercises_completed,
            "total_points": float(r.total_points),
            "current_streak": 0,  # computed separately if needed
        }
        for i, r in enumerate(rows)
    ]


@router.get("/leaderboard/me")
async def get_my_rank(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    # Get user's stats
    stats = await session.execute(
        select(
            func.count(case((Progress.status == "completed", 1))).label("exercises_completed"),
            func.coalesce(func.sum(case((Progress.status == "completed", Progress.points_earned))), 0).label("total_points"),
        )
        .where(Progress.user_id == user.id)
    )
    row = stats.one()

    # Count users with more points to determine rank
    rank_result = await session.execute(
        select(func.count()).select_from(
            select(User.id)
            .outerjoin(Progress, Progress.user_id == User.id)
            .group_by(User.id)
            .having(
                func.coalesce(func.sum(case((Progress.status == "completed", Progress.points_earned))), 0)
                > float(row.total_points)
            )
            .subquery()
        )
    )
    rank = rank_result.scalar() + 1

    return {
        "rank": rank,
        "user_id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "exercises_completed": row.exercises_completed,
        "total_points": float(row.total_points),
        "current_streak": 0,
    }
