from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from transcript_studio.controllers import jobs, meetings, system
from transcript_studio.core import container as container_module
from transcript_studio.core.config import Settings, get_settings
from transcript_studio.core.db import make_engine
from transcript_studio.domain.errors import ConflictError, InvalidAudioError, NotFoundError
from transcript_studio.domain.ports import GpuReleaser, Transcriber


def create_app(settings: Settings | None = None, transcriber: Transcriber | None = None,
               gpu: GpuReleaser | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.engine = make_engine(settings)
        app.state.container = container_module.build_container(settings, app.state.engine, transcriber, gpu)
        container_module.start(app.state.container, settings)
        yield
        container_module.stop(app.state.container)
        app.state.engine.dispose()

    app = FastAPI(title="Transcript Studio", version="0.2.0", lifespan=lifespan)
    app.include_router(system.router)
    app.include_router(meetings.router)
    app.include_router(jobs.router)

    @app.exception_handler(NotFoundError)
    async def not_found(_request: Request, error: NotFoundError) -> JSONResponse:
        return JSONResponse({"detail": str(error)}, status_code=404)

    @app.exception_handler(InvalidAudioError)
    async def invalid_audio(_request: Request, error: InvalidAudioError) -> JSONResponse:
        return JSONResponse({"detail": str(error)}, status_code=422)

    @app.exception_handler(ConflictError)
    async def conflict(_request: Request, error: ConflictError) -> JSONResponse:
        return JSONResponse({"detail": str(error)}, status_code=409)

    _mount_frontend(app, settings)
    return app


def _mount_frontend(app: FastAPI, settings: Settings) -> None:
    """Serves the built React app (npm run build) so a single process runs everything."""
    dist = settings.frontend_dist
    if not (dist / "index.html").exists():
        return
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")


app = create_app()
