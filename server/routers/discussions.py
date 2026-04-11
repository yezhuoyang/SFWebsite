"""Discussion threads: create, list, reply, vote."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session
from server.models import Discussion, DiscussionReply, Vote, User, SharedSolution, Annotation
from server.routers.auth import get_current_user, get_optional_user

router = APIRouter(tags=["discussions"])


class CreateDiscussion(BaseModel):
    volume_id: str
    chapter_name: str
    exercise_name: str | None = None
    title: str
    content: str
    code_snippet: str | None = None


class CreateReply(BaseModel):
    content: str


class VoteRequest(BaseModel):
    target_type: str  # discussion, reply, annotation, solution
    target_id: int


def _discussion_dict(d: Discussion, user_voted: bool = False) -> dict:
    return {
        "id": d.id, "user_id": d.user_id,
        "username": d.user.username, "display_name": d.user.display_name,
        "volume_id": d.volume_id, "chapter_name": d.chapter_name,
        "exercise_name": d.exercise_name,
        "title": d.title, "content": d.content, "code_snippet": d.code_snippet,
        "upvotes": d.upvotes, "reply_count": d.reply_count,
        "created_at": d.created_at.isoformat(), "user_voted": user_voted,
    }


def _reply_dict(r: DiscussionReply, user_voted: bool = False) -> dict:
    return {
        "id": r.id, "user_id": r.user_id,
        "username": r.user.username, "display_name": r.user.display_name,
        "content": r.content, "upvotes": r.upvotes,
        "created_at": r.created_at.isoformat(), "user_voted": user_voted,
    }


@router.get("/discussions")
async def list_discussions(
    volume_id: str | None = Query(None),
    chapter_name: str | None = Query(None),
    exercise_name: str | None = Query(None),
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(Discussion).order_by(Discussion.created_at.desc()).limit(100)
    if volume_id:
        q = q.where(Discussion.volume_id == volume_id)
    if chapter_name:
        q = q.where(Discussion.chapter_name == chapter_name)
    if exercise_name:
        q = q.where(Discussion.exercise_name == exercise_name)

    result = await session.execute(q)
    discussions = result.scalars().all()

    # Check votes
    voted_ids: set[int] = set()
    if user:
        vr = await session.execute(
            select(Vote.target_id).where(Vote.user_id == user.id, Vote.target_type == "discussion")
        )
        voted_ids = {r[0] for r in vr}

    return [_discussion_dict(d, d.id in voted_ids) for d in discussions]


@router.get("/discussions/{discussion_id}")
async def get_discussion(
    discussion_id: int,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Discussion).where(Discussion.id == discussion_id)
    )
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Discussion not found")

    # Replies
    rr = await session.execute(
        select(DiscussionReply).where(DiscussionReply.discussion_id == discussion_id)
        .order_by(DiscussionReply.created_at)
    )
    replies = rr.scalars().all()

    # Votes
    voted_d: set[int] = set()
    voted_r: set[int] = set()
    if user:
        vd = await session.execute(
            select(Vote.target_id).where(Vote.user_id == user.id, Vote.target_type == "discussion")
        )
        voted_d = {r[0] for r in vd}
        vr = await session.execute(
            select(Vote.target_id).where(Vote.user_id == user.id, Vote.target_type == "reply")
        )
        voted_r = {r[0] for r in vr}

    return {
        "discussion": _discussion_dict(d, d.id in voted_d),
        "replies": [_reply_dict(r, r.id in voted_r) for r in replies],
    }


@router.post("/discussions")
async def create_discussion(
    req: CreateDiscussion,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    d = Discussion(
        user_id=user.id,
        volume_id=req.volume_id, chapter_name=req.chapter_name,
        exercise_name=req.exercise_name,
        title=req.title, content=req.content, code_snippet=req.code_snippet,
    )
    session.add(d)
    await session.commit()
    await session.refresh(d)
    return _discussion_dict(d)


@router.post("/discussions/{discussion_id}/replies")
async def reply_to_discussion(
    discussion_id: int,
    req: CreateReply,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    # Verify discussion exists
    dr = await session.execute(select(Discussion).where(Discussion.id == discussion_id))
    d = dr.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Discussion not found")

    r = DiscussionReply(
        discussion_id=discussion_id, user_id=user.id, content=req.content,
    )
    session.add(r)
    d.reply_count += 1
    await session.commit()
    await session.refresh(r)
    return _reply_dict(r)


@router.post("/votes")
async def toggle_vote(
    req: VoteRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if req.target_type not in ("discussion", "reply", "annotation", "solution"):
        raise HTTPException(400, "Invalid target type")

    # Check existing vote
    existing = await session.execute(
        select(Vote).where(
            Vote.user_id == user.id,
            Vote.target_type == req.target_type,
            Vote.target_id == req.target_id,
        )
    )
    vote = existing.scalar_one_or_none()

    # Toggle: if exists, remove; if not, add
    if vote:
        await session.delete(vote)
        delta = -1
        voted = False
    else:
        session.add(Vote(user_id=user.id, target_type=req.target_type, target_id=req.target_id))
        delta = 1
        voted = True

    # Update upvote count on target
    model_map = {
        "discussion": Discussion,
        "reply": DiscussionReply,
        "solution": SharedSolution,
        "annotation": Annotation,
    }
    model = model_map.get(req.target_type)
    target = None
    if model:
        tr = await session.execute(select(model).where(model.id == req.target_id))
        target = tr.scalar_one_or_none()
        if target:
            target.upvotes = max(0, target.upvotes + delta)

    await session.commit()
    return {"upvotes": (target.upvotes if target else 0), "voted": voted}
