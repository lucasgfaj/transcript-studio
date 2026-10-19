"""Controller for the reference Markdown used in the minutes prompt."""
from __future__ import annotations

from fastapi import APIRouter, Query, status

from transcript_studio.core.dependencies import ContextFilesDep, PreferencesDep
from transcript_studio.schemas.preferences import ContextContent, ContextFile, ContextOverview, ContextWrite

router = APIRouter(prefix="/api/context", tags=["context"])


@router.get("", response_model=ContextOverview)
def overview(files: ContextFilesDep, preferences: PreferencesDep) -> ContextOverview:
    limit = preferences.get().context_max_chars
    planned, used = files.overview(limit)
    return ContextOverview(max_chars=limit, used_chars=used,
                           files=[ContextFile(path=f.path, chars=f.chars, included=f.included, reason=f.reason)
                                  for f in planned])


@router.get("/file", response_model=ContextContent)
def read(files: ContextFilesDep, path: str = Query(...)) -> ContextContent:
    return ContextContent(path=path, content=files.read(path))


@router.put("/file", response_model=ContextContent)
def write(body: ContextWrite, files: ContextFilesDep, path: str = Query(...)) -> ContextContent:
    files.write(path, body.content)
    return ContextContent(path=path, content=files.read(path))


@router.delete("/file", status_code=status.HTTP_204_NO_CONTENT)
def delete(files: ContextFilesDep, path: str = Query(...)) -> None:
    files.delete(path)
