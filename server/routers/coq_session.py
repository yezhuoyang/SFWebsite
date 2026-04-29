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

from server.config import MAX_SESSIONS, SESSION_IDLE_TIMEOUT, VOLUMES
from server.routers.auth import get_optional_user
from server.database import get_session
get_db_session = get_session  # alias for clarity in solution endpoint
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


@router.get("/coq/session/{session_id}/info")
async def session_info(session_id: str):
    """Get session status: remaining timeout, active session count.
    Does NOT touch the session — read-only query."""
    import time as _time
    # Use _sessions dict directly to avoid _touch() resetting the timer
    session = pool._sessions.get(session_id)
    remaining = 0
    if session:
        idle = _time.time() - session.last_activity
        remaining = max(0, int(SESSION_IDLE_TIMEOUT - idle))
    return {
        "active_count": pool.active_count,
        "max_sessions": MAX_SESSIONS,
        "remaining_seconds": remaining,
        "timeout_seconds": SESSION_IDLE_TIMEOUT,
    }


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
                elif msg_type == "ping":
                    session._touch()
                    await ws.send_json({"type": "pong"})
                elif msg_type == "interrupt":
                    await session.interrupt()
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
async def get_chapter_file(
    volume_id: str, chapter_name: str,
    user: "User | None" = Depends(get_optional_user),
):
    """Read the user's last-saved chapter file. Returns the per-user
    workspace copy when authenticated, falling back to the unmodified
    global template for anonymous visitors."""
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")
    user_id = user.id if user else None
    # Per-user workspace (or global template for anonymous).
    vp = _user_vol_path(user_id, volume_id) if user_id else Path(VOLUMES[volume_id]["path"])
    v_file = vp / f"{chapter_name}.v"
    if not v_file.exists():
        # Fallback to global template — useful when a logged-in user
        # has touched some chapters but not this one yet.
        global_v = Path(VOLUMES[volume_id]["path"]) / f"{chapter_name}.v"
        if not global_v.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {chapter_name}.v")
        v_file = global_v
    content = v_file.read_text(encoding="utf-8", errors="replace")
    return {"content": content, "filename": f"{chapter_name}.v"}


@router.get("/coq/file/{volume_id}/{chapter_name}/blocks")
async def get_chapter_blocks(
    volume_id: str, chapter_name: str,
    user: "User | None" = Depends(get_optional_user),
):
    """Extract the current user's last-submitted code blocks from the
    saved chapter .v in their workspace. Returns empty blocks for
    anonymous visitors, or for users who haven't submitted this
    chapter yet — that way the iframe falls back to the upstream
    default text."""
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")
    user_id = user.id if user else None
    if user_id is None:
        # Don't expose any other user's saved file to anonymous visitors.
        return {"blocks": [], "filename": f"{chapter_name}.v"}
    vp = _user_vol_path(user_id, volume_id)
    v_file = vp / f"{chapter_name}.v"
    if not v_file.exists():
        return {"blocks": [], "filename": f"{chapter_name}.v"}
    text = v_file.read_text(encoding="utf-8", errors="replace")

    from server.services.coq_splice import split_segments, is_substantive_code
    segments = split_segments(text)
    # Strip the leading newline / trailing newline reassemble_v_from_html
    # adds around each user block so the restored content matches what
    # the user originally typed (more or less).
    blocks = [
        s.text.strip('\n')
        for s in segments
        if s.kind == 'code' and is_substantive_code(s.text)
    ]
    return {"blocks": blocks, "filename": f"{chapter_name}.v"}


@router.get("/coq/imports/{volume_id}/{chapter_name}")
async def get_chapter_imports(volume_id: str, chapter_name: str):
    """Resolve every `From X Require Import Y` in this chapter into a flat
    list of identifiers the user can reference. Two sources:
      - same-volume sibling chapters (auto-extracted from their .v files)
      - curated catalog of common Coq stdlib modules
    Returns entries grouped by source module so the UI can attribute them.
    """
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")
    from server.services.imports import get_imported_entries
    entries = get_imported_entries(volume_id, chapter_name)
    return {
        "entries": [
            {
                "kind": e.kind,
                "name": e.name,
                "signature": e.signature,
                "module": e.module,
                "chapter_name": e.chapter_name,
                "import_line": e.import_line,
            }
            for e in entries
        ],
    }


def _user_vol_path(user_id: int | None, volume_id: str) -> Path:
    """Per-user volume directory. Each user grades against their own
    copy of the chapter files so submissions don't leak between users.
    Lazily initialized: copies the global vol's .v / .vo / .glob /
    Makefile / _CoqProject the first time the user touches it.
    Anonymous users (no auth) fall back to the global vol — they
    can't persist anything anyway."""
    from server.config import WORKSPACES_DIR
    vol = VOLUMES[volume_id]
    if user_id is None:
        return Path(vol["path"])
    user_vol = WORKSPACES_DIR / str(user_id) / volume_id
    if user_vol.exists():
        return user_vol
    user_vol.mkdir(parents=True, exist_ok=True)
    src = Path(vol["path"])
    if src.exists():
        import shutil
        for f in src.iterdir():
            if f.is_file() and (
                f.suffix in (".v", ".vo", ".glob", ".vos", ".vok")
                or f.name in ("Makefile", "Makefile.coq", "_CoqProject", "LICENSE")
            ):
                shutil.copy2(str(f), str(user_vol / f.name))
    return user_vol


async def _save_and_grade_internal(
    volume_id: str, chapter_name: str, content: str,
    target_exercise: str | None,
    user: "User | None",
    session: AsyncSession,
) -> dict:
    """Shared core: save the chapter file, run the grader, persist
    progress for the current user. Both the legacy `PUT /coq/file/...`
    and the new `POST /coq/file/.../blocks` (same-origin iframe path)
    funnel into this."""
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")
    if not content or len(content.strip()) < 10:
        raise HTTPException(status_code=400, detail="Refusing to save empty or near-empty content")
    user_id = user.id if user else None
    vp = _user_vol_path(user_id, volume_id)
    v_file = vp / f"{chapter_name}.v"
    if not v_file.exists():
        # Workspace was missing this chapter — fall back to the global
        # template if it exists so we have something to save against.
        global_v = Path(VOLUMES[volume_id]["path"]) / f"{chapter_name}.v"
        if global_v.exists():
            import shutil
            shutil.copy2(str(global_v), str(v_file))
        else:
            raise HTTPException(status_code=404, detail=f"File not found: {chapter_name}.v")

    # Create .orig backup on first save (for reset + splice).
    orig_file = vp / f"{chapter_name}.v.orig"
    if not orig_file.exists():
        import shutil
        shutil.copy2(str(v_file), str(orig_file))
        logger.info(f"Created backup: {orig_file}")

    v_file.write_text(content, encoding="utf-8")

    from server.services.grader import full_grade, full_grade_exercise
    from server.services.progress_tracker import update_progress_from_grade

    if target_exercise:
        grade_result = await full_grade_exercise(volume_id, chapter_name, target_exercise, vp)
    else:
        grade_result = await full_grade(volume_id, chapter_name, vp)

    await update_progress_from_grade(session, grade_result, user_id)

    exercises = [
        {
            "name": ex.exercise_name,
            "status": ex.status,
            "points": ex.points_earned,
            "feedback": ex.feedback,
            "error_detail": ex.error_detail,
        }
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
        "compile_output": grade_result.compile_output,
    }


@router.put("/coq/file/{volume_id}/{chapter_name}")
async def save_chapter_file(
    volume_id: str, chapter_name: str, body: dict,
    user: "User | None" = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
):
    """Save the chapter file, auto-grade, and update progress.

    Body fields:
        content:          full chapter text (required)
        target_exercise:  optional exercise name — if given, compile ONLY up
                          to (and including) that exercise, and return grading
                          for just that one. This is what the per-exercise
                          "Submit & Grade" button uses.
    """
    content = body.get("content", "")
    target_exercise = body.get("target_exercise")
    return await _save_and_grade_internal(
        volume_id, chapter_name, content, target_exercise, user, session,
    )


@router.post("/coq/file/{volume_id}/{chapter_name}/blocks")
async def grade_from_blocks(
    volume_id: str, chapter_name: str, body: dict,
    user: "User | None" = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
):
    """Grade a chapter from per-block edits read from the same-origin SF
    iframe. The client sends the user-edited contents of every
    `<div class="code">` (one CodeMirror instance each) in document
    order, and we splice them into the corresponding code regions of
    the original chapter `.v.orig` (preserving prose comments + Exercise
    headers — both are critical for the grader).

    Body fields:
        blocks: list[str]            — one entry per editable code block,
                                        in document order. Required.
        target_exercise: str | None  — same as the legacy endpoint.
    """
    if volume_id not in VOLUMES:
        raise HTTPException(status_code=404, detail=f"Unknown volume: {volume_id}")
    blocks = body.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        raise HTTPException(status_code=400, detail="Body must include a non-empty `blocks` list")
    target_exercise = body.get("target_exercise")
    user_id = user.id if user else None
    # Splice templates can come from either the per-user workspace (so
    # users don't see each other's local .v.orig if it ever differs)
    # or the global volume — the upstream-HTML path is preferred either
    # way, but we want the fallback to also be user-isolated.
    vp = _user_vol_path(user_id, volume_id) if user_id else Path(VOLUMES[volume_id]["path"])
    v_file = vp / f"{chapter_name}.v"
    orig_file = vp / f"{chapter_name}.v.orig"
    if not v_file.exists():
        # User workspace missing this chapter — fall back to global template.
        global_v = Path(VOLUMES[volume_id]["path"]) / f"{chapter_name}.v"
        if not global_v.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {chapter_name}.v")
        v_file = global_v
        orig_file = Path(VOLUMES[volume_id]["path"]) / f"{chapter_name}.v.orig"

    from server.services.coq_splice import (
        splice_blocks, reassemble_v_from_html, SpliceError,
    )

    # Preferred path: splice into our LOCAL .v.orig template. That's
    # the version of SF compiled by our Coq 8.17 (clean), so the
    # resulting file is guaranteed to compile here. Upstream
    # coq.vercel.app's HTML may use a different (newer) SF revision
    # whose Coq stdlib usage doesn't match ours — `apply minus_diag`,
    # for instance, was renamed to `Nat.sub_diag` and would fail
    # locally. The trade-off: block boundaries may differ slightly
    # between upstream HTML's `<div class=code>` count and our
    # local .v.orig's segments, so user edits to specific blocks may
    # land at adjacent positions. `splice_blocks` tolerates that
    # drift (up to 5 blocks).
    content: str | None = None
    template_file = orig_file if orig_file.exists() else v_file
    if template_file.exists():
        template_text = template_file.read_text(encoding="utf-8", errors="replace")
        try:
            content = splice_blocks(template_text, [str(b) for b in blocks])
        except SpliceError as e:
            logger.info("local .v.orig splice failed (%s); trying upstream HTML", e)
            content = None

    # Fallback path: rebuild from upstream chapter HTML. Used when
    # local .v.orig is missing or has more drift than splice_blocks
    # can absorb. Block alignment is 1:1 with the iframe but the
    # resulting Coq may not compile under our local stdlib.
    if content is None:
        try:
            import httpx
            from server.routers.sf_proxy import UPSTREAM
            upstream_path = f"{UPSTREAM}/ext/sf/{volume_id}/full/{chapter_name}.html"
            async with httpx.AsyncClient(timeout=30.0) as fc:
                r = await fc.get(upstream_path, headers={"Accept-Encoding": "gzip, deflate"})
            if r.status_code == 200:
                content = reassemble_v_from_html(r.text, [str(b) for b in blocks])
        except SpliceError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except Exception as e:
            logger.warning("upstream HTML fetch for splice failed: %s", e)

    if content is None:
        raise HTTPException(
            status_code=500,
            detail="Couldn't reconstruct chapter source for grading.",
        )

    return await _save_and_grade_internal(
        volume_id, chapter_name, content, target_exercise, user, session,
    )


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
async def get_exercise_solution(
    volume_id: str, chapter_name: str, exercise_name: str,
    user: "User | None" = Depends(get_optional_user),
    session: "AsyncSession" = Depends(get_db_session),
):
    """Get the sample solution — only if the user has solved the exercise."""
    from server.models import Progress, Exercise, Chapter
    from sqlalchemy import select

    # Check if user has solved this exercise
    if user:
        ch = (await session.execute(
            select(Chapter).where(Chapter.volume_id == volume_id, Chapter.name == chapter_name)
        )).scalar_one_or_none()
        if ch:
            ex = (await session.execute(
                select(Exercise).where(Exercise.chapter_id == ch.id, Exercise.name == exercise_name)
            )).scalar_one_or_none()
            if ex:
                progress = (await session.execute(
                    select(Progress).where(
                        Progress.user_id == user.id, Progress.exercise_id == ex.id,
                        Progress.status == "completed",
                    )
                )).scalar_one_or_none()
                if not progress:
                    raise HTTPException(status_code=403, detail="Solve this exercise first to see the solution")
    else:
        raise HTTPException(status_code=401, detail="Login required to view solutions")

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
