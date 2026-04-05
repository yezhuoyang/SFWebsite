"""JSON-RPC 2.0 transport over stdin/stdout with Content-Length framing.

Used to communicate with vscoqtop (the Coq language server).
"""

import asyncio
import json
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)


class JsonRpcTransport:
    """Manages a subprocess speaking JSON-RPC 2.0 with Content-Length headers."""

    def __init__(self):
        self.process: asyncio.subprocess.Process | None = None
        self._next_id = 1
        self._pending: dict[int, asyncio.Future] = {}
        self._notification_handlers: dict[str, list[Callable]] = {}
        self._reader_task: asyncio.Task | None = None
        self._running = False

    async def start(self, cmd: list[str], cwd: str | None = None) -> None:
        self.process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        self._running = True
        self._reader_task = asyncio.create_task(self._reader_loop())

    async def send_request(self, method: str, params: Any = None, timeout: float = 30) -> Any:
        """Send a request and wait for the response."""
        msg_id = self._next_id
        self._next_id += 1

        msg: dict[str, Any] = {"jsonrpc": "2.0", "id": msg_id, "method": method}
        if params is not None:
            msg["params"] = params

        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = future

        await self._send_raw(msg)

        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            raise TimeoutError(f"Request {method} (id={msg_id}) timed out after {timeout}s")

    @property
    def is_alive(self) -> bool:
        return self.process is not None and self.process.returncode is None

    async def send_notification(self, method: str, params: Any = None) -> None:
        """Send a notification (no response expected)."""
        if not self.is_alive:
            raise RuntimeError("Transport process is dead")
        msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        await self._send_raw(msg)

    async def send_response(self, msg_id: int | str, result: Any) -> None:
        """Send a response to a server request."""
        msg = {"jsonrpc": "2.0", "id": msg_id, "result": result}
        await self._send_raw(msg)

    def on_notification(self, method: str, handler: Callable) -> None:
        """Register a handler for a notification method."""
        if method not in self._notification_handlers:
            self._notification_handlers[method] = []
        self._notification_handlers[method].append(handler)

    def on_request(self, method: str, handler: Callable) -> None:
        """Register a handler for a server-initiated request (same as notification)."""
        self.on_notification(method, handler)

    async def _send_raw(self, msg: dict) -> None:
        if not self.process or not self.process.stdin:
            raise RuntimeError("Transport not started")
        body = json.dumps(msg)
        body_bytes = body.encode("utf-8")
        header = f"Content-Length: {len(body_bytes)}\r\n\r\n"
        self.process.stdin.write(header.encode("ascii") + body_bytes)
        await self.process.stdin.drain()

    async def _reader_loop(self) -> None:
        """Background loop reading messages from stdout."""
        buf = b""
        stdout = self.process.stdout
        if not stdout:
            return

        while self._running:
            try:
                chunk = await asyncio.wait_for(stdout.read(8192), timeout=1.0)
                if not chunk:
                    logger.info("vscoqtop stdout closed")
                    break
                buf += chunk

                # Parse complete messages from buffer
                while True:
                    idx = buf.find(b"Content-Length:")
                    if idx < 0:
                        break
                    end_header = buf.find(b"\r\n\r\n", idx)
                    if end_header < 0:
                        break
                    length = int(buf[idx:end_header].split(b":")[1].strip())
                    body_start = end_header + 4
                    if len(buf) < body_start + length:
                        break  # incomplete body
                    body = buf[body_start:body_start + length]
                    buf = buf[body_start + length:]

                    try:
                        msg = json.loads(body)
                        self._dispatch(msg)
                    except json.JSONDecodeError as e:
                        logger.error(f"JSON parse error: {e}")

            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Reader loop error: {e}")
                break

    def _dispatch(self, msg: dict) -> None:
        """Route an incoming message to the appropriate handler."""
        if "id" in msg and "method" not in msg:
            # Response to our request
            msg_id = msg["id"]
            future = self._pending.pop(msg_id, None)
            if future and not future.done():
                if "error" in msg:
                    future.set_exception(
                        RuntimeError(f"RPC error: {msg['error'].get('message', msg['error'])}")
                    )
                else:
                    future.set_result(msg.get("result"))
        elif "method" in msg and "id" in msg:
            # Server-initiated request (needs response)
            method = msg["method"]
            handlers = self._notification_handlers.get(method, [])
            for handler in handlers:
                try:
                    handler(msg)
                except Exception as e:
                    logger.error(f"Handler error for {method}: {e}")
        elif "method" in msg:
            # Notification from server
            method = msg["method"]
            handlers = self._notification_handlers.get(method, [])
            for handler in handlers:
                try:
                    handler(msg)
                except Exception as e:
                    logger.error(f"Handler error for {method}: {e}")

    async def shutdown(self) -> None:
        self._running = False
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass
        if self.process:
            try:
                if self.process.stdin:
                    self.process.stdin.close()
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except (asyncio.TimeoutError, ProcessLookupError):
                self.process.kill()
            self.process = None
