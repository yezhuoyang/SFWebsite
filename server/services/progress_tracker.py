"""Progress tracking service: update exercise status, streaks, daily activity."""

from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from server.models import Chapter, DailyActivity, Exercise, Progress
from server.services.grader import GradeResult


async def update_progress_from_grade(session: AsyncSession, grade_result: GradeResult) -> None:
    """Update exercise progress records based on grading results."""
    # Find the chapter
    ch = (await session.execute(
        select(Chapter).where(
            Chapter.volume_id == grade_result.volume_id,
            Chapter.name == grade_result.chapter_name,
        )
    )).scalar_one_or_none()
    if not ch:
        return

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

        # Get or create progress record
        progress = (await session.execute(
            select(Progress).where(Progress.exercise_id == exercise.id)
        )).scalar_one_or_none()

        if not progress:
            progress = Progress(exercise_id=exercise.id)
            session.add(progress)

        old_status = progress.status

        progress.status = ex_result.status
        progress.points_earned = ex_result.points_earned
        progress.last_graded_at = datetime.utcnow()
        progress.compile_output = ex_result.message

        # Track new completions
        if ex_result.status == "completed" and old_status != "completed":
            new_completions += 1
            new_points += ex_result.points_earned

    # Update daily activity
    if new_completions > 0:
        activity = (await session.execute(
            select(DailyActivity).where(DailyActivity.date == today_str)
        )).scalar_one_or_none()

        if not activity:
            activity = DailyActivity(date=today_str, exercises_completed=0, points_earned=0.0)
            session.add(activity)

        activity.exercises_completed = (activity.exercises_completed or 0) + new_completions
        activity.points_earned = (activity.points_earned or 0) + new_points

    await session.commit()


async def get_streak_info(session: AsyncSession) -> dict:
    """Calculate current and longest streaks."""
    result = await session.execute(
        select(DailyActivity.date)
        .where(DailyActivity.exercises_completed > 0)
        .order_by(DailyActivity.date.desc())
    )
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

    # Heatmap data (last 365 days)
    all_activity = (await session.execute(
        select(DailyActivity)
        .where(DailyActivity.date >= (today - timedelta(days=365)).isoformat())
        .order_by(DailyActivity.date)
    )).scalars().all()

    heatmap = [
        {"date": a.date, "count": a.exercises_completed, "points": a.points_earned}
        for a in all_activity
    ]

    return {
        "current_streak": current_streak,
        "longest_streak": longest if active_dates else 0,
        "heatmap": heatmap,
    }


async def get_progress_summary(session: AsyncSession) -> dict:
    """Get global progress statistics."""
    total = (await session.execute(select(func.count(Exercise.id)))).scalar() or 0
    completed = (await session.execute(
        select(func.count(Progress.id)).where(Progress.status == "completed")
    )).scalar() or 0
    pts = (await session.execute(
        select(func.coalesce(func.sum(Progress.points_earned), 0.0))
    )).scalar() or 0.0
    total_pts = (await session.execute(
        select(func.coalesce(func.sum(Exercise.points), 0.0))
    )).scalar() or 0.0

    streak = await get_streak_info(session)

    return {
        "total_exercises": total,
        "completed_exercises": completed,
        "total_points_possible": total_pts,
        "total_points_earned": pts,
        "completion_percentage": round((completed / total * 100) if total else 0, 1),
        "current_streak": streak["current_streak"],
        "longest_streak": streak["longest_streak"],
    }
