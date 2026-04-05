"""vscoqtop session manager with session limits and idle reaper.

Each session spawns a vscoqtop language server process (~200MB RAM).
The pool enforces MAX_SESSIONS and kills idle sessions after SESSION_IDLE_TIMEOUT.
"""

import asyncio
import logging
import platform
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from server.config import COQLIB_PATH, MAX_SESSIONS, SESSION_IDLE_TIMEOUT, VOLUMES, VSCOQTOP_PATH
from server.services.jsonrpc_transport import JsonRpcTransport

logger = logging.getLogger(__name__)


def make_file_uri(path: str) -> str:
    """Convert a file path to a file URI matching vscoqtop's format.

    Windows: file:///c%3A/Users/... (lowercase drive, encoded colon)
    Linux:   file:///home/user/...
    """
    p = path.replace("\\", "/")
    if platform.system() == "Windows" and len(p) > 1 and p[1] == ":":
        p = p[0].lower() + "%3A" + p[2:]
    return "file:///" + p


DEFAULT_CONFIG = {
    "proof": {
        "mode": 0,
        "delegation": "None",
        "workers": 1,
        "block": False,
        "pointInterpretationMode": 0,
    },
    "goals": {
        "diff": {"mode": "off"},
        "messages": {"full": True},
    },
    "completion": {
        "enable": False,
        "algorithm": 0,
        "unificationLimit": 100,
        "atomicFactor": 5.0,
        "sizeFactor": 5.0,
    },
    "diagnostics": {"enable": True, "full": True},
    "memory": {"limit": 2000000000},  # 2GB per session (conservative for shared server)
}


class VscoqtopSession:
    """Manages one vscoqtop process for one Coq document."""

    def __init__(self, session_id: str | None = None):
        self.session_id = session_id or str(uuid.uuid4())[:8]
        self.transport = JsonRpcTransport()
        self.uri: str = ""
        self.version: int = 0
        self.document_text: str = ""
        self.volume_id: str = ""
        self.last_activity: float = time.time()

        self.latest_proof_view: dict | None = None
        self.latest_highlights: dict | None = None
        self.latest_diagnostics: list = []

        self._on_update: Callable | None = None

    def _touch(self):
        """Update last activity timestamp."""
        self.last_activity = time.time()

    async def start(self, volume_id: str, chapter_name: str, workspace_path: Path | None = None) -> None:
        """Start vscoqtop, initialize LSP, and open the document.

        Args:
            workspace_path: If set, use this path for .v files (per-user workspace).
                           Otherwise use the default volume path.
        """
        if volume_id not in VOLUMES:
            raise ValueError(f"Unknown volume: {volume_id}")

        self.volume_id = volume_id
        vol = VOLUMES[volume_id]
        vol_path = str(workspace_path if workspace_path else vol["path"])

        v_file = Path(vol_path) / f"{chapter_name}.v"
        if not v_file.exists():
            raise FileNotFoundError(f"{chapter_name}.v not found in {vol_path}")

        self.uri = make_file_uri(str(v_file))
        self.document_text = v_file.read_text(encoding="utf-8", errors="replace")
        self.version = 1

        root_uri = make_file_uri(vol_path)

        # Build command — vscoqtop binary
        cmd = [str(VSCOQTOP_PATH)]

        await self.transport.start(cmd, cwd=vol_path)

        self.transport.on_notification("vscoq/proofView", self._on_proof_view)
        self.transport.on_notification("vscoq/updateHighlights", self._on_highlights)
        self.transport.on_notification("vscoq/moveCursor", self._on_move_cursor)
        self.transport.on_notification("textDocument/publishDiagnostics", self._on_diagnostics)
        self.transport.on_notification("workspace/configuration", self._on_config_request)

        result = await self.transport.send_request("initialize", {
            "processId": None,
            "capabilities": {},
            "rootUri": root_uri,
        })
        logger.info(f"vscoqtop initialized: {result.get('serverInfo', {})}")

        await self.transport.send_notification("initialized", {})
        await asyncio.sleep(1.5)

        await self.transport.send_notification("textDocument/didOpen", {
            "textDocument": {
                "uri": self.uri,
                "languageId": "rocq",
                "version": self.version,
                "text": self.document_text,
            }
        })
        await asyncio.sleep(2)
        self._touch()
        logger.info(f"Session {self.session_id} ready: {chapter_name}.v")

    def set_update_callback(self, callback: Callable) -> None:
        self._on_update = callback

    async def step_forward(self) -> None:
        self._touch()
        await self.transport.send_notification("vscoq/stepForward", {
            "textDocument": {"uri": self.uri, "version": self.version},
        })

    async def step_backward(self) -> None:
        self._touch()
        await self.transport.send_notification("vscoq/stepBackward", {
            "textDocument": {"uri": self.uri, "version": self.version},
        })

    async def interpret_to_point(self, line: int, character: int) -> None:
        self._touch()
        await self.transport.send_notification("vscoq/interpretToPoint", {
            "textDocument": {"uri": self.uri, "version": self.version},
            "position": {"line": line, "character": character},
        })

    async def interpret_to_end(self) -> None:
        self._touch()
        await self.transport.send_notification("vscoq/interpretToEnd", {
            "textDocument": {"uri": self.uri, "version": self.version},
        })

    async def update_document(self, new_text: str) -> None:
        self._touch()
        old_lines = self.document_text.split("\n")
        old_last_line = len(old_lines) - 1
        old_last_char = len(old_lines[-1]) if old_lines else 0

        self.version += 1
        self.document_text = new_text
        await self.transport.send_notification("textDocument/didChange", {
            "textDocument": {"uri": self.uri, "version": self.version},
            "contentChanges": [{
                "range": {
                    "start": {"line": 0, "character": 0},
                    "end": {"line": old_last_line, "character": old_last_char},
                },
                "text": new_text,
            }],
        })

    def get_state(self) -> dict:
        return {
            "proofView": self.latest_proof_view,
            "highlights": self.latest_highlights,
            "diagnostics": self.latest_diagnostics,
        }

    async def shutdown(self) -> None:
        await self.transport.shutdown()
        logger.info(f"Session {self.session_id} closed")

    def _on_proof_view(self, msg: dict) -> None:
        self.latest_proof_view = msg.get("params", {})
        self._push_update("proofView", self.latest_proof_view)

    def _on_highlights(self, msg: dict) -> None:
        self.latest_highlights = msg.get("params", {})
        self._push_update("highlights", self.latest_highlights)

    def _on_move_cursor(self, msg: dict) -> None:
        self._push_update("moveCursor", msg.get("params", {}))

    def _on_diagnostics(self, msg: dict) -> None:
        self.latest_diagnostics = msg.get("params", {}).get("diagnostics", [])
        self._push_update("diagnostics", {"items": self.latest_diagnostics})

    def _on_config_request(self, msg: dict) -> None:
        msg_id = msg.get("id")
        if msg_id is not None:
            asyncio.create_task(
                self.transport.send_response(msg_id, [DEFAULT_CONFIG])
            )

    def _push_update(self, update_type: str, data: Any) -> None:
        if self._on_update:
            try:
                self._on_update({"type": update_type, **data})
            except Exception as e:
                logger.error(f"Push update error: {e}")


class SessionPool:
    """Manages VscoqtopSession instances with limits and idle reaping."""

    def __init__(self):
        self._sessions: dict[str, VscoqtopSession] = {}
        self._reaper_task: asyncio.Task | None = None

    def _ensure_reaper(self):
        """Start the idle reaper if not already running."""
        if self._reaper_task is None or self._reaper_task.done():
            self._reaper_task = asyncio.create_task(self._reap_idle_sessions())

    async def _reap_idle_sessions(self):
        """Background task: close sessions idle for > SESSION_IDLE_TIMEOUT."""
        while True:
            await asyncio.sleep(60)
            now = time.time()
            to_close = [
                sid for sid, s in self._sessions.items()
                if now - s.last_activity > SESSION_IDLE_TIMEOUT
            ]
            for sid in to_close:
                logger.info(f"Reaping idle session {sid} (idle {int(now - self._sessions[sid].last_activity)}s)")
                await self.close(sid)

    async def create(self, volume_id: str, chapter_name: str, workspace_path: Path | None = None) -> VscoqtopSession:
        self._ensure_reaper()

        if len(self._sessions) >= MAX_SESSIONS:
            # Try to reap the oldest idle session
            oldest = min(self._sessions.values(), key=lambda s: s.last_activity)
            if time.time() - oldest.last_activity > 60:
                logger.info(f"Max sessions ({MAX_SESSIONS}) reached, evicting oldest: {oldest.session_id}")
                await self.close(oldest.session_id)
            else:
                raise RuntimeError(
                    f"Maximum concurrent sessions ({MAX_SESSIONS}) reached. "
                    f"Please close an existing chapter or wait."
                )

        session = VscoqtopSession()
        await session.start(volume_id, chapter_name, workspace_path)
        self._sessions[session.session_id] = session
        logger.info(f"Session created: {session.session_id} ({len(self._sessions)}/{MAX_SESSIONS} active)")
        return session

    def get(self, session_id: str) -> VscoqtopSession | None:
        s = self._sessions.get(session_id)
        if s:
            s._touch()
        return s

    async def close(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session:
            await session.shutdown()
            logger.info(f"Session closed: {session_id} ({len(self._sessions)}/{MAX_SESSIONS} active)")

    async def close_all(self) -> None:
        if self._reaper_task:
            self._reaper_task.cancel()
        for session in list(self._sessions.values()):
            await session.shutdown()
        self._sessions.clear()

    @property
    def active_count(self) -> int:
        return len(self._sessions)


pool = SessionPool()
