"""Live presence: track which users are currently viewing each chapter."""

import time
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from server.models import User
from server.routers.auth import get_current_user, get_optional_user

router = APIRouter(tags=["presence"])

# In-memory presence store (no DB needed — ephemeral)
# Key: "volume_id:chapter_name" → {user_id: {username, display_name, color, last_seen}}
_presence: dict[str, dict[int, dict]] = {}

PRESENCE_TIMEOUT = 30  # seconds before a user is considered gone

# Deterministic avatar colors based on user_id
AVATAR_COLORS = [
    "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
]


class HeartbeatRequest(BaseModel):
    volume_id: str
    chapter_name: str


def _clean_stale(key: str):
    """Remove users who haven't sent a heartbeat recently."""
    now = time.time()
    if key in _presence:
        _presence[key] = {
            uid: info for uid, info in _presence[key].items()
            if now - info["last_seen"] < PRESENCE_TIMEOUT
        }
        if not _presence[key]:
            del _presence[key]


def _user_list(key: str) -> list[dict]:
    _clean_stale(key)
    entries = _presence.get(key, {})
    return [
        {
            "user_id": uid,
            "username": info["username"],
            "display_name": info["display_name"],
            "color": info["color"],
        }
        for uid, info in entries.items()
    ]


@router.post("/presence/heartbeat")
async def heartbeat(
    req: HeartbeatRequest,
    user: User = Depends(get_current_user),
):
    key = f"{req.volume_id}:{req.chapter_name}"
    if key not in _presence:
        _presence[key] = {}

    _presence[key][user.id] = {
        "username": user.username,
        "display_name": user.display_name or user.username,
        "color": AVATAR_COLORS[user.id % len(AVATAR_COLORS)],
        "last_seen": time.time(),
    }

    return {"users": _user_list(key)}


@router.get("/presence")
async def get_presence(
    volume_id: str = Query(...),
    chapter_name: str = Query(...),
    _user: User | None = Depends(get_optional_user),
):
    key = f"{volume_id}:{chapter_name}"
    return {"users": _user_list(key)}
