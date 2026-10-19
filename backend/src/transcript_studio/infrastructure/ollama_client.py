from __future__ import annotations

import json
import logging
import urllib.request
from typing import Any

log = logging.getLogger(__name__)


class OllamaClient:
    """Thin HTTP client for the local Ollama server; grows with model management in phase 6."""

    def __init__(self, base_url: str, timeout: float = 2.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def version(self) -> str | None:
        try:
            return str(self._get("/api/version").get("version"))
        except (OSError, ValueError):
            return None

    def loaded_models(self) -> list[str]:
        return [model["name"] for model in self._get("/api/ps").get("models", [])]

    def release_gpu(self) -> None:
        """Asks Ollama to unload every model now (keep_alive=0) so Whisper gets the whole GPU."""
        try:
            for name in self.loaded_models():
                self._post("/api/generate", {"model": name, "keep_alive": 0})
        except (OSError, ValueError) as error:
            log.info("Ollama not reachable while releasing the GPU: %s", error)

    def _get(self, path: str) -> dict[str, Any]:
        with urllib.request.urlopen(f"{self._base_url}{path}", timeout=self._timeout) as response:
            return json.loads(response.read())

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(f"{self._base_url}{path}", data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read() or b"{}")
