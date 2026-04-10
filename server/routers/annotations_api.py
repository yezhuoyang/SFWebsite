"""Server-side annotations: create, list (public/mine), delete."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session
from server.models import Annotation, User
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
    is_public: bool = False


def _annotation_dict(a: Annotation) -> dict:
    return {
        "id": a.id, "user_id": a.user_id,
        "username": a.user.username, "display_name": a.user.display_name,
        "volume_id": a.volume_id, "chapter_name": a.chapter_name,
        "block_id": a.block_id, "selected_text": a.selected_text,
        "note": a.note, "color": a.color,
        "start_line": a.start_line, "start_col": a.start_col,
        "end_line": a.end_line, "end_col": a.end_col,
        "is_public": a.is_public, "upvotes": a.upvotes,
        "created_at": a.created_at.isoformat(),
    }


@router.get("/annotations")
async def list_annotations(
    volume_id: str = Query(...),
    chapter_name: str = Query(...),
    public: bool = Query(True),
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
):
    q = select(Annotation).where(
        Annotation.volume_id == volume_id,
        Annotation.chapter_name == chapter_name,
    )
    if public:
        # Public annotations + own annotations
        if user:
            q = q.where(or_(Annotation.is_public == True, Annotation.user_id == user.id))
        else:
            q = q.where(Annotation.is_public == True)
    q = q.order_by(Annotation.created_at.desc()).limit(200)

    result = await session.execute(q)
    return [_annotation_dict(a) for a in result.scalars().all()]


@router.get("/annotations/mine")
async def my_annotations(
    volume_id: str = Query(...),
    chapter_name: str = Query(...),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Annotation).where(
            Annotation.user_id == user.id,
            Annotation.volume_id == volume_id,
            Annotation.chapter_name == chapter_name,
        ).order_by(Annotation.created_at.desc())
    )
    return [_annotation_dict(a) for a in result.scalars().all()]


@router.post("/annotations")
async def create_annotation(
    req: CreateAnnotation,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    a = Annotation(
        user_id=user.id,
        volume_id=req.volume_id, chapter_name=req.chapter_name,
        block_id=req.block_id, selected_text=req.selected_text,
        note=req.note, color=req.color,
        start_line=req.start_line, start_col=req.start_col,
        end_line=req.end_line, end_col=req.end_col,
        is_public=req.is_public,
    )
    session.add(a)
    await session.commit()
    await session.refresh(a)
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
