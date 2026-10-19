"""LLM management on top of Ollama: what is installed, what fits this GPU, download and removal."""
from __future__ import annotations

from collections.abc import Iterator
from typing import Any, Protocol

from transcript_studio.domain.errors import ConflictError
from transcript_studio.schemas.preferences import CatalogModel, LlmModelInfo

_GB = 1024 ** 3
# Memory Ollama needs on top of the weights (KV cache for an 8k context, CUDA buffers).
_OVERHEAD_GB = 1.2

# Suggestions sized for a 6 GB laptop GPU; anything in the Ollama library can still be typed by name.
CATALOG: list[CatalogModel] = [
    CatalogModel(name="qwen3.5:4b", approx_gb=3.3, description="Recomendado: ata organizada e rápida, cabe inteiro na GPU"),
    CatalogModel(name="gemma3:4b", approx_gb=3.3, description="Alternativa do Google, boa em português"),
    CatalogModel(name="llama3.2:3b", approx_gb=2.0, description="O mais rápido; atas mais simples"),
    CatalogModel(name="qwen3:8b", approx_gb=5.2, description="Mais detalhado, mas parte roda na CPU (~7x mais lento aqui)"),
    CatalogModel(name="qwen3:14b", approx_gb=9.3, description="Melhor texto, muito lento nesta GPU e usa bastante RAM"),
]


class OllamaModels(Protocol):
    def list_models(self) -> list[dict[str, Any]]: ...
    def running(self) -> list[dict[str, Any]]: ...
    def pull(self, name: str) -> Iterator[dict[str, Any]]: ...
    def delete(self, name: str) -> None: ...


class LlmModelService:
    def __init__(self, ollama: OllamaModels, gpu_memory_gb: float) -> None:
        self._ollama = ollama
        self._gpu_memory_gb = gpu_memory_gb

    def installed(self) -> list[LlmModelInfo]:
        loaded = {m["name"]: m.get("size_vram") for m in self._ollama.running()}
        models = []
        for raw in self._ollama.list_models():
            if "embed" in raw["name"]:
                continue
            details = raw.get("details") or {}
            size = raw.get("size")
            models.append(LlmModelInfo(
                name=raw["name"], size=size, parameter_size=details.get("parameter_size"),
                quantization=details.get("quantization_level"), family=details.get("family"),
                loaded=raw["name"] in loaded, vram=loaded.get(raw["name"]),
                fits_gpu=None if size is None else size / _GB + _OVERHEAD_GB <= self._gpu_memory_gb,
            ))
        return sorted(models, key=lambda m: m.name)

    def catalog(self, installed: list[LlmModelInfo]) -> list[CatalogModel]:
        names = {m.name for m in installed}
        return [model.model_copy(update={"installed": model.name in names}) for model in CATALOG]

    def pull(self, name: str) -> Iterator[dict[str, Any]]:
        """Normalised progress: {status, completed, total, percent} … then {status: success} or {error}."""
        name = name.strip()
        for event in self._ollama.pull(name):
            if "error" in event:
                yield {"error": str(event["error"])}
                return
            total, completed = event.get("total"), event.get("completed")
            percent = round(100 * completed / total, 1) if total and completed is not None else None
            yield {"status": event.get("status", ""), "completed": completed, "total": total, "percent": percent}

    def delete(self, name: str, default_llm: str) -> None:
        if name == default_llm:
            raise ConflictError("Este é o modelo padrão da ata. Escolha outro padrão antes de apagar.")
        self._ollama.delete(name)
