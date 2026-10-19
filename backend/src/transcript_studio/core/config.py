from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# core/config.py -> transcript_studio -> src -> backend -> project root
PROJECT_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    """Local configuration; override with STUDIO_* environment variables or backend/.env."""

    model_config = SettingsConfigDict(env_prefix="STUDIO_", env_file=PROJECT_ROOT / "backend" / ".env", extra="ignore")

    data_dir: Path = PROJECT_ROOT / "data"
    frontend_dist: Path = PROJECT_ROOT / "frontend" / "dist"
    ollama_url: str = "http://localhost:11434"
    default_llm: str = "qwen3.5:4b"  # measured: 32-min meeting in 44 s fully on GPU; qwen3:8b took 312 s
    default_whisper: str = "large-v3-turbo"
    gpu_memory_gb: float = 6.0  # RTX 4050 Laptop; used to tell which LLMs fit entirely on the GPU
    whisper_preload: bool = True  # load Whisper at startup so the first transcription starts immediately
    whisper_batch_size: int = 16  # best measured on the RTX 4050 6 GB (24 gave no gain)
    default_language: str = "pt"
    llm_context_tokens: int = 8_192
    minutes_chunk_chars: int = 6_000  # transcript characters per LLM call (map step)
    context_max_chars: int = 4_000

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'studio.db'}"

    @property
    def meetings_dir(self) -> Path:
        return self.data_dir / "meetings"

    @property
    def context_dir(self) -> Path:
        return self.data_dir / "context"


@lru_cache
def get_settings() -> Settings:
    return Settings()
