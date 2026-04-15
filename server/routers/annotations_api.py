"""Server-side annotations: create (always public), list, delete.

Annotations are PUBLIC by design — anyone (including unauthenticated readers)
can see every annotation on a chapter. Only the original author can delete
their own. The is_public flag is honoured on read for backward compatibility
but new annotations are always created public.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from server.database import get_session
from server.models import Annotation, Vote, User
from server.routers.auth import get_current_user, get_optional_user

router = APIRouter(tags=["annotations"])


class CreateAnnotation(BaseModel):
    volume_id: str
    chapter_name: str
    block_id: int
    selected_text: str
    note: str
    color: str = "#f59e0b"
    start_line: int
    start_col: int
    end_line: int
    end_col: int
    is_public: bool = True   # default + forced True on create — kept in the
                              # schema for compat with old client code


def _annotation_dict(a: Annotation, user_voted: bool = False) -> dict:
    # `a.user` MUST be eagerly loaded by the caller's query
    # (selectinload(Annotation.user)) — otherwise this raises MissingGreenlet
    # in async mode and the endpoint 500s for every reader.
    return {
        "id": a.id, "user_id": a.user_id,
        "username": a.user.username, "display_name": a.user.display_name,
        "volume_id": a.volume_id, "chapter_name": a.chapter_name,
        "block_id": a.block_id, "selected_text": a.selected_text,
        "note": a.note, "color": a.color,
        "start_line": a.start_line, "start_col": a.start_col,
        "end_line": a.end_line, "end_col": a.end_col,
        "is_public": a.is_public, "upvotes": a.upvotes,
        "user_voted": user_voted,
        "created_at": a.created_at.isoformat(),
    }


@router.get("/annotations")
async def list_annotations(
    volume_id: str = Query(...),
    chapter_name: str = Query(...),
    public: bool = Query(True),  # kept for compat; ignored — we always serve all
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
):
    """List annotations on a chapter. Annotations are public — anyone can read."""
    _ = public  # ignored; behaviour is always "show every annotation"
    q = (
        select(Annotation)
        .where(
            Annotation.volume_id == volume_id,
            Annotation.chapter_name == chapter_name,
        )
        .options(selectinload(Annotation.user))
        .order_by(Annotation.created_at.desc())
        .limit(500)
    )
    annotations = (await session.execute(q)).scalars().all()

    voted_ids: set[int] = set()
    if user:
        vr = await session.execute(
            select(Vote.target_id).where(Vote.user_id == user.id, Vote.target_type == "annotation")
        )
        voted_ids = {r[0] for r in vr}

    return [_annotation_dict(a, a.id in voted_ids) for a in annotations]


@router.get("/annotations/mine")
async def my_annotations(
    volume_id: str = Query(...),
    chapter_name: str = Query(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Annotation)
        .where(
            Annotation.user_id == user.id,
            Annotation.volume_id == volume_id,
            Annotation.chapter_name == chapter_name,
        )
        .options(selectinload(Annotation.user))
        .order_by(Annotation.created_at.desc())
    )
    return [_annotation_dict(a) for a in result.scalars().all()]


@router.post("/annotations")
async def create_annotation(
    req: CreateAnnotation,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Create an annotation. Always public — every learner can see it."""
    a = Annotation(
        user_id=user.id,
        volume_id=req.volume_id, chapter_name=req.chapter_name,
        block_id=req.block_id, selected_text=req.selected_text,
        note=req.note, color=req.color,
        start_line=req.start_line, start_col=req.start_col,
        end_line=req.end_line, end_col=req.end_col,
        is_public=True,  # forced public regardless of request
    )
    session.add(a)
    await session.commit()
    # Re-fetch with the user relationship eagerly loaded so _annotation_dict
    # can serialize without lazy-loading.
    result = await session.execute(
        select(Annotation)
        .where(Annotation.id == a.id)
        .options(selectinload(Annotation.user))
    )
    a = result.scalar_one()
    return _annotation_dict(a)


@router.delete("/annotations/{annotation_id}")
async def delete_annotation(
    annotation_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Annotation).where(Annotation.id == annotation_id)
    )
    a = result.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Annotation not found")
    if a.user_id != user.id:
        raise HTTPException(403, "Cannot delete another user's annotation")
    await session.delete(a)
    await session.commit()
    return {"status": "deleted"}
