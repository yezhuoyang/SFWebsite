"""Interactive Coq session endpoints.

Uses vscoqtop (the VsRocq language server) for real-time proof state.
Provides both REST (session lifecycle) and WebSocket (real-time stepping).
"""

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession

from server.config import VOLUMES
from server.database import get_session
from server.schemas import CoqSessionCreate, CoqSessionOut
from server.services.vscoqtop_session import pool
from server.services.block_parser import parse_blocks

logger = logging.getLogger(__name__)

router = APIRouter(tags=["coq"])


# --- REST endpoints (session lifecycle + file operations) ---

@router.post("/coq/session", response_model=CoqSessionOut)
async def create_session(req: CoqSessionCreate):
    """Start a new vscoqtop session for a volume/chapter."""
    if req.volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {req.volume_id}")

    chapter = req.chapter_name or "Basics"
    try:
        session = await pool.create(req.volume_id, chapter)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start vscoqtop: {e}")

    return CoqSessionOut(
        session_id=session.session_id,
        volume_id=req.volume_id,
        status="ready",
    )


@router.delete("/coq/session/{session_id}")
async def close_session(session_id: str):
    session = pool.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await pool.close(session_id)
    return {"status": "closed"}


# --- WebSocket endpoint (real-time stepping + proof state) ---

@router.websocket("/coq/ws/{session_id}")
async def coq_websocket(ws: WebSocket, session_id: str):
    """Bidirectional WebSocket for real-time Coq interaction.

    Client sends:
      {"type": "stepForward"}
      {"type": "stepBackward"}
      {"type": "interpretToPoint", "line": N, "character": N}
      {"type": "interpretToEnd"}
      {"type": "change", "text": "...full document..."}

    Server pushes:
      {"type": "proofView", "proof": {...}, "messages": [...]}
      {"type": "highlights", "processedRange": [...], ...}
      {"type": "diagnostics", "items": [...]}
      {"type": "moveCursor", "range": {...}}
    """
    session = pool.get(session_id)
    if not session:
        await ws.close(code=4004, reason="Session not found")
        return

    await ws.accept()
    logger.info(f"WebSocket connected for session {session_id}")

    # Message queue for pushing server notifications to WebSocket
    queue: asyncio.Queue = asyncio.Queue()

    def on_update(data: dict):
        try:
            queue.put_nowait(data)
        except asyncio.QueueFull:
            pass

    session.set_update_callback(on_update)

    # Send current state immediately
    state = session.get_state()
    if state["proofView"]:
        await ws.send_json({"type": "proofView", **state["proofView"]})
    if state["highlights"]:
        await ws.send_json({"type": "highlights", **state["highlights"]})

    async def push_loop():
        """Push server notifications to WebSocket."""
        try:
            while True:
                data = await queue.get()
                await ws.send_json(data)
        except (WebSocketDisconnect, Exception):
            pass

    push_task = asyncio.create_task(push_loop())

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type")

            try:
                logger.info(f"WS recv: {msg_type}")
                if msg_type == "stepForward":
                    await session.step_forward()
                elif msg_type == "stepBackward":
                    await session.step_backward()
                elif msg_type == "interpretToPoint":
                    await session.interpret_to_point(msg.get("line", 0), msg.get("character", 0))
                elif msg_type == "interpretToEnd":
                    await session.interpret_to_end()
                elif msg_type == "change":
                    await session.update_document(msg["text"])
                else:
                    await ws.send_json({"type": "error", "message": f"Unknown type: {msg_type}"})
            except RuntimeError as e:
                logger.error(f"Coq process error: {e}")
                await ws.send_json({"type": "error", "message": f"Coq process died: {e}. Reopen the chapter to restart."})
                break
            except Exception as e:
                logger.error(f"Unexpected error handling {msg_type}: {e}")
                await ws.send_json({"type": "error", "message": str(e)})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for session {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        push_task.cancel()
        session.set_update_callback(None)


# --- File and block operations (unchanged) ---

@router.get("/coq/file/{volume_id}/{chapter_name}")
async def get_chapter_file(volume_id: str, chapter_name: str):
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")
    vol = VOLUMES[volume_id]
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {chapter_name}.v")
    content = v_file.read_text(encoding="utf-8", errors="replace")
    return {"content": content, "filename": f"{chapter_name}.v"}


@router.put("/coq/file/{volume_id}/{chapter_name}")
async def save_chapter_file(
    volume_id: str, chapter_name: str, body: dict,
    session: AsyncSession = Depends(get_session),
):
    """Save the chapter file, auto-grade, and update progress."""
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")
    content = body.get("content", "")
    if not content or len(content.strip()) < 10:
        raise HTTPException(status_code=400, detail="Refusing to save empty or near-empty content")
    vol = VOLUMES[volume_id]
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {chapter_name}.v")

    # Create .orig backup on first save (for reset functionality)
    orig_file = Path(vol["path"]) / f"{chapter_name}.v.orig"
    if not orig_file.exists():
        import shutil
        shutil.copy2(str(v_file), str(orig_file))
        logger.info(f"Created backup: {orig_file}")

    # Save
    v_file.write_text(content, encoding="utf-8")

    # Auto-grade after saving
    from server.services.grader import quick_grade
    from server.services.progress_tracker import update_progress_from_grade
    grade_result = await quick_grade(volume_id, chapter_name)
    await update_progress_from_grade(session, grade_result)

    # Build exercise status summary
    exercises = [
        {"name": ex.exercise_name, "status": ex.status, "points": ex.points_earned}
        for ex in grade_result.exercises
    ]
    completed = sum(1 for ex in grade_result.exercises if ex.status == "completed")
    total = len(grade_result.exercises)

    return {
        "status": "saved",
        "graded": True,
        "completed": completed,
        "total": total,
        "exercises": exercises,
    }


@router.post("/coq/file/{volume_id}/{chapter_name}/reset")
async def reset_chapter_file(volume_id: str, chapter_name: str):
    """Reset a chapter file to its original state."""
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")
    vol = VOLUMES[volume_id]
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    orig_file = Path(vol["path"]) / f"{chapter_name}.v.orig"

    if orig_file.exists():
        # Restore from backup
        import shutil
        shutil.copy2(str(orig_file), str(v_file))
        return {"status": "reset", "source": "backup"}
    else:
        # No backup — file is already in original state
        return {"status": "unchanged", "message": "No modifications to reset"}


@router.get("/coq/solution/{volume_id}/{chapter_name}/{exercise_name}")
async def get_exercise_solution(volume_id: str, chapter_name: str, exercise_name: str):
    """Get the sample solution for a specific exercise."""
    solutions_file = Path(__file__).resolve().parent.parent.parent / "solutions" / volume_id / f"{chapter_name}.json"
    if not solutions_file.exists():
        raise HTTPException(status_code=404, detail="No solutions available for this chapter")

    import json as json_mod
    data = json_mod.loads(solutions_file.read_text(encoding="utf-8"))
    exercises = data.get("exercises", {})
    if exercise_name not in exercises:
        raise HTTPException(status_code=404, detail=f"No solution for exercise: {exercise_name}")

    sol = exercises[exercise_name]
    return {
        "exercise_name": exercise_name,
        "solution": sol.get("solution", ""),
        "explanation": sol.get("explanation", ""),
    }


@router.get("/coq/blocks/{volume_id}/{chapter_name}")
async def get_chapter_blocks(volume_id: str, chapter_name: str):
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")
    vol = VOLUMES[volume_id]
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {chapter_name}.v")
    result = parse_blocks(v_file)
    return {
        "filename": result.filename,
        "blocks": [
            {
                "id": b.id, "kind": b.kind, "content": b.content,
                "line_start": b.line_start, "line_end": b.line_end,
                "title": b.title, "exercise_name": b.exercise_name,
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
