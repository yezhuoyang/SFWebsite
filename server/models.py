"""SQLAlchemy ORM models."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from server.database import Base


class Volume(Base):
    __tablename__ = "volumes"

    id: Mapped[str] = mapped_column(String(10), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    namespace: Mapped[str] = mapped_column(String(10), nullable=False)
    chapter_count: Mapped[int] = mapped_column(Integer, default=0)
    exercise_count: Mapped[int] = mapped_column(Integer, default=0)
    total_points_standard: Mapped[float] = mapped_column(Float, default=0.0)
    total_points_advanced: Mapped[float] = mapped_column(Float, default=0.0)

    chapters: Mapped[list["Chapter"]] = relationship(back_populates="volume", cascade="all, delete-orphan")


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    volume_id: Mapped[str] = mapped_column(ForeignKey("volumes.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)
    exercise_count: Mapped[int] = mapped_column(Integer, default=0)
    max_points_standard: Mapped[float] = mapped_column(Float, default=0.0)
    max_points_advanced: Mapped[float] = mapped_column(Float, default=0.0)
    has_test_file: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (UniqueConstraint("volume_id", "name"),)

    volume: Mapped["Volume"] = relationship(back_populates="chapters")
    exercises: Mapped[list["Exercise"]] = relationship(back_populates="chapter", cascade="all, delete-orphan")


class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    stars: Mapped[int] = mapped_column(Integer, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    modifier: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    points: Mapped[float | None] = mapped_column(Float, nullable=True)
    line_start: Mapped[int] = mapped_column(Integer, nullable=False)
    line_end: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (UniqueConstraint("chapter_id", "name"),)

    chapter: Mapped["Chapter"] = relationship(back_populates="exercises")
    progress: Mapped["Progress | None"] = relationship(back_populates="exercise", uselist=False)


class Progress(Base):
    __tablename__ = "progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id"), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="not_started")
    points_earned: Mapped[float] = mapped_column(Float, default=0.0)
    last_graded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    compile_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    exercise: Mapped["Exercise"] = relationship(back_populates="progress")


class DailyActivity(Base):
    __tablename__ = "daily_activity"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    exercises_completed: Mapped[int] = mapped_column(Integer, default=0)
    points_earned: Mapped[float] = mapped_column(Float, default=0.0)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    volume_id: Mapped[str | None] = mapped_column(String(10), nullable=True)
    chapter_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    exercise_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    coq_state_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
