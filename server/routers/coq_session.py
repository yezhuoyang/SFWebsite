"""Interactive Coq session endpoints.

Provides REST API for managing sertop sessions with step-by-step
proof execution, goal querying, and undo.
"""

from fastapi import APIRouter, HTTPException
from pathlib import Path

from server.config import VOLUMES
from server.schemas import (
    CoqCancelRequest,
    CoqGoal,
    CoqSessionCreate,
    CoqSessionOut,
    CoqStepRequest,
    CoqStepResult,
)
from server.services.sertop_session import pool

router = APIRouter(tags=["coq"])


@router.post("/coq/session", response_model=CoqSessionOut)
async def create_session(req: CoqSessionCreate):
    """Start a new interactive Coq session for a volume."""
    if req.volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {req.volume_id}")

    try:
        session = await pool.create(req.volume_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start sertop: {e}")

    # If a chapter is specified, load the file content up to the first exercise
    if req.chapter_name:
        vol = VOLUMES[req.volume_id]
        v_file = Path(vol["path"]) / f"{req.chapter_name}.v"
        if v_file.exists():
            # Read the file — the client will decide what to send
            pass

    return CoqSessionOut(
        session_id=session.session_id,
        volume_id=req.volume_id,
        status="ready",
    )


@router.post("/coq/step", response_model=CoqStepResult)
async def coq_step(req: CoqStepRequest):
    """Execute a Coq tactic/command and return the resulting proof state."""
    session = pool.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await session.step(req.code)
    goals = None
    if result.goals:
        goals = [
            CoqGoal(hypotheses=g.hypotheses, conclusion=g.conclusion)
            for g in result.goals
        ]

    return CoqStepResult(
        sid=result.sid,
        goals=goals,
        error=result.error,
    )


@router.post("/coq/exec-to")
async def coq_exec_to(req: CoqStepRequest):
    """Execute multiple lines of Coq code, returning the final proof state."""
    session = pool.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Split code into individual statements (by period + space/newline)
    # But be careful: periods inside comments or strings shouldn't split
    lines = req.code.strip()
    if not lines:
        return CoqStepResult(sid=session.last_sid, goals=None, error=None)

    result = await session.step(lines)
    goals = None
    if result.goals:
        goals = [
            CoqGoal(hypotheses=g.hypotheses, conclusion=g.conclusion)
            for g in result.goals
        ]

    return CoqStepResult(
        sid=result.sid,
        goals=goals,
        error=result.error,
    )


@router.post("/coq/cancel")
async def coq_cancel(req: CoqCancelRequest):
    """Undo execution back to before the given sentence ID."""
    session = pool.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await session.cancel(req.sid)

    # Query goals at the new position
    goals_data = await session.goals()
    goals = [
        CoqGoal(hypotheses=g.hypotheses, conclusion=g.conclusion)
        for g in goals_data
    ]

    return CoqStepResult(
        sid=session.last_sid,
        goals=goals if goals else None,
        error=None,
    )


@router.get("/coq/session/{session_id}/goals", response_model=CoqStepResult)
async def coq_goals(session_id: str):
    """Get the current proof state for a session."""
    session = pool.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    goals_data = await session.goals()
    goals = [
        CoqGoal(hypotheses=g.hypotheses, conclusion=g.conclusion)
        for g in goals_data
    ]

    return CoqStepResult(
        sid=session.last_sid,
        goals=goals if goals else None,
        error=None,
    )


@router.delete("/coq/session/{session_id}")
async def close_session(session_id: str):
    """Close an interactive Coq session."""
    session = pool.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await pool.close(session_id)
    return {"status": "closed"}


@router.get("/coq/file/{volume_id}/{chapter_name}")
async def get_chapter_file(volume_id: str, chapter_name: str):
    """Get the content of a chapter .v file."""
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")

    vol = VOLUMES[volume_id]
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {chapter_name}.v")

    content = v_file.read_text(encoding="utf-8", errors="replace")
    return {"content": content, "filename": f"{chapter_name}.v"}


@router.get("/coq/blocks/{volume_id}/{chapter_name}")
async def get_chapter_blocks(volume_id: str, chapter_name: str):
    """Get a chapter parsed into structured blocks for Jupyter-style display."""
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")

    vol = VOLUMES[volume_id]
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {chapter_name}.v")

    from server.services.block_parser import parse_blocks
    result = parse_blocks(v_file)

    return {
        "filename": result.filename,
        "blocks": [
            {
                "id": b.id,
                "kind": b.kind,
                "content": b.content,
                "line_start": b.line_start,
                "line_end": b.line_end,
                "title": b.title,
                "exercise_name": b.exercise_name,
                "exercise_stars": b.exercise_stars,
                "exercise_difficulty": b.exercise_difficulty,
                "exercise_modifier": b.exercise_modifier,
                "editable": b.editable,
            }
            for b in result.blocks
        ],
        "toc": [
            {"block_id": t.block_id, "level": t.level, "title": t.title}
            for t in result.toc
        ],
    }


@router.put("/coq/file/{volume_id}/{chapter_name}")
async def save_chapter_file(volume_id: str, chapter_name: str, body: dict):
    """Save the content of a chapter .v file."""
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")

    content = body.get("content", "")
    vol = VOLUMES[volume_id]
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {chapter_name}.v")

    v_file.write_text(content, encoding="utf-8")
    return {"status": "saved"}
