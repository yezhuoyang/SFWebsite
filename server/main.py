"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from server.config import BASE_DIR, CORS_ORIGINS, VOLUMES
from server.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown."""
    await init_db()
    yield
    # Cleanup: close all vscoqtop sessions
    from server.services.vscoqtop_session import pool
    await pool.close_all()


app = FastAPI(title="SF Learning Platform", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
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

# Auth router (register/login)
from server.routers import auth  # noqa: E402
app.include_router(auth.router, prefix="/api")

# Mount SF HTML volumes for reading
for vol_id, vol_cfg in VOLUMES.items():
    vol_path = vol_cfg["path"]
    if vol_path.exists():
        app.mount(f"/sf/{vol_id}", StaticFiles(directory=str(vol_path), html=True), name=f"sf_{vol_id}")

# SPA fallback: serve index.html for any non-API, non-static path
# This makes React Router work on hard refresh (Ctrl+Shift+R)
client_dist = BASE_DIR / "client" / "dist"
if client_dist.exists():
    from fastapi.responses import FileResponse

    # Serve static assets (JS, CSS, images) directly
    app.mount("/assets", StaticFiles(directory=str(client_dist / "assets")), name="assets")

    # Serve jsCoq worker and packages (large binary files)
    jscoq_dir = client_dist / "jscoq"
    if jscoq_dir.exists():
        app.mount("/jscoq", StaticFiles(directory=str(jscoq_dir)), name="jscoq")

    # Catch-all: serve index.html for any other path (React Router handles routing)
    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        # If the file exists in dist, serve it (favicon, etc.)
        file_path = client_dist / path
        if path and file_path.is_file():
            return FileResponse(str(file_path))
        # Otherwise serve index.html (React Router will handle the route)
        return FileResponse(str(client_dist / "index.html"))
