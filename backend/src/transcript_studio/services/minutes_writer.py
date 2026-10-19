"""Writes minutes from a transcript with map-reduce over chunks. Prompts ported from transcript-mk."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from transcript_studio.domain.ports import ChatModel, ShouldStop

OnToken = Callable[[str], None]
Stage = Literal["notes", "condense", "final", "final_from_notes"]
OnStep = Callable[[str, float], None]  # (message, progress 0..1)


@dataclass(frozen=True)
class MinutesRequest:
    title: str
    participants: tuple[str, ...]
    date: str
    transcript: str
    context: str = ""


def split_text(text: str, maximum_characters: int) -> list[str]:
    """Split on paragraph/line/word boundaries without exceeding the limit."""
    if maximum_characters < 1:
        raise ValueError("maximum_characters must be positive")
    remaining = text.strip()
    chunks: list[str] = []
    while remaining:
        if len(remaining) <= maximum_characters:
            chunks.append(remaining)
            break
        cut = remaining.rfind("\n\n", 0, maximum_characters + 1)
        if cut <= 0:
            cut = remaining.rfind("\n", 0, maximum_characters + 1)
        if cut <= 0:
            cut = remaining.rfind(" ", 0, maximum_characters + 1)
        if cut <= 0:
            cut = maximum_characters
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    return [chunk for chunk in chunks if chunk]


NOTE_TOKENS = 700         # notes per chunk stay short (~2.5k characters)
MINUTES_TOKENS = 2_500    # the final minutes
_MAX_CONDENSE_ROUNDS = 2  # never loop forever on a model that does not shorten its notes


class MinutesWriter:
    """Long transcripts: short notes per chunk, then one final pass; only the final answer is streamed."""

    def __init__(self, chat: ChatModel, chunk_characters: int = 6_000, synthesis_characters: int = 12_000) -> None:
        self._chat = chat
        self._chunk_characters = chunk_characters
        # Final input budget: 8k-token context minus the answer and the reference context.
        self._synthesis_characters = synthesis_characters

    def write(self, request: MinutesRequest, model: str, on_token: OnToken | None = None,
              on_step: OnStep | None = None, should_stop: ShouldStop | None = None) -> str:
        step = on_step or (lambda _message, _progress: None)
        chunks = split_text(request.transcript, self._chunk_characters)
        if len(chunks) == 1:
            step("Escrevendo a ata", 0.1)
            return self._ask(request, model, chunks[0], "final", on_token=on_token, should_stop=should_stop)

        # Map steps take most of the time; the final pass gets the last 30% of the bar.
        partials = []
        for index, chunk in enumerate(chunks, 1):
            step(f"Lendo trecho {index} de {len(chunks)}", 0.7 * (index - 1) / len(chunks))
            partials.append(self._ask(request, model, chunk, "notes", index=index, total=len(chunks),
                                      should_stop=should_stop))
        synthesis = "\n\n--- NOTA PARCIAL ---\n\n".join(partials)
        for _round in range(_MAX_CONDENSE_ROUNDS):
            if len(synthesis) <= self._synthesis_characters:
                break
            step("Condensando as notas", 0.7)
            condensed = "\n\n--- NOTA CONSOLIDADA ---\n\n".join(
                self._ask(request, model, part, "condense", should_stop=should_stop)
                for part in split_text(synthesis, self._synthesis_characters)
            )
            if len(condensed) >= len(synthesis):
                break
            synthesis = condensed
        step("Escrevendo a ata", 0.7)
        return self._ask(request, model, synthesis, "final_from_notes", on_token=on_token, should_stop=should_stop)

    def _ask(self, request: MinutesRequest, model: str, text: str, stage: Stage, *, index: int = 1, total: int = 1,
             on_token: OnToken | None = None, should_stop: ShouldStop | None = None) -> str:
        system, prompt = build_prompt(request, text, stage, index=index, total=total)
        tokens = MINUTES_TOKENS if stage.startswith("final") else NOTE_TOKENS
        pieces: list[str] = []
        for piece in self._chat.stream(model, system, prompt, should_stop, tokens):
            pieces.append(piece)
            if on_token:
                on_token(piece)
        text = "".join(pieces).strip()
        if not text:
            raise RuntimeError(f"O modelo {model} não devolveu texto.")
        return _strip_fences(text) + "\n"


_FACTS_ONLY = (
    "Use apenas fatos explícitos; o contexto de referência serve somente para desambiguar nomes, siglas e "
    "termos, nunca para inventar fatos, e não deve ser citado nem mencionado no texto."
)
_MINUTES_SYSTEM = (
    "Você redige atas profissionais exclusivamente em português do Brasil. " + _FACTS_ONLY + " Retorne somente "
    "Markdown, sem cercas de código. Inclua título H1, data, participantes, resumo, tópicos discutidos, decisões, "
    "tarefas com checkboxes, pendências e próximos passos. Declare quando uma seção não tiver itens identificados."
)
_NOTES_SYSTEM = (
    "Você extrai notas de reuniões em português do Brasil. " + _FACTS_ONLY + " Responda só com tópicos curtos de "
    "uma linha (fatos, números, decisões, tarefas com responsável e prazo, pendências), sem título, introdução "
    "nem conclusão."
)
_TASKS: dict[Stage, str] = {
    "final": "Elabore a ata desta reunião.",
    "final_from_notes": "Elabore a ata desta reunião a partir das notas parciais abaixo, na ordem em que os assuntos aparecem.",
    "notes": "Extraia as notas deste trecho ({index}/{total}) em no máximo 15 tópicos.",
    "condense": "Una e condense as notas abaixo em no máximo 25 tópicos, removendo repetições e mantendo números, "
                "decisões, tarefas e responsáveis.",
}


def build_prompt(request: MinutesRequest, text: str, stage: Stage, *, index: int = 1, total: int = 1) -> tuple[str, str]:
    system = _MINUTES_SYSTEM if stage.startswith("final") else _NOTES_SYSTEM
    label = "TRANSCRIÇÃO" if stage in ("final", "notes") else "NOTAS PARCIAIS"
    prompt = (f"{_TASKS[stage].format(index=index, total=total)}\n\nData: {request.date}\nTítulo: {request.title}\n"
              f"Participantes: {', '.join(request.participants) or 'Não informados'}\n\n"
              f"CONTEXTO DE REFERÊNCIA:\n{request.context or 'Não fornecido'}\n\n"
              f"{label}:\n{text}")
    return system, prompt


def _strip_fences(text: str) -> str:
    """Some models wrap the whole answer in ```markdown fences despite the instruction."""
    lines = text.splitlines()
    if len(lines) >= 2 and lines[0].startswith("```") and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1]).strip()
    return text
