"""Controller for the LLMs available in the local Ollama (full management arrives in phase 6)."""
from __future__ import annotations

from fastapi import APIRouter

from transcript_studio.core.dependencies import OllamaDep, SettingsDep
from transcript_studio.schemas.meeting import LlmModel, ModelsRead

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=ModelsRead)
def list_models(ollama: OllamaDep, settings: SettingsDep) -> ModelsRead:
    try:
        raw = ollama.list_models()
    except (OSError, ValueError):
        return ModelsRead(default=settings.default_llm, available=False, models=[])
    models = [
        LlmModel(name=m["name"], size=m.get("size"), parameter_size=(m.get("details") or {}).get("parameter_size"),
                 quantization=(m.get("details") or {}).get("quantization_level"),
                 family=(m.get("details") or {}).get("family"))
        for m in raw if "embed" not in m["name"]
    ]
    return ModelsRead(default=settings.default_llm, available=True, models=sorted(models, key=lambda m: m.name))
