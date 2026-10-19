"""SQLModel implementations of the repository ports. Only this layer knows about SQL."""
from __future__ import annotations

from sqlalchemy import String, cast
from sqlalchemy.engine import Engine
from sqlmodel import Session, col, delete, or_, select

from transcript_studio.models import AppSetting, ChatMessage, Job, JobKind, JobStatus, Meeting, MeetingStatus, Minutes, Segment


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

    def replace_for(self, meeting_id: str, segments: list[Segment]) -> None:
        self._session.exec(delete(Segment).where(col(Segment.meeting_id) == meeting_id))
        self._session.add_all(segments)
        self._session.commit()


class SqlUnitOfWork:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def __enter__(self) -> SqlUnitOfWork:
        self._session = Session(self._engine)
        self.jobs = SqlJobRepository(self._session)
        self.meetings = SqlMeetingRepository(self._session)
        self.segments = SqlSegmentRepository(self._session)
        self.minutes = SqlMinutesRepository(self._session)
        return self

    def __exit__(self, *exc: object) -> None:
        self._session.close()


class SqlJobRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, job_id: str) -> Job | None:
        return self._session.get(Job, job_id)

    def save(self, job: Job) -> Job:
        self._session.add(job)
        self._session.commit()
        self._session.refresh(job)
        return job

    def latest_for(self, meeting_id: str, kind: JobKind | None = None) -> Job | None:
        statement = select(Job).where(Job.meeting_id == meeting_id).order_by(col(Job.created_at).desc())
        if kind:
            statement = statement.where(Job.kind == kind)
        return self._session.exec(statement.limit(1)).first()

    def active_for(self, meeting_id: str) -> Job | None:
        statement = select(Job).where(Job.meeting_id == meeting_id,
                                      col(Job.status).in_([JobStatus.queued, JobStatus.running]))
        return self._session.exec(statement.limit(1)).first()

    def list_active(self) -> list[Job]:
        statement = (select(Job).where(col(Job.status).in_([JobStatus.queued, JobStatus.running]))
                     .order_by(col(Job.created_at)))
        return list(self._session.exec(statement).all())


class SqlMinutesRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for(self, meeting_id: str) -> list[Minutes]:
        statement = (select(Minutes).where(Minutes.meeting_id == meeting_id)
                     .order_by(col(Minutes.created_at).desc(), col(Minutes.id).desc()))
        return list(self._session.exec(statement).all())

    def meeting_ids_with_minutes(self) -> set[str]:
        return set(self._session.exec(select(Minutes.meeting_id).distinct()).all())

    def get(self, minutes_id: int) -> Minutes | None:
        return self._session.get(Minutes, minutes_id)

    def add(self, minutes: Minutes) -> Minutes:
        self._session.add(minutes)
        self._session.commit()
        self._session.refresh(minutes)
        return minutes


class SqlSettingRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def all(self) -> dict[str, str]:
        return {row.key: row.value for row in self._session.exec(select(AppSetting)).all()}

    def set(self, key: str, value: str) -> None:
        row = self._session.get(AppSetting, key) or AppSetting(key=key, value=value)
        row.value = value
        self._session.add(row)
        self._session.commit()


class SqlChatRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for(self, meeting_id: str) -> list[ChatMessage]:
        statement = select(ChatMessage).where(ChatMessage.meeting_id == meeting_id).order_by(col(ChatMessage.id))
        return list(self._session.exec(statement).all())

    def add(self, message: ChatMessage) -> ChatMessage:
        self._session.add(message)
        self._session.commit()
        self._session.refresh(message)
        return message

    def clear(self, meeting_id: str) -> None:
        self._session.exec(delete(ChatMessage).where(col(ChatMessage.meeting_id) == meeting_id))
        self._session.commit()
