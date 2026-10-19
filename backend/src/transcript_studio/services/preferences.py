"""User preferences: stored values override the defaults from core/config.py."""
from __future__ import annotations

from transcript_studio.core.config import Settings
from transcript_studio.domain.errors import ConflictError
from transcript_studio.domain.ports import SettingRepository
from transcript_studio.schemas.preferences import PreferencesRead, PreferencesUpdate

# Whisper sizes faster-whisper can download, with what they cost on this kind of machine.
WHISPER_MODELS: dict[str, str] = {
    "large-v3-turbo": "Padrão: quase a qualidade do large-v3, ~8x mais rápido (~1,6 GB, ~1,5 GB de VRAM)",
    "large-v3": "Máxima qualidade, bem mais lento (~3 GB, ~3,5 GB de VRAM)",
    "medium": "Intermediário (~1,5 GB)",
    "small": "Rápido, erra mais nomes e números (~480 MB)",
    "base": "Muito rápido, só para testes (~150 MB)",
}

CONTEXT_LIMITS = (1_000, 12_000)


class PreferencesService:
    def __init__(self, settings: SettingRepository, defaults: Settings) -> None:
        self._settings = settings
        self._defaults = defaults

    def get(self) -> PreferencesRead:
        stored = self._settings.all()
        return PreferencesRead(
            default_llm=stored.get("default_llm", self._defaults.default_llm),
            whisper_model=stored.get("whisper_model", self._defaults.default_whisper),
            context_max_chars=int(stored.get("context_max_chars", self._defaults.context_max_chars)),
        )

    def update(self, data: PreferencesUpdate) -> PreferencesRead:
        if data.whisper_model is not None and data.whisper_model not in WHISPER_MODELS:
            raise ConflictError(f"Modelo do Whisper desconhecido: {data.whisper_model}")
        if data.context_max_chars is not None and not CONTEXT_LIMITS[0] <= data.context_max_chars <= CONTEXT_LIMITS[1]:
            raise ConflictError(f"O contexto deve ter entre {CONTEXT_LIMITS[0]} e {CONTEXT_LIMITS[1]} caracteres.")
        for key, value in data.model_dump(exclude_none=True).items():
            self._settings.set(key, str(value).strip())
        return self.get()
