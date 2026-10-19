"""Streaming chat with the local Ollama (/api/chat). Ported from transcript-mk's OllamaMinutesGenerator."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Iterator
from typing import Any

from transcript_studio.domain.ports import GenerationCancelled, ShouldStop


class OllamaError(RuntimeError):
    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"Ollama respondeu {status}: {body}")
        self.status = status
        self.body = body


class OllamaChat:
    def __init__(self, base_url: str, context_tokens: int = 8_192, max_tokens: int = 2_500,
                 keep_alive: str = "2m", timeout: float = 600) -> None:
        self._base_url = base_url.rstrip("/")
        self._context_tokens = context_tokens
        self._max_tokens = max_tokens
        self._keep_alive = keep_alive
        self._timeout = timeout
        self._no_think: set[str] = set()  # models that reject the `think` flag

    def stream(self, model: str, system: str, prompt: str, should_stop: ShouldStop | None = None,
               max_tokens: int | None = None) -> Iterator[str]:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
        yield from self.stream_chat(model, messages, should_stop, max_tokens)

    def stream_chat(self, model: str, messages: list[dict[str, str]], should_stop: ShouldStop | None = None,
                    max_tokens: int | None = None) -> Iterator[str]:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "keep_alive": self._keep_alive,
            # repeat_penalty: small quantized models can otherwise loop on the same sentence until num_predict.
            "options": {"temperature": 0, "repeat_penalty": 1.15, "num_ctx": self._context_tokens,
                        "num_predict": max_tokens or self._max_tokens},
        }
        if model not in self._no_think:
            payload["think"] = False  # reasoning models (qwen3, deepseek-r1) answer much faster without it
        try:
            yield from self._stream(payload, should_stop)
        except OllamaError as error:
            if "think" not in payload or "think" not in error.body.lower():
                raise self._explain(error, model) from error
            self._no_think.add(model)
            del payload["think"]
            yield from self._stream(payload, should_stop)

    def _stream(self, payload: dict[str, Any], should_stop: ShouldStop | None) -> Iterator[str]:
        request = urllib.request.Request(f"{self._base_url}/api/chat", data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"})
        try:
            response = urllib.request.urlopen(request, timeout=self._timeout)
        except urllib.error.HTTPError as error:
            raise OllamaError(error.code, error.read().decode(errors="replace")) from error
        except (urllib.error.URLError, ConnectionError, TimeoutError) as error:
            raise RuntimeError(f"Não consegui falar com o Ollama em {self._base_url} ({error}). Ele está aberto?") from error
        with response:
            in_think = False
            for raw in response:  # NDJSON: one object per line
                if should_stop and should_stop():
                    raise GenerationCancelled()
                if not raw.strip():
                    continue
                chunk = json.loads(raw)
                if chunk.get("error"):
                    raise OllamaError(500, str(chunk["error"]))
                text, in_think = _drop_think((chunk.get("message") or {}).get("content", ""), in_think)
                if text:
                    yield text
                if chunk.get("done"):
                    return

    @staticmethod
    def _explain(error: OllamaError, model: str) -> Exception:
        if error.status == 404 and "not found" in error.body.lower():
            return RuntimeError(f"O modelo '{model}' não está instalado no Ollama. Rode: ollama pull {model}")
        return error


def _drop_think(text: str, in_think: bool) -> tuple[str, bool]:
    """Models that ignore think=false still wrap reasoning in <think>…</think>; keep only the answer."""
    kept: list[str] = []
    while text:
        if in_think:
            end = text.find("</think>")
            if end < 0:
                break
            text, in_think = text[end + len("</think>"):], False
        else:
            start = text.find("<think>")
            if start < 0:
                kept.append(text)
                break
            kept.append(text[:start])
            text, in_think = text[start + len("<think>"):], True
    return "".join(kept), in_think
