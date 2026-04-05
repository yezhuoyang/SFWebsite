"""User authentication: register, login, JWT tokens."""

import shutil
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from server.config import (
    BASE_DIR, JWT_ALGORITHM, JWT_EXPIRE_HOURS, JWT_SECRET, VOLUMES, WORKSPACES_DIR,
)
from server.database import get_session
from server.models import User

from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

router = APIRouter(tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer = HTTPBearer(auto_error=False)


# --- Schemas ---

class RegisterRequest(BaseModel):
    username: str
    password: str
    display_name: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str | None


# --- Helpers ---

def create_token(user_id: int, username: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {"sub": str(user_id), "username": username, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _init_workspace(user_id: int) -> Path:
    """Create a per-user workspace by copying the template volumes."""
    ws = WORKSPACES_DIR / str(user_id)
    if ws.exists():
        return ws
    ws.mkdir(parents=True, exist_ok=True)

    for vol_id, vol_cfg in VOLUMES.items():
        src = vol_cfg["path"]
        dst = ws / vol_id
        if src.exists() and not dst.exists():
            # Copy .v files and essential build files
            dst.mkdir(parents=True, exist_ok=True)
            for f in src.iterdir():
                if f.suffix in (".v", ".vo", ".glob", ".vos", ".vok") or f.name in (
                    "Makefile", "Makefile.coq", "_CoqProject", "LICENSE",
                ):
                    shutil.copy2(str(f), str(dst / f.name))
    return ws


# --- Dependency: extract current user from JWT ---

async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload.get("sub", 0))
    except (JWTError, ValueError):
        raise HTTPException(401, "Invalid token")
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")
    return user


async def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    if not creds:
        return None
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload.get("sub", 0))
    except (JWTError, ValueError):
        return None
    result = await session.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


# --- Endpoints ---

@router.post("/auth/register", response_model=TokenResponse)
async def register(req: RegisterRequest, session: AsyncSession = Depends(get_session)):
    if len(req.username) < 3 or len(req.username) > 50:
        raise HTTPException(400, "Username must be 3-50 characters")
    if len(req.password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")

    # Check if username exists
    existing = await session.execute(
        select(User).where(User.username == req.username)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Username already taken")

    user = User(
        username=req.username,
        password_hash=pwd_context.hash(req.password),
        display_name=req.display_name or req.username,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    # Initialize workspace
    _init_workspace(user.id)

    token = create_token(user.id, user.username)
    return TokenResponse(
        access_token=token,
        user={"id": user.id, "username": user.username, "display_name": user.display_name},
    )


@router.post("/auth/login", response_model=TokenResponse)
async def login(req: LoginRequest, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(User).where(User.username == req.username)
    )
    user = result.scalar_one_or_none()
    if not user or not pwd_context.verify(req.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")

    # Ensure workspace exists
    _init_workspace(user.id)

    token = create_token(user.id, user.username)
    return TokenResponse(
        access_token=token,
        user={"id": user.id, "username": user.username, "display_name": user.display_name},
    )


@router.get("/auth/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    return UserOut(id=user.id, username=user.username, display_name=user.display_name)
