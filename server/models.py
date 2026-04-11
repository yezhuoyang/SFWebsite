"""SQLAlchemy ORM models."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, Index
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
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="not_started")
    points_earned: Mapped[float] = mapped_column(Float, default=0.0)
    last_graded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    compile_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "exercise_id"),)

    exercise: Mapped["Exercise"] = relationship(back_populates="progress")


class DailyActivity(Base):
    __tablename__ = "daily_activity"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    date: Mapped[str] = mapped_column(String(10), nullable=False)
    exercises_completed: Mapped[int] = mapped_column(Integer, default=0)
    points_earned: Mapped[float] = mapped_column(Float, default=0.0)

    __table_args__ = (UniqueConstraint("user_id", "date"),)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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


# --- Social Features ---

class Discussion(Base):
    __tablename__ = "discussions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    volume_id: Mapped[str] = mapped_column(String(10), nullable=False)
    chapter_name: Mapped[str] = mapped_column(String(100), nullable=False)
    exercise_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    code_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    upvotes: Mapped[int] = mapped_column(Integer, default=0)
    reply_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_discussions_chapter", "volume_id", "chapter_name"),)

    user: Mapped["User"] = relationship()
    replies: Mapped[list["DiscussionReply"]] = relationship(back_populates="discussion", cascade="all, delete-orphan")


class DiscussionReply(Base):
    __tablename__ = "discussion_replies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    discussion_id: Mapped[int] = mapped_column(ForeignKey("discussions.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    parent_reply_id: Mapped[int | None] = mapped_column(ForeignKey("discussion_replies.id"), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    upvotes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    discussion: Mapped["Discussion"] = relationship(back_populates="replies")
    user: Mapped["User"] = relationship()


class Vote(Base):
    __tablename__ = "votes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)  # discussion, reply, annotation, solution
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "target_type", "target_id"),)


class SharedSolution(Base):
    __tablename__ = "shared_solutions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id"), nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    upvotes: Mapped[int] = mapped_column(Integer, default=0)
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Allow multiple submissions per user per exercise (LeetCode-style history)
    __table_args__ = (Index("ix_shared_solutions_exercise", "exercise_id"),)

    user: Mapped["User"] = relationship()
    exercise: Mapped["Exercise"] = relationship()
    comments: Mapped[list["SolutionComment"]] = relationship(
        back_populates="solution", cascade="all, delete-orphan"
    )


class SolutionComment(Base):
    __tablename__ = "solution_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    solution_id: Mapped[int] = mapped_column(ForeignKey("shared_solutions.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_solution_comments_solution", "solution_id"),)

    solution: Mapped["SharedSolution"] = relationship(back_populates="comments")
    user: Mapped["User"] = relationship()


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    volume_id: Mapped[str] = mapped_column(String(10), nullable=False)
    chapter_name: Mapped[str] = mapped_column(String(100), nullable=False)
    block_id: Mapped[int] = mapped_column(Integer, nullable=False)
    selected_text: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#f59e0b")
    start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    start_col: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_col: Mapped[int] = mapped_column(Integer, nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    upvotes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (Index("ix_annotations_chapter", "volume_id", "chapter_name"),)

    user: Mapped["User"] = relationship()
