from __future__ import annotations

from pathlib import Path


class MarkdownContextSource:
    """Loads reference Markdown (glossary, people, companies) with a size cap. Ported from transcript-mk."""

    def __init__(self, directory: Path, maximum_characters: int = 4_000) -> None:
        self._directory = directory
        self._maximum_characters = maximum_characters

    def load(self) -> str:
        if not self._directory.is_dir():
            return ""
        documents: list[str] = []
        used = 0
        for path in sorted(self._directory.rglob("*.md")):
            if path.name.lower() == "readme.md":  # describes the folder itself, not the business
                continue
            text = path.read_text(encoding="utf-8").strip()
            if not text:
                continue
            entry = f"\n\n## Fonte: {path.relative_to(self._directory)}\n{text}"
            if used + len(entry) > self._maximum_characters:
                continue  # a smaller file further on may still fit
            documents.append(entry)
            used += len(entry)
        return "".join(documents).strip()
