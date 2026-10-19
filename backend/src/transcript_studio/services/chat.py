"""Questions about one meeting, answered by the local LLM from its minutes and the relevant transcript excerpts."""
from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from typing import Any, Protocol

from transcript_studio.domain.errors import ConflictError
from transcript_studio.domain.ports import ChatModel, ChatRepository, ContextSource
from transcript_studio.models import ChatMessage, ChatRole
from transcript_studio.schemas.chat import ChatMessageRead
from transcript_studio.services.documents import MinutesService, TranscriptService
from transcript_studio.services.meetings import MeetingService
from transcript_studio.services.retrieval import passages, select

# Character budgets that keep system + minutes + excerpts + history + answer inside an 8k-token context.
_MINUTES_CHARS = 3_500
_EXCERPT_CHARS = 9_000
_REFERENCE_CHARS = 1_500
_HISTORY_TURNS = 4
_HISTORY_CHARS = 800
_ANSWER_TOKENS = 1_000

SYSTEM = (
    "Você responde perguntas sobre UMA reunião, em português do Brasil, usando somente a ata e os trechos da "
    "transcrição fornecidos. Ao usar uma frase, cite o horário que aparece antes dela, entre colchetes, como "
    "[12:34]; use só horários que estão no texto, nunca invente. Se a resposta "
    "não estiver no material, diga que não aparece nos trechos disponíveis em vez de supor. Seja direto e use "
    "listas quando ajudar. Nomes da referência servem só para grafar corretamente, nunca como fato."
)


class GpuGate(Protocol):
    """Exclusive GPU access for interactive answers (waits for a running job, frees Whisper)."""

    @property
    def busy(self) -> bool: ...
    @property
    def recording(self) -> bool: ...
    def exclusive(self) -> AbstractContextManager[None]: ...


def clock(seconds: float | None) -> str:
    if seconds is None:
        return "--:--"
    total = int(seconds)
    h, rest = divmod(total, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02}:{s:02}" if h else f"{m:02}:{s:02}"


_CITATION = re.compile(r"\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]")


def snap_citations(text: str, spans: list[tuple[float, float]]) -> str:
    """Small models cite times *inside* a 30-second segment that never appear in the text ([00:38] for a
    segment starting at 00:32). Each citation is moved to the start of the segment that contains it (or the
    closest one), so clicking it plays the right sentence."""
    if not spans:
        return text
    starts = sorted(start for start, _end in spans)

    def replace(match: re.Match[str]) -> str:
        a, b, c = match.groups()
        seconds = int(a) * 3600 + int(b) * 60 + int(c) if c else int(a) * 60 + int(b)
        inside = [start for start, end in spans if start <= seconds < end]
        target = inside[0] if inside else min(starts, key=lambda start: abs(start - seconds))
        return f"[{clock(target)}]"

    return _CITATION.sub(replace, text)


class ChatService:
    def __init__(self, meetings: MeetingService, transcripts: TranscriptService, minutes: MinutesService,
                 chats: ChatRepository, model: ChatModel, reference: ContextSource, gpu: GpuGate,
                 default_model: Callable[[], str]) -> None:
        self._meetings = meetings
        self._transcripts = transcripts
        self._minutes = minutes
        self._chats = chats
        self._model = model
        self._reference = reference
        self._gpu = gpu
        self._default_model = default_model

    def history(self, meeting_id: str) -> list[ChatMessageRead]:
        self._meetings.get(meeting_id)
        return [ChatMessageRead.model_validate(m, from_attributes=True) for m in self._chats.list_for(meeting_id)]

    def clear(self, meeting_id: str) -> None:
        self._meetings.get(meeting_id)
        self._chats.clear(meeting_id)

    def ask(self, meeting_id: str, question: str, model: str | None = None) -> Iterator[dict[str, Any]]:
        """Validates first (errors become HTTP status codes), then returns the event stream."""
        meeting = self._meetings.get(meeting_id)
        transcript = self._transcripts.read(meeting_id)
        current = self._minutes.bundle(meeting_id).current
        if not transcript.text and current is None:
            raise ConflictError("Esta reunião ainda não tem transcrição nem ata para conversar.")
        if self._gpu.recording:
            raise ConflictError("Há uma gravação ao vivo usando a GPU. Tente quando ela terminar.")
        question = question.strip()
        if not question:
            raise ConflictError("Escreva uma pergunta.")
        model = model or self._default_model()
        previous = self._chats.list_for(meeting_id)[-_HISTORY_TURNS:]
        self._chats.add(ChatMessage(meeting_id=meeting_id, role=ChatRole.user, content=question))

        timed = [(s.start, s.text) for s in transcript.segments] or [(None, line) for line in transcript.text.splitlines() if line.strip()]
        budget = _EXCERPT_CHARS if current else _EXCERPT_CHARS + _MINUTES_CHARS
        excerpts = select(question, passages(timed), budget)
        material = [f"REUNIÃO: {meeting.title} · {meeting.date.isoformat()} · participantes: "
                    f"{', '.join(meeting.participants) or 'não informados'}"]
        if current:
            material.append("ATA:\n" + current.markdown[:_MINUTES_CHARS])
        if excerpts:
            # Every sentence keeps its own time: with only the passage start the model made up the times in between.
            material.append("TRECHOS DA TRANSCRIÇÃO (cada frase com o horário em que foi dita):\n" + "\n\n".join(
                " ".join(f"[{clock(start)}] {text}" if start is not None else text
                         for start, text in (p.parts or ((p.start, p.text),)))
                for p in excerpts))
        reference = self._reference.load()[:_REFERENCE_CHARS]
        if reference:
            material.append("REFERÊNCIA DE NOMES E SIGLAS:\n" + reference)
        messages = [{"role": "system", "content": SYSTEM + "\n\n" + "\n\n".join(material)}]
        messages += [{"role": m.role.value, "content": m.content[:_HISTORY_CHARS]} for m in previous]
        messages.append({"role": "user", "content": question})
        spans = [(seg.start, seg.end) for seg in transcript.segments if seg.start is not None and seg.end is not None]
        return self._answer(meeting_id, model, messages, len(excerpts), spans)

    def _answer(self, meeting_id: str, model: str, messages: list[dict[str, str]], excerpts: int,
                spans: list[tuple[float, float]]) -> Iterator[dict[str, Any]]:
        if self._gpu.busy:
            yield {"type": "status", "message": "Esperando a GPU terminar a tarefa em andamento…"}
        pieces: list[str] = []
        finished = False
        saved: ChatMessage | None = None
        with self._gpu.exclusive():
            yield {"type": "status", "message": f"Lendo {excerpts} trechos com {model}…"}
            tokens = self._model.stream_chat(model, messages, max_tokens=_ANSWER_TOKENS)
            try:
                for piece in tokens:
                    pieces.append(piece)
                    yield {"type": "token", "text": piece}
                finished = True
            except Exception as error:  # Ollama down, model missing…
                yield {"type": "error", "message": str(error)}
            finally:
                # Also runs when the browser goes away (Stop button): no yield allowed here.
                tokens.close()  # stops the Ollama stream
                text = snap_citations("".join(pieces).strip(), spans)
                if text:
                    saved = self._chats.add(ChatMessage(meeting_id=meeting_id, role=ChatRole.assistant, content=text,
                                                        model=model, interrupted=not finished))
        if finished and saved is not None:
            yield {"type": "done", "message": ChatMessageRead.model_validate(saved, from_attributes=True).model_dump(mode="json")}
