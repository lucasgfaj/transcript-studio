from __future__ import annotations

import json
import urllib.request


class OllamaClient:
    """Thin HTTP client for the local Ollama server; grows with model management in phase 6."""

    def __init__(self, base_url: str, timeout: float = 2.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def version(self) -> str | None:
        try:
            with urllib.request.urlopen(f"{self._base_url}/api/version", timeout=self._timeout) as response:
                return str(json.loads(response.read()).get("version"))
        except (OSError, ValueError):
            return None
