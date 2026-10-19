"""Picks the transcript excerpts that answer a question, so long meetings fit the model's context.

A 70-minute meeting is ~60k characters (~17k tokens) and the local model works with 8k tokens:
the transcript is split into ~1 000-character passages with their start time, scored by how many
(rare) question words they contain, and the best ones are sent back in chronological order.
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass

_WORD = re.compile(r"[a-z0-9]+")
# Common Portuguese words that say nothing about the topic of a question.
_STOP = set("""
a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra pro com sem sob
e ou mas que se nao sim ja la aqui ai isso isto esse essa este esta aquele aquela ele ela eles elas eu voce voces
nos me te lhe seu sua seus suas meu minha foi era ser ter tem tinha vai vou esta estava sao como quando onde qual
quais quem porque sobre entre ate tambem muito mais menos bem entao tipo ne ta to coisa gente reuniao falou disse
""".split())


@dataclass(frozen=True)
class Passage:
    start: float | None
    text: str
    # The segments it was built from, so each sentence can be shown with its own time.
    parts: tuple[tuple[float | None, str], ...] = ()


def fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def terms(text: str) -> list[str]:
    return [w for w in _WORD.findall(fold(text)) if len(w) > 2 and w not in _STOP]


def passages(segments: list[tuple[float | None, str]], size: int = 1_000) -> list[Passage]:
    """Groups consecutive transcript segments into passages of about `size` characters."""
    result: list[Passage] = []
    buffer: list[tuple[float | None, str]] = []
    length = 0
    for seg_start, text in segments:
        buffer.append((seg_start, text.strip()))
        length += len(text) + 1
        if length >= size:
            result.append(_passage(buffer))
            buffer, length = [], 0
    if buffer:
        result.append(_passage(buffer))
    return result


def _passage(parts: list[tuple[float | None, str]]) -> Passage:
    return Passage(parts[0][0], " ".join(text for _start, text in parts), tuple(parts))


def select(question: str, candidates: list[Passage], budget: int) -> list[Passage]:
    """Best passages for the question within `budget` characters, back in transcript order.
    With no useful words in the question (e.g. "resuma"), the beginning-to-end spread is kept."""
    if sum(len(p.text) for p in candidates) <= budget:
        return candidates
    query = set(terms(question))
    documents = [Counter(terms(p.text)) for p in candidates]
    frequency = Counter(term for doc in documents for term in set(doc))
    total = len(candidates)

    def score(index: int) -> float:
        doc = documents[index]
        return sum((1 + math.log(doc[t])) * math.log(1 + total / frequency[t]) for t in query if doc[t])

    scores = [score(i) for i in range(total)]
    if not any(scores):
        # Evenly spread passages give a better overview than only the first minutes.
        step = max(1, total * 1_000 // max(budget, 1))
        order = list(range(0, total, step))
    else:
        order = sorted(range(total), key=lambda i: scores[i], reverse=True)
    chosen: list[int] = []
    used = 0
    for index in order:
        if scores and any(scores) and scores[index] == 0:
            break
        size = len(candidates[index].text)
        if used + size > budget:
            continue
        chosen.append(index)
        used += size
    return [candidates[i] for i in sorted(chosen)]
