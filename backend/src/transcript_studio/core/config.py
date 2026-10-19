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
    default_llm: str = "qwen3:8b"
    default_whisper: str = "large-v3-turbo"
    whisper_preload: bool = True  # load Whisper at startup so the first transcription starts immediately
    whisper_batch_size: int = 16  # best measured on the RTX 4050 6 GB (24 gave no gain)
    default_language: str = "pt"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'studio.db'}"

    @property
    def meetings_dir(self) -> Path:
        return self.data_dir / "meetings"


@lru_cache
def get_settings() -> Settings:
    return Settings()
