from __future__ import annotations

from sqlmodel import Field, SQLModel


class PreferencesRead(SQLModel):
    default_llm: str
    whisper_model: str
    context_max_chars: int


class PreferencesUpdate(SQLModel):
    default_llm: str | None = Field(default=None, min_length=1)
    whisper_model: str | None = None
    context_max_chars: int | None = None


class LlmModelInfo(SQLModel):
    name: str
    size: int | None = None
    parameter_size: str | None = None
    quantization: str | None = None
    family: str | None = None
    loaded: bool = False
    vram: int | None = None          # bytes on the GPU while loaded
    fits_gpu: bool | None = None     # whether the whole model fits in the GPU memory


class CatalogModel(SQLModel):
    name: str
    description: str
    approx_gb: float
    installed: bool = False


class WhisperModelInfo(SQLModel):
    name: str
    description: str
    downloaded: bool
    active: bool


class ModelsOverview(SQLModel):
    default: str
    available: bool
    gpu_memory_gb: float
    models: list[LlmModelInfo]
    catalog: list[CatalogModel]
    whisper: list[WhisperModelInfo]


class PullRequest(SQLModel):
    name: str = Field(min_length=1, max_length=200)


class ContextFile(SQLModel):
    path: str
    chars: int
    included: bool
    reason: str | None = None


class ContextOverview(SQLModel):
    max_chars: int
    used_chars: int
    files: list[ContextFile]


class ContextContent(SQLModel):
    path: str
    content: str


class ContextWrite(SQLModel):
    content: str
