"""Pydantic request/response schemas."""

from datetime import datetime

from pydantic import BaseModel


# --- Volume / Chapter / Exercise ---

class ExerciseOut(BaseModel):
    id: int
    name: str
    stars: int
    difficulty: str
    modifier: str | None
    is_manual: bool
    points: float | None
    line_start: int
    line_end: int | None
    status: str = "not_started"
    points_earned: float = 0.0

    class Config:
        from_attributes = True


class ChapterOut(BaseModel):
    id: int
    volume_id: str
    name: str
    display_order: int
    exercise_count: int
    max_points_standard: float
    max_points_advanced: float
    has_test_file: bool
    completed_count: int = 0
    total_points_earned: float = 0.0
    summary: str = ""
    line_count: int = 0

    class Config:
        from_attributes = True


class VolumeOut(BaseModel):
    id: str
    name: str
    namespace: str
    chapter_count: int
    exercise_count: int
    total_points_standard: float
    total_points_advanced: float
    completed_count: int = 0
    total_points_earned: float = 0.0

    class Config:
        from_attributes = True


# --- Coq Interactive Session ---

class CoqSessionCreate(BaseModel):
    volume_id: str
    chapter_name: str | None = None


class CoqSessionOut(BaseModel):
    session_id: str
    volume_id: str
    status: str


class CoqStepRequest(BaseModel):
    session_id: str
    code: str


class CoqGoal(BaseModel):
    hypotheses: list[str]
    conclusion: str


class CoqStepResult(BaseModel):
    sid: int
    goals: list[CoqGoal] | None = None
    error: str | None = None


class CoqCancelRequest(BaseModel):
    session_id: str
    sid: int


# --- Grading ---

class GradeRequest(BaseModel):
    full: bool = False


class ExerciseGradeResult(BaseModel):
    exercise_name: str
    status: str
    points_earned: float
    message: str | None = None


class GradeResult(BaseModel):
    volume_id: str
    chapter_name: str
    success: bool
    exercises: list[ExerciseGradeResult]
    compile_output: str | None = None


# --- Progress ---

class ProgressSummary(BaseModel):
    total_exercises: int
    completed_exercises: int
    total_points_possible: float
    total_points_earned: float
    completion_percentage: float
    current_streak: int
    longest_streak: int


class DailyActivityOut(BaseModel):
    date: str
    exercises_completed: int
    points_earned: float


# --- Tutor ---

class TutorChatRequest(BaseModel):
    message: str
    volume_id: str | None = None
    chapter_name: str | None = None
    exercise_name: str | None = None
    # Rich context from the live Coq session
    student_code: str | None = None
    proof_state_text: str | None = None
    diagnostics_text: str | None = None
    processed_lines: int | None = None
    # Legacy fields (kept for compatibility)
    current_goals: str | None = None
    current_error: str | None = None
    current_code: str | None = None


class TutorChatMessage(BaseModel):
    role: str
    content: str
    coq_state_snapshot: str | None = None
    created_at: datetime | None = None
