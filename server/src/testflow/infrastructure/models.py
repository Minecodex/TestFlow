"""Mutable identities, append-only versions and durable execution records."""
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from testflow.infrastructure.database import Base

Document = JSON().with_variant(JSONB(), "postgresql")


def uid() -> str:
    return str(uuid4())


def now() -> datetime:
    return datetime.now(UTC)


class Resource(Base):
    __tablename__ = "resources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(256))
    version: Mapped[int] = mapped_column(default=1)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Revision(Base):
    __tablename__ = "revisions"
    __table_args__ = (UniqueConstraint("resource_id", "number"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    resource_id: Mapped[str] = mapped_column(ForeignKey("resources.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(Document)
    digest: Mapped[str] = mapped_column(String(64))
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Credential(Base):
    __tablename__ = "credentials"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(256))
    kind: Mapped[str] = mapped_column(String(32))
    encrypted: Mapped[str] = mapped_column(Text)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Idempotency(Base):
    __tablename__ = "idempotency"
    __table_args__ = (UniqueConstraint("scope", "key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    scope: Mapped[str] = mapped_column(String(128))
    key: Mapped[str] = mapped_column(String(128))
    fingerprint: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(Document)


class Operation(Base):
    __tablename__ = "operations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(48))
    state: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    progress: Mapped[int] = mapped_column(default=0)
    payload: Mapped[dict] = mapped_column(Document)
    result: Mapped[dict] = mapped_column(Document, default=dict)
    error: Mapped[dict | None] = mapped_column(Document, nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(256))
    state: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    hidden: Mapped[bool] = mapped_column(default=False)
    snapshot: Mapped[dict] = mapped_column(Document)
    requested_concurrency: Mapped[int] = mapped_column(default=1)
    effective_concurrency: Mapped[int] = mapped_column(default=1)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PlanItem(Base):
    __tablename__ = "plan_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), index=True)
    pair_id: Mapped[str] = mapped_column(String(36))
    position: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(Document)
    state: Mapped[str] = mapped_column(String(32), default="queued", index=True)


class Execution(Base):
    __tablename__ = "executions"
    __table_args__ = (UniqueConstraint("item_id", "attempt"), UniqueConstraint("root_id", "attempt", name="uq_execution_root_attempt"))
    root_id: Mapped[str] = mapped_column(String(36), default=uid, index=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    item_id: Mapped[str | None] = mapped_column(ForeignKey("plan_items.id"), nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id"), nullable=True, index=True)
    batch_id: Mapped[str] = mapped_column(String(36), index=True)
    attempt: Mapped[int] = mapped_column(default=1)
    name: Mapped[str] = mapped_column(String(256))
    state: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    cleanup: Mapped[str] = mapped_column(String(32), default="pending")
    trace_id: Mapped[str] = mapped_column(String(36), default=uid)
    snapshot: Mapped[dict] = mapped_column(Document)
    actual_inputs: Mapped[dict] = mapped_column(Document, default=dict)
    output: Mapped[dict] = mapped_column(Document, default=dict)
    nodes: Mapped[dict] = mapped_column(Document, default=dict)
    winner: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[dict | None] = mapped_column(Document, nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(nullable=True)


class Evaluation(Base):
    __tablename__ = "evaluations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    execution_id: Mapped[str] = mapped_column(ForeignKey("executions.id"), index=True)
    state: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    profile: Mapped[dict] = mapped_column(Document)
    result: Mapped[dict] = mapped_column(Document, default=dict)
    error: Mapped[dict | None] = mapped_column(Document, nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    ended: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), index=True)
    snapshot: Mapped[dict] = mapped_column(Document)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    execution_id: Mapped[str | None] = mapped_column(ForeignKey("executions.id"), nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(64))
    node_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    data: Mapped[dict] = mapped_column(Document, default=dict)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Runtime(Base):
    __tablename__ = "runtimes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    key: Mapped[str] = mapped_column(String(64), index=True)
    batch_id: Mapped[str] = mapped_column(String(36), index=True)
    pod_name: Mapped[str] = mapped_column(String(128))
    state: Mapped[str] = mapped_column(String(32), default="preparing")
    address: Mapped[str | None] = mapped_column(String(256), nullable=True)
    image_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    snapshot: Mapped[dict] = mapped_column(Document)
    token: Mapped[str] = mapped_column(Text)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
