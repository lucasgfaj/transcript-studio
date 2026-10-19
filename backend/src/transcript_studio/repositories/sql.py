"""SQLModel implementations of the repository ports. Only this layer knows about SQL."""
from __future__ import annotations

from sqlalchemy import String, cast
from sqlmodel import Session, col, delete, or_, select

from transcript_studio.models import Meeting, MeetingStatus, Minutes, Segment


class SqlMeetingRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list(self, query: str | None = None, status: MeetingStatus | None = None) -> list[Meeting]:
        statement = select(Meeting)
        if query and query.strip():
            pattern = f"%{query.strip()}%"
            statement = statement.where(or_(
                col(Meeting.title).ilike(pattern),
                col(Meeting.transcript).ilike(pattern),
                cast(Meeting.participants, String).ilike(pattern),
            ))
        if status:
            statement = statement.where(Meeting.status == status)
        statement = statement.order_by(col(Meeting.date).desc(), col(Meeting.created_at).desc())
        return list(self._session.exec(statement).all())

    def get(self, meeting_id: str) -> Meeting | None:
        return self._session.get(Meeting, meeting_id)

    def find_by_source(self, source_ref: str) -> Meeting | None:
        return self._session.exec(select(Meeting).where(Meeting.source_ref == source_ref)).first()

    def save(self, meeting: Meeting) -> Meeting:
        self._session.add(meeting)
        self._session.commit()
        self._session.refresh(meeting)
        return meeting

    def delete(self, meeting: Meeting) -> None:
        # Segments and minutes go with it through ON DELETE CASCADE.
        self._session.delete(meeting)
        self._session.commit()


class SqlSegmentRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for(self, meeting_id: str) -> list[Segment]:
        statement = select(Segment).where(Segment.meeting_id == meeting_id).order_by(col(Segment.idx))
        return list(self._session.exec(statement).all())

    def delete_for(self, meeting_id: str) -> None:
        self._session.exec(delete(Segment).where(col(Segment.meeting_id) == meeting_id))
        self._session.commit()


class SqlMinutesRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for(self, meeting_id: str) -> list[Minutes]:
        statement = (select(Minutes).where(Minutes.meeting_id == meeting_id)
                     .order_by(col(Minutes.created_at).desc(), col(Minutes.id).desc()))
        return list(self._session.exec(statement).all())

    def meeting_ids_with_minutes(self) -> set[str]:
        return set(self._session.exec(select(Minutes.meeting_id).distinct()).all())

    def add(self, minutes: Minutes) -> Minutes:
        self._session.add(minutes)
        self._session.commit()
        self._session.refresh(minutes)
        return minutes
