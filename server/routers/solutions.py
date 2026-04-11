"""Shared solutions: submit, browse, and comment on user solutions (LeetCode-style)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from server.database import get_session
from server.models import SharedSolution, SolutionComment, Progress, Vote, User
from server.routers.auth import get_current_user

router = APIRouter(tags=["solutions"])


class ShareSolutionRequest(BaseModel):
    exercise_id: int
    code: str
    explanation: str | None = None


class CommentRequest(BaseModel):
    content: str


def _solution_dict(s: SharedSolution, user_voted: bool = False) -> dict:
    return {
        "id": s.id,
        "user_id": s.user_id,
        "username": s.user.username,
        "display_name": s.user.display_name,
        "exercise_id": s.exercise_id,
        "exercise_name": s.exercise.name,
        "code": s.code,
        "explanation": s.explanation,
        "upvotes": s.upvotes,
        "comment_count": s.comment_count,
        "created_at": s.created_at.isoformat(),
        "user_voted": user_voted,
    }


def _comment_dict(c: SolutionComment) -> dict:
    return {
        "id": c.id,
        "solution_id": c.solution_id,
        "user_id": c.user_id,
        "username": c.user.username,
        "display_name": c.user.display_name,
        "content": c.content,
        "created_at": c.created_at.isoformat(),
    }


async def _user_has_solved(session: AsyncSession, user_id: int, exercise_id: int) -> bool:
    result = await session.execute(
        select(Progress).where(
            Progress.user_id == user_id,
            Progress.exercise_id == exercise_id,
            Progress.status == "completed",
        )
    )
    return result.scalar_one_or_none() is not None


@router.post("/solutions/share")
async def share_solution(
    req: ShareSolutionRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Submit a new solution. Multiple submissions per user per exercise are allowed."""
    if not await _user_has_solved(session, user.id, req.exercise_id):
        raise HTTPException(403, "You must solve this exercise before sharing a solution")

    sol = SharedSolution(
        user_id=user.id,
        exercise_id=req.exercise_id,
        code=req.code,
        explanation=req.explanation,
    )
    session.add(sol)
    await session.commit()

    # Re-fetch with eager loads so _solution_dict works
    result = await session.execute(
        select(SharedSolution)
        .where(SharedSolution.id == sol.id)
        .options(selectinload(SharedSolution.user), selectinload(SharedSolution.exercise))
    )
    sol = result.scalar_one()
    return _solution_dict(sol)


@router.get("/solutions/shared")
async def get_shared_solutions(
    exercise_id: int = Query(...),
    sort: str = Query("upvotes", pattern="^(upvotes|newest|oldest)$"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """List all solutions for an exercise. User must have solved it first."""
    if not await _user_has_solved(session, user.id, exercise_id):
        raise HTTPException(403, "Solve this exercise first to see others' solutions")

    q = (
        select(SharedSolution)
        .where(SharedSolution.exercise_id == exercise_id)
        .options(selectinload(SharedSolution.user), selectinload(SharedSolution.exercise))
    )
    if sort == "upvotes":
        q = q.order_by(SharedSolution.upvotes.desc(), SharedSolution.created_at.desc())
    elif sort == "newest":
        q = q.order_by(SharedSolution.created_at.desc())
    else:  # oldest
        q = q.order_by(SharedSolution.created_at.asc())

    result = await session.execute(q)
    solutions = result.scalars().all()

    # Check which solutions the current user has voted on
    vr = await session.execute(
        select(Vote.target_id).where(
            Vote.user_id == user.id, Vote.target_type == "solution"
        )
    )
    voted_ids = {r[0] for r in vr}

    return [_solution_dict(s, s.id in voted_ids) for s in solutions]


@router.get("/solutions/mine")
async def get_my_solutions(
    exercise_id: int = Query(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Get current user's own submission history for an exercise, newest first."""
    result = await session.execute(
        select(SharedSolution)
        .where(
            SharedSolution.user_id == user.id,
            SharedSolution.exercise_id == exercise_id,
        )
        .options(selectinload(SharedSolution.user), selectinload(SharedSolution.exercise))
        .order_by(SharedSolution.created_at.desc())
    )
    solutions = result.scalars().all()
    return [_solution_dict(s) for s in solutions]


@router.get("/solutions/shared/{solution_id}")
async def get_solution_detail(
    solution_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Get a single solution with its comments."""
    result = await session.execute(
        select(SharedSolution)
        .where(SharedSolution.id == solution_id)
        .options(
            selectinload(SharedSolution.user),
            selectinload(SharedSolution.exercise),
            selectinload(SharedSolution.comments).selectinload(SolutionComment.user),
        )
    )
    sol = result.scalar_one_or_none()
    if not sol:
        raise HTTPException(404, "Solution not found")

    # Must have solved the exercise to see it (unless it's yours)
    if sol.user_id != user.id and not await _user_has_solved(session, user.id, sol.exercise_id):
        raise HTTPException(403, "Solve this exercise first to view solutions")

    vr = await session.execute(
        select(Vote.target_id).where(
            Vote.user_id == user.id,
            Vote.target_type == "solution",
            Vote.target_id == solution_id,
        )
    )
    user_voted = vr.scalar_one_or_none() is not None

    comments_sorted = sorted(sol.comments, key=lambda c: c.created_at)
    return {
        "solution": _solution_dict(sol, user_voted),
        "comments": [_comment_dict(c) for c in comments_sorted],
    }


@router.post("/solutions/shared/{solution_id}/comments")
async def add_comment(
    solution_id: int,
    req: CommentRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Add a comment to a solution. User must have solved the exercise."""
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(400, "Comment content cannot be empty")
    if len(content) > 4000:
        raise HTTPException(400, "Comment too long (max 4000 chars)")

    sol = (await session.execute(
        select(SharedSolution).where(SharedSolution.id == solution_id)
    )).scalar_one_or_none()
    if not sol:
        raise HTTPException(404, "Solution not found")

    if sol.user_id != user.id and not await _user_has_solved(session, user.id, sol.exercise_id):
        raise HTTPException(403, "Solve this exercise first to comment")

    comment = SolutionComment(
        solution_id=solution_id,
        user_id=user.id,
        content=content,
    )
    session.add(comment)
    sol.comment_count = (sol.comment_count or 0) + 1
    await session.commit()

    # Re-fetch with user eager-loaded
    result = await session.execute(
        select(SolutionComment)
        .where(SolutionComment.id == comment.id)
        .options(selectinload(SolutionComment.user))
    )
    comment = result.scalar_one()
    return _comment_dict(comment)


@router.delete("/solutions/shared/{solution_id}")
async def delete_solution(
    solution_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Delete one of your own solutions."""
    sol = (await session.execute(
        select(SharedSolution).where(SharedSolution.id == solution_id)
    )).scalar_one_or_none()
    if not sol:
        raise HTTPException(404, "Solution not found")
    if sol.user_id != user.id:
        raise HTTPException(403, "You can only delete your own solutions")

    await session.delete(sol)
    await session.commit()
    return {"ok": True}
