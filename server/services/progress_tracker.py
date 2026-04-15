"""Progress tracking service: update exercise status, streaks, daily activity."""

from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from server.models import Chapter, DailyActivity, Exercise, Progress
from server.services.grader import GradeResult


async def update_progress_from_grade(session: AsyncSession, grade_result: GradeResult, user_id: int | None = None) -> None:
    """Update exercise progress records based on grading results.

    PRIVACY: refuses to write if no user_id is supplied. Earlier versions
    silently defaulted to user_id=1 — that bucket-routed every anonymous
    grade into one user's account, leaking and corrupting their progress.
    """
    if user_id is None:
        # No authenticated user — silently skip persistence rather than
        # writing to a default account. The grader still returns the result
        # so the UI can display it; it just won't be remembered.
        return

    ch = (await session.execute(
        select(Chapter).where(
            Chapter.volume_id == grade_result.volume_id,
            Chapter.name == grade_result.chapter_name,
        )
    )).scalar_one_or_none()
    if not ch:
        return

    uid = user_id

    today_str = date.today().isoformat()
    new_completions = 0
    new_points = 0.0

    for ex_result in grade_result.exercises:
        # Find the exercise
        exercise = (await session.execute(
            select(Exercise).where(
                Exercise.chapter_id == ch.id,
                Exercise.name == ex_result.exercise_name,
            )
        )).scalar_one_or_none()
        if not exercise:
            continue

        # Get or create progress record (per user)
        progress = (await session.execute(
            select(Progress).where(
                Progress.user_id == uid,
                Progress.exercise_id == exercise.id,
            )
        )).scalar_one_or_none()

        if not progress:
            progress = Progress(user_id=uid, exercise_id=exercise.id)
            session.add(progress)

        old_status = progress.status

        progress.status = ex_result.status
        progress.points_earned = ex_result.points_earned
        progress.last_graded_at = datetime.utcnow()
        # Store feedback + error excerpt (if any) for UI history
        fb_parts = [ex_result.feedback]
        if ex_result.error_detail:
            fb_parts.append(ex_result.error_detail)
        progress.compile_output = "\n".join(p for p in fb_parts if p)

        # Track new completions
        if ex_result.status == "completed" and old_status != "completed":
            new_completions += 1
            new_points += ex_result.points_earned

    # Update daily activity (per user)
    if new_completions > 0:
        activity = (await session.execute(
            select(DailyActivity).where(
                DailyActivity.user_id == uid,
                DailyActivity.date == today_str,
            )
        )).scalar_one_or_none()

        if not activity:
            activity = DailyActivity(user_id=uid, date=today_str, exercises_completed=0, points_earned=0.0)
            session.add(activity)

        activity.exercises_completed = (activity.exercises_completed or 0) + new_completions
        activity.points_earned = (activity.points_earned or 0) + new_points

    await session.commit()


async def get_streak_info(session: AsyncSession, user_id: int | None = None) -> dict:
    """Calculate current and longest streaks for ONE user.

    PRIVACY: when no user_id is provided we return zeros instead of
    aggregating across every user. The previous behaviour leaked the
    union of everyone's activity to anonymous callers.
    """
    if user_id is None:
        return {"current_streak": 0, "longest_streak": 0, "heatmap": []}
    q = (
        select(DailyActivity.date)
        .where(DailyActivity.exercises_completed > 0)
        .where(DailyActivity.user_id == user_id)
    )
    result = await session.execute(q.order_by(DailyActivity.date.desc()))
    active_dates = [row[0] for row in result.all()]

    if not active_dates:
        return {"current_streak": 0, "longest_streak": 0, "heatmap": []}

    # Parse dates
    dates = sorted([date.fromisoformat(d) for d in active_dates], reverse=True)

    # Current streak (consecutive days ending today or yesterday)
    today = date.today()
    current_streak = 0
    check_date = today

    for d in dates:
        if d == check_date or d == check_date - timedelta(days=1):
            current_streak += 1
            check_date = d - timedelta(days=1)
        else:
            break

    # Longest streak
    longest = 1
    current_run = 1
    sorted_dates = sorted(dates)
    for i in range(1, len(sorted_dates)):
        if (sorted_dates[i] - sorted_dates[i - 1]).days == 1:
            current_run += 1
            longest = max(longest, current_run)
        else:
            current_run = 1

    # Heatmap data (last 365 days) — also user-scoped
    q_heat = (
        select(DailyActivity)
        .where(DailyActivity.date >= (today - timedelta(days=365)).isoformat())
        .where(DailyActivity.user_id == user_id)
    )
    all_activity = (await session.execute(q_heat.order_by(DailyActivity.date))).scalars().all()

    heatmap = [
        {"date": a.date, "count": a.exercises_completed, "points": a.points_earned}
        for a in all_activity
    ]

    return {
        "current_streak": current_streak,
        "longest_streak": longest if active_dates else 0,
        "heatmap": heatmap,
    }


async def get_progress_summary(session: AsyncSession, user_id: int | None = None) -> dict:
    """Get progress statistics for ONE user.

    PRIVACY: no user_id means zeros (no cross-user aggregation).
    """
    total = (await session.execute(select(func.count(Exercise.id)))).scalar() or 0
    total_pts = (await session.execute(
        select(func.coalesce(func.sum(Exercise.points), 0.0))
    )).scalar() or 0.0

    if user_id is None:
        return {
            "total_exercises": total,
            "completed_exercises": 0,
            "total_points_possible": total_pts,
            "total_points_earned": 0.0,
            "completion_percentage": 0,
            "current_streak": 0,
            "longest_streak": 0,
        }

    q_comp = (
        select(func.count(Progress.id))
        .where(Progress.status == "completed")
        .where(Progress.user_id == user_id)
    )
    q_pts = (
        select(func.coalesce(func.sum(Progress.points_earned), 0.0))
        .where(Progress.user_id == user_id)
    )
    completed = (await session.execute(q_comp)).scalar() or 0
    pts = (await session.execute(q_pts)).scalar() or 0.0

    streak = await get_streak_info(session, user_id)

    return {
        "total_exercises": total,
        "completed_exercises": completed,
        "total_points_possible": total_pts,
        "total_points_earned": pts,
        "completion_percentage": round((completed / total * 100) if total else 0, 1),
        "current_streak": streak["current_streak"],
        "longest_streak": streak["longest_streak"],
    }
