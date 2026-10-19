"""Controller for models (Ollama LLMs and Whisper sizes) and the user preferences that pick them."""
from __future__ import annotations

import json
from collections.abc import Iterator

from fastapi import APIRouter, status
from fastapi.responses import StreamingResponse

from transcript_studio.core.dependencies import ContainerDep, LlmModelsDep, PreferencesDep, SettingsDep
from transcript_studio.infrastructure.whisper import is_downloaded
from transcript_studio.schemas.preferences import (
    ModelsOverview, PreferencesRead, PreferencesUpdate, PullRequest, WhisperModelInfo,
)
from transcript_studio.services.preferences import WHISPER_MODELS

router = APIRouter(prefix="/api", tags=["models"])


@router.get("/models", response_model=ModelsOverview)
def overview(models: LlmModelsDep, preferences: PreferencesDep, settings: SettingsDep,
             container: ContainerDep) -> ModelsOverview:
    prefs = preferences.get()
    try:
        installed, available = models.installed(), True
    except (OSError, ValueError):
        installed, available = [], False
    whisper = [WhisperModelInfo(name=name, description=description, downloaded=is_downloaded(name),
                                active=name == container.transcriber.model_name)
               for name, description in WHISPER_MODELS.items()]
    return ModelsOverview(default=prefs.default_llm, available=available, gpu_memory_gb=settings.gpu_memory_gb,
                          models=installed, catalog=models.catalog(installed), whisper=whisper)


@router.post("/models/pull")
def pull(body: PullRequest, models: LlmModelsDep) -> StreamingResponse:
    """Streams download progress as NDJSON lines ({status, completed, total, percent} … or {error})."""
    def lines() -> Iterator[str]:
        try:
            for event in models.pull(body.name):
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except OSError as error:
            yield json.dumps({"error": f"Ollama indisponível: {error}"}, ensure_ascii=False) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@router.delete("/models/{name:path}", status_code=status.HTTP_204_NO_CONTENT)
def delete(name: str, models: LlmModelsDep, preferences: PreferencesDep) -> None:
    models.delete(name, preferences.get().default_llm)


@router.get("/preferences", response_model=PreferencesRead)
def get_preferences(preferences: PreferencesDep) -> PreferencesRead:
    return preferences.get()


@router.put("/preferences", response_model=PreferencesRead)
def update_preferences(body: PreferencesUpdate, preferences: PreferencesDep, container: ContainerDep,
                       settings: SettingsDep) -> PreferencesRead:
    updated = preferences.update(body)
    if body.whisper_model and body.whisper_model != container.transcriber.model_name:
        # Through the GPU queue so a running transcription finishes with the model it started with.
        transcriber = container.transcriber
        container.worker.call_soon(lambda: transcriber.set_model(updated.whisper_model))
        if settings.whisper_preload:
            container.worker.call_soon(transcriber.warm_up)
    return updated
