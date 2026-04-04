"""SerAPI (sertop) session manager for interactive Coq proof state.

Manages a persistent sertop subprocess, sends S-expression commands,
and parses responses to extract goals, hypotheses, and errors.
"""

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from server.config import COQLIB_PATH, SERTOP_PATH, VOLUMES

logger = logging.getLogger(__name__)


@dataclass
class CoqGoal:
    hypotheses: list[str]
    conclusion: str


@dataclass
class StepResult:
    sid: int
    goals: list[CoqGoal] | None = None
    error: str | None = None


@dataclass
class AddedSentence:
    sid: int
    bp: int  # byte position start
    ep: int  # byte position end


class SertopSession:
    """Manages an interactive sertop process for one editing session."""

    def __init__(self, session_id: str | None = None):
        self.session_id = session_id or str(uuid.uuid4())[:8]
        self.process: asyncio.subprocess.Process | None = None
        self.volume_id: str | None = None
        self._answer_counter = 0
        self._sentences: list[AddedSentence] = []
        self._last_exec_sid = 0
        self._read_lock = asyncio.Lock()

    async def start(self, volume_id: str) -> None:
        """Start a sertop subprocess for the given volume."""
        if volume_id not in VOLUMES:
            raise ValueError(f"Unknown volume: {volume_id}")

        self.volume_id = volume_id
        vol = VOLUMES[volume_id]
        vol_path = str(vol["path"])

        cmd = [
            str(SERTOP_PATH),
            f"--coqlib={COQLIB_PATH}",
            "--printer=human",
        ]
        # Add -Q flag for the volume namespace
        for i in range(0, len(vol["coq_flags"]), 2):
            flag = vol["coq_flags"][i]
            if flag == "-Q":
                val = vol["coq_flags"][i + 1]
                cmd.append(f"-Q {val},{vol['namespace']}" if val == "." else f"-Q {val}")
            elif flag == "-w":
                cmd.extend(["-w", vol["coq_flags"][i + 1]])

        # Use --print0 for reliable message delimiting
        cmd.append("--print0")

        logger.info(f"Starting sertop: {' '.join(cmd)} in {vol_path}")

        self.process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=vol_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Wait for initial Feedback messages (Prelude loading) to settle
        await self._drain_until_ready(timeout=30)

    async def _send(self, command: str) -> None:
        """Send a command to sertop's stdin."""
        if not self.process or self.process.stdin is None:
            raise RuntimeError("Sertop process not running")
        self.process.stdin.write((command + "\n").encode())
        await self.process.stdin.drain()

    async def _read_responses(self, timeout: float = 30) -> list[str]:
        """Read all responses until (Answer N Completed), using \\0 delimiter."""
        if not self.process or self.process.stdout is None:
            raise RuntimeError("Sertop process not running")

        responses = []
        buffer = b""

        try:
            while True:
                chunk = await asyncio.wait_for(
                    self.process.stdout.read(4096),
                    timeout=timeout,
                )
                if not chunk:
                    break
                buffer += chunk

                # Split on \0 delimiter
                while b"\0" in buffer:
                    msg, buffer = buffer.split(b"\0", 1)
                    decoded = msg.decode("utf-8", errors="replace").strip()
                    if decoded:
                        responses.append(decoded)
                        # Check if we got the final Completed for our answer
                        if "Completed)" in decoded:
                            return responses
        except asyncio.TimeoutError:
            logger.warning(f"Timeout reading sertop responses. Got {len(responses)} so far.")

        return responses

    async def _drain_until_ready(self, timeout: float = 30) -> None:
        """Drain initial Feedback messages after startup."""
        if not self.process or self.process.stdout is None:
            return

        buffer = b""
        try:
            deadline = asyncio.get_event_loop().time() + timeout
            while asyncio.get_event_loop().time() < deadline:
                remaining = deadline - asyncio.get_event_loop().time()
                chunk = await asyncio.wait_for(
                    self.process.stdout.read(4096),
                    timeout=min(remaining, 2.0),
                )
                if not chunk:
                    break
                buffer += chunk
                # Once we stop getting data quickly, assume prelude is loaded
                if b"\0" in buffer:
                    # Check if the last message is a Feedback (not Answer)
                    parts = buffer.split(b"\0")
                    last_meaningful = [p for p in parts if p.strip()]
                    if last_meaningful and b"Feedback" in last_meaningful[-1]:
                        # Might be more coming, keep reading
                        continue
                    break
        except asyncio.TimeoutError:
            pass
        logger.info("Sertop prelude loaded")

    async def add(self, code: str) -> list[AddedSentence]:
        """Add Coq code, returns list of sentence IDs assigned by sertop."""
        # Escape quotes in the code for S-expression string
        escaped = code.replace("\\", "\\\\").replace('"', '\\"')
        cmd = f'(Add () "{escaped}")'

        async with self._read_lock:
            await self._send(cmd)
            responses = await self._read_responses()

        sentences = []
        for resp in responses:
            # Parse: (Answer N (Added SID ((fname...) ... (bp X) (ep Y)) NewAddTip))
            added_match = re.search(r'\(Added\s+(\d+)', resp)
            if added_match:
                sid = int(added_match.group(1))
                bp_match = re.search(r'\(bp\s+(\d+)\)', resp)
                ep_match = re.search(r'\(ep\s+(\d+)\)', resp)
                bp = int(bp_match.group(1)) if bp_match else 0
                ep = int(ep_match.group(1)) if ep_match else 0
                s = AddedSentence(sid=sid, bp=bp, ep=ep)
                sentences.append(s)
                self._sentences.append(s)

        self._answer_counter += 1
        return sentences

    async def exec_sid(self, sid: int) -> str | None:
        """Execute through the given sentence ID. Returns error string or None."""
        cmd = f"(Exec {sid})"

        async with self._read_lock:
            await self._send(cmd)
            responses = await self._read_responses()

        self._answer_counter += 1
        self._last_exec_sid = sid

        # Check for errors
        error = self._extract_error(responses)
        return error

    async def goals(self, sid: int | None = None) -> list[CoqGoal]:
        """Query goals at the given (or last executed) sentence ID."""
        target_sid = sid if sid is not None else self._last_exec_sid
        cmd = f'(Query ((sid {target_sid}) (pp ((pp_format PpStr)))) Goals)'

        async with self._read_lock:
            await self._send(cmd)
            responses = await self._read_responses()

        self._answer_counter += 1
        return self._parse_goals(responses)

    async def step(self, code: str) -> StepResult:
        """Convenience: Add + Exec one tactic + query Goals."""
        sentences = await self.add(code)
        if not sentences:
            return StepResult(sid=self._last_exec_sid, error="No sentences parsed from input")

        last_sid = sentences[-1].sid

        # Execute all added sentences
        error = None
        for s in sentences:
            error = await self.exec_sid(s.sid)
            if error:
                return StepResult(sid=s.sid, error=error)

        # Query goals after execution
        goals = await self.goals(last_sid)
        return StepResult(sid=last_sid, goals=goals)

    async def cancel(self, sid: int) -> None:
        """Cancel (undo) back to before the given sentence ID."""
        cmd = f"(Cancel ({sid}))"

        async with self._read_lock:
            await self._send(cmd)
            responses = await self._read_responses()

        self._answer_counter += 1
        # Remove cancelled sentences from our tracking
        self._sentences = [s for s in self._sentences if s.sid < sid]
        if self._sentences:
            self._last_exec_sid = self._sentences[-1].sid
        else:
            self._last_exec_sid = 0

    async def shutdown(self) -> None:
        """Cleanly close the sertop subprocess."""
        if self.process:
            try:
                if self.process.stdin:
                    self.process.stdin.close()
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except (asyncio.TimeoutError, ProcessLookupError):
                self.process.kill()
            self.process = None
            logger.info(f"Sertop session {self.session_id} closed")

    @property
    def last_sid(self) -> int:
        return self._last_exec_sid

    @property
    def sentence_ids(self) -> list[int]:
        return [s.sid for s in self._sentences]

    def _extract_error(self, responses: list[str]) -> str | None:
        """Extract human-readable error from CoqExn responses."""
        for resp in responses:
            if "CoqExn" in resp:
                # Look for (str "...") which has the human-readable error
                str_match = re.search(r'\(str\s+"(.+?)"\)', resp, re.DOTALL)
                if str_match:
                    msg = str_match.group(1)
                    # Clean up sertop escaping
                    msg = re.sub(r'\\\r?\n\s*', '', msg)  # continuation lines
                    msg = msg.replace("\\n", "\n")
                    msg = msg.replace('\\"', '"').replace("\\\\", "\\")
                    return msg.strip()
                return "Coq error (could not parse details)"
        return None

    def _parse_goals(self, responses: list[str]) -> list[CoqGoal]:
        """Parse pretty-printed goals from Query Goals response.

        Sertop returns goals in a CoqString with escaped newlines (\\n) and
        continuation lines (backslash + CRLF + whitespace). We must:
        1. Remove continuation line breaks (backslash at EOL + following whitespace)
        2. Convert \\n to actual newlines
        3. Split goals by ============================ separator
        """
        for resp in responses:
            if "CoqString" not in resp:
                continue

            # Extract the string content between quotes after CoqString
            # Handle multiline sertop output with continuation lines
            match = re.search(r'\(CoqString\s+(.*?)\)\)', resp, re.DOTALL)
            if not match:
                continue

            raw = match.group(1).strip()
            # Remove surrounding quotes
            if raw.startswith('"') and raw.endswith('"'):
                raw = raw[1:-1]

            # Step 1: Remove continuation lines (\ followed by \r\n and leading whitespace)
            raw = re.sub(r'\\\r?\n\s*', '', raw)

            # Step 2: Convert escaped newlines to real newlines
            raw = raw.replace("\\n", "\n")

            # Step 3: Unescape other sequences
            raw = raw.replace('\\"', '"').replace("\\\\", "\\")

            if not raw.strip():
                return []

            # Split into individual goals by ============================ separator
            # Each goal has: [hypotheses\n]============================\nconclusion
            # Multiple goals are separated by blank lines
            parts = re.split(r'={4,}', raw)

            # Parts alternate: hyp1, conclusion1 + gap + hyp2, conclusion2, ...
            # First part is hypotheses for first goal
            # Subsequent parts contain conclusion of prev goal + hypotheses of next goal
            goals = []
            if len(parts) < 2:
                return []

            # First hypothesis block
            prev_hyps = parts[0]

            for i in range(1, len(parts)):
                section = parts[i]

                # Split this section: first part is conclusion, rest (after blank line) is next hyps
                # A blank line separates goals
                goal_split = re.split(r'\n\n', section, maxsplit=1)

                conclusion = goal_split[0].strip()

                # Parse hypotheses from previous section
                hypotheses = []
                for line in prev_hyps.strip().split("\n"):
                    line = line.strip()
                    if line and line != "none":
                        hypotheses.append(line)

                goals.append(CoqGoal(
                    hypotheses=hypotheses,
                    conclusion=conclusion,
                ))

                # If there's a next hypothesis block, save it
                if len(goal_split) > 1:
                    prev_hyps = goal_split[1]
                else:
                    prev_hyps = ""

            return goals

        # Empty goals list means proof is complete or no proof in progress
        return []


# Session pool for managing multiple concurrent sessions
class SessionPool:
    """Manages a pool of SertopSession instances."""

    def __init__(self):
        self._sessions: dict[str, SertopSession] = {}

    async def create(self, volume_id: str) -> SertopSession:
        session = SertopSession()
        await session.start(volume_id)
        self._sessions[session.session_id] = session
        return session

    def get(self, session_id: str) -> SertopSession | None:
        return self._sessions.get(session_id)

    async def close(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session:
            await session.shutdown()

    async def close_all(self) -> None:
        for session in list(self._sessions.values()):
            await session.shutdown()
        self._sessions.clear()


# Global session pool
pool = SessionPool()
