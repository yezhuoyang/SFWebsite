"""AI Tutor endpoints with SSE streaming — grounded in live Coq state."""

import json
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from server.database import get_session, async_session
from server.models import ChatMessage
from server.schemas import TutorChatRequest
from server.services.tutor_agent import chat

router = APIRouter(tags=["tutor"])


@router.post("/tutor/chat")
async def tutor_chat(req: TutorChatRequest, session: AsyncSession = Depends(get_session)):
    """Stream a tutor response via SSE, grounded in real Coq proof state."""

    # Fetch recent chat history for conversation continuity
    history_query = select(ChatMessage).where(
        ChatMessage.volume_id == req.volume_id,
        ChatMessage.chapter_name == req.chapter_name,
    ).order_by(ChatMessage.created_at.desc()).limit(16)
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
        coq_state_snapshot=req.proof_state_text,
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
                student_code=req.student_code or req.current_code,
                proof_state_text=req.proof_state_text or req.current_goals,
                diagnostics_text=req.diagnostics_text or req.current_error,
                processed_lines=req.processed_lines,
                history=history,
            ):
                full_response += chunk
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

        # Save assistant response
        try:
            async with async_session() as bg_session:
                assistant_msg = ChatMessage(
                    volume_id=req.volume_id,
                    chapter_name=req.chapter_name,
                    exercise_name=req.exercise_name,
                    role="assistant",
                    content=full_response,
                )
                bg_session.add(assistant_msg)
                await bg_session.commit()
        except Exception:
            pass

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/tutor/explain")
async def tutor_explain(req: TutorChatRequest):
    """Non-streaming explain endpoint — returns a single JSON response
    with a full explanation of the current Coq output. Used by the inline
    Explain panel below the Goals."""
    full_text = ""
    async for chunk in chat(
        message=req.message or "Explain the current Coq output in detail: what it means, what Coq is telling me, and how it relates to where I am currently looking in the chapter.",
        volume_id=req.volume_id,
        chapter_name=req.chapter_name,
        exercise_name=req.exercise_name,
        student_code=req.student_code,
        proof_state_text=req.proof_state_text,
        diagnostics_text=req.diagnostics_text,
        processed_lines=req.processed_lines,
        history=None,  # No conversation history for explain
    ):
        full_text += chunk
    return {"explanation": full_text}


@router.get("/tutor/history")
async def tutor_history(
    volume_id: str | None = None,
    chapter_name: str | None = None,
    session: AsyncSession = Depends(get_session),
):
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
