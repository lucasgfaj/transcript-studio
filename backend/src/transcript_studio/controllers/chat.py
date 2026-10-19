"""Controller for the conversation about a meeting (answers stream as NDJSON lines)."""
from __future__ import annotations

import json
from collections.abc import Iterator

from fastapi import APIRouter, status
from fastapi.responses import StreamingResponse

from transcript_studio.core.dependencies import ChatServiceDep
from transcript_studio.schemas.chat import ChatMessageRead, ChatQuestion

router = APIRouter(prefix="/api/meetings/{meeting_id}/chat", tags=["chat"])


@router.get("", response_model=list[ChatMessageRead])
def history(meeting_id: str, service: ChatServiceDep) -> list[ChatMessageRead]:
    return service.history(meeting_id)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear(meeting_id: str, service: ChatServiceDep) -> None:
    service.clear(meeting_id)


@router.post("")
def ask(meeting_id: str, body: ChatQuestion, service: ChatServiceDep) -> StreamingResponse:
    """Events: {type: status, message} · {type: token, text} · {type: done, message} · {type: error, message}."""
    events = service.ask(meeting_id, body.content, body.model)  # validation errors become 404/409 here

    def lines() -> Iterator[str]:
        for event in events:
            yield json.dumps(event, ensure_ascii=False) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"})
