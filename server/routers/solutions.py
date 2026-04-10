"""Shared solutions: submit, browse, and comment on user solutions."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session
from server.models import SharedSolution, Progress, Exercise, Vote, User
from server.routers.auth import get_current_user

router = APIRouter(tags=["solutions"])


class ShareSolutionRequest(BaseModel):
    exercise_id: int
    code: str
    explanation: str | None = None


def _solution_dict(s: SharedSolution, user_voted: bool = False) -> dict:
    return {
        "id": s.id, "user_id": s.user_id,
        "username": s.user.username, "display_name": s.user.display_name,
        "exercise_name": s.exercise.name,
        "code": s.code, "explanation": s.explanation,
        "upvotes": s.upvotes,
        "created_at": s.created_at.isoformat(),
        "user_voted": user_voted,
    }


@router.post("/solutions/share")
async def share_solution(
    req: ShareSolutionRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    # Must have solved the exercise
    progress = await session.execute(
        select(Progress).where(
            Progress.user_id == user.id,
            Progress.exercise_id == req.exercise_id,
            Progress.status == "completed",
        )
    )
    if not progress.scalar_one_or_none():
        raise HTTPException(403, "You must solve this exercise before sharing a solution")

    # Check if already shared
    existing = await session.execute(
        select(SharedSolution).where(
            SharedSolution.user_id == user.id,
            SharedSolution.exercise_id == req.exercise_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "You already shared a solution for this exercise")

    sol = SharedSolution(
        user_id=user.id, exercise_id=req.exercise_id,
        code=req.code, explanation=req.explanation,
    )
    session.add(sol)
    await session.commit()
    await session.refresh(sol)
    return _solution_dict(sol)


@router.get("/solutions/shared")
async def get_shared_solutions(
    exercise_id: int = Query(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    # Must have solved the exercise to see others' solutions
    progress = await session.execute(
        select(Progress).where(
            Progress.user_id == user.id,
            Progress.exercise_id == exercise_id,
            Progress.status == "completed",
        )
    )
    if not progress.scalar_one_or_none():
        raise HTTPException(403, "Solve this exercise first to see others' solutions")

    result = await session.execute(
        select(SharedSolution).where(SharedSolution.exercise_id == exercise_id)
        .order_by(SharedSolution.upvotes.desc())
    )
    solutions = result.scalars().all()

    # Check votes
    vr = await session.execute(
        select(Vote.target_id).where(
            Vote.user_id == user.id, Vote.target_type == "solution"
        )
    )
    voted_ids = {r[0] for r in vr}

    return [_solution_dict(s, s.id in voted_ids) for s in solutions]
