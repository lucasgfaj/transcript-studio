"""Reference Markdown (glossary, people, companies) that goes into the minutes prompt: CRUD and budget."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from transcript_studio.domain.errors import ConflictError, NotFoundError


@dataclass(frozen=True)
class PlannedFile:
    path: str
    chars: int
    included: bool
    reason: str | None


def plan(directory: Path, max_chars: int) -> tuple[list[PlannedFile], str]:
    """Which files fit in the prompt, in name order, and the resulting text. README files describe the
    folder itself and are skipped; a file that does not fit is skipped so smaller ones after it still can."""
    files: list[PlannedFile] = []
    parts: list[str] = []
    used = 0
    for path in sorted(directory.rglob("*.md")) if directory.is_dir() else []:
        relative = path.relative_to(directory).as_posix()
        text = path.read_text(encoding="utf-8").strip()
        if path.name.lower() == "readme.md":
            files.append(PlannedFile(relative, len(text), False, "README não entra no prompt"))
            continue
        if not text:
            files.append(PlannedFile(relative, 0, False, "vazio"))
            continue
        entry = f"\n\n## Fonte: {relative}\n{text}"
        if used + len(entry) > max_chars:
            files.append(PlannedFile(relative, len(text), False, "não coube no limite"))
            continue
        files.append(PlannedFile(relative, len(text), True, None))
        parts.append(entry)
        used += len(entry)
    return files, "".join(parts).strip()


class MarkdownContextSource:
    """ContextSource used by the minutes job; the limit is read on every call so UI changes apply at once."""

    def __init__(self, directory: Path, max_chars: Callable[[], int]) -> None:
        self._directory = directory
        self._max_chars = max_chars

    def load(self) -> str:
        return plan(self._directory, self._max_chars())[1]


class ContextFilesService:
    def __init__(self, directory: Path) -> None:
        self._directory = directory

    def overview(self, max_chars: int) -> tuple[list[PlannedFile], int]:
        files, text = plan(self._directory, max_chars)
        return files, len(text)

    def read(self, path: str) -> str:
        file = self._resolve(path)
        if not file.is_file():
            raise NotFoundError(f"Arquivo {path} não encontrado.")
        return file.read_text(encoding="utf-8")

    def write(self, path: str, content: str) -> None:
        file = self._resolve(path)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content.rstrip() + "\n", encoding="utf-8")

    def delete(self, path: str) -> None:
        file = self._resolve(path)
        if not file.is_file():
            raise NotFoundError(f"Arquivo {path} não encontrado.")
        file.unlink()
        # Remove folders left empty, up to the context root.
        parent = file.parent
        while parent != self._directory and parent.is_dir() and not any(parent.iterdir()):
            parent.rmdir()
            parent = parent.parent

    def _resolve(self, path: str) -> Path:
        clean = path.strip().strip("/")
        if not clean.endswith(".md"):
            raise ConflictError("Use arquivos Markdown (.md).")
        root = self._directory.resolve()
        file = (root / clean).resolve()
        if root not in file.parents:
            raise ConflictError("Caminho fora da pasta de contexto.")
        return file
