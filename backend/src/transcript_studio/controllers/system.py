from __future__ import annotations

from fastapi import APIRouter

from transcript_studio.core.dependencies import ContainerDep, OllamaDep, SettingsDep
from transcript_studio.schemas.meeting import HealthRead

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health", response_model=HealthRead)
def health(ollama: OllamaDep, settings: SettingsDep, container: ContainerDep) -> HealthRead:
    version = ollama.version()
    return HealthRead(ok=True, ollama=version is not None, ollama_version=version, default_llm=settings.default_llm,
                      whisper_model=settings.default_whisper, gpu_job=container.worker.current,
                      queued_jobs=container.worker.pending())
