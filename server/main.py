"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from server.config import BASE_DIR, VOLUMES
from server.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown."""
    await init_db()
    yield


app = FastAPI(title="SF Learning Platform", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
from server.routers import volumes, grading, progress, tutor, coq_session  # noqa: E402

app.include_router(volumes.router, prefix="/api")
app.include_router(grading.router, prefix="/api")
app.include_router(progress.router, prefix="/api")
app.include_router(tutor.router, prefix="/api")
app.include_router(coq_session.router, prefix="/api")

# Mount SF HTML volumes for reading
for vol_id, vol_cfg in VOLUMES.items():
    vol_path = vol_cfg["path"]
    if vol_path.exists():
        app.mount(f"/sf/{vol_id}", StaticFiles(directory=str(vol_path), html=True), name=f"sf_{vol_id}")

# Mount the built frontend (production)
client_dist = BASE_DIR / "client" / "dist"
if client_dist.exists():
    app.mount("/", StaticFiles(directory=str(client_dist), html=True), name="client")
