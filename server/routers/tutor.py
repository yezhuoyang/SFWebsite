"""AI Tutor endpoints with SSE streaming."""

import json
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session
from server.models import ChatMessage
from server.schemas import TutorChatRequest
from server.services.tutor_agent import chat

router = APIRouter(tags=["tutor"])


@router.post("/tutor/chat")
async def tutor_chat(req: TutorChatRequest, session: AsyncSession = Depends(get_session)):
    """Stream a tutor response via SSE, grounded in real Coq proof state."""

    # Fetch recent chat history for context
    history_query = select(ChatMessage).where(
        ChatMessage.volume_id == req.volume_id,
        ChatMessage.chapter_name == req.chapter_name,
    ).order_by(ChatMessage.created_at.desc()).limit(20)
    result = await session.execute(history_query)
    history_records = list(reversed(result.scalars().all()))
    history = [{"role": h.role, "content": h.content} for h in history_records]

    # Save user message
    user_msg = ChatMessage(
        volume_id=req.volume_id,
        chapter_name=req.chapter_name,
        exercise_name=req.exercise_name,
        role="user",
        content=req.message,
        coq_state_snapshot=req.current_goals,
    )
    session.add(user_msg)
    await session.commit()

    async def generate():
        full_response = ""
        try:
            async for chunk in chat(
                message=req.message,
                volume_id=req.volume_id,
                chapter_name=req.chapter_name,
                exercise_name=req.exercise_name,
                current_goals=req.current_goals,
                current_error=req.current_error,
                current_code=req.current_code,
                history=history,
            ):
                full_response += chunk
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

        # Save assistant response
        async with get_session_for_bg() as bg_session:
            assistant_msg = ChatMessage(
                volume_id=req.volume_id,
                chapter_name=req.chapter_name,
                exercise_name=req.exercise_name,
                role="assistant",
                content=full_response,
            )
            bg_session.add(assistant_msg)
            await bg_session.commit()

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


async def get_session_for_bg():
    """Create a standalone session for background saving."""
    from server.database import async_session
    return async_session()


@router.get("/tutor/history")
async def tutor_history(
    volume_id: str | None = None,
    chapter_name: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    """Get chat history for a volume/chapter."""
    query = select(ChatMessage)
    if volume_id:
        query = query.where(ChatMessage.volume_id == volume_id)
    if chapter_name:
        query = query.where(ChatMessage.chapter_name == chapter_name)
    query = query.order_by(ChatMessage.created_at).limit(100)

    result = await session.execute(query)
    messages = result.scalars().all()

    return [
        {
            "role": m.role,
            "content": m.content,
            "exercise_name": m.exercise_name,
            "coq_state_snapshot": m.coq_state_snapshot,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in messages
    ]
