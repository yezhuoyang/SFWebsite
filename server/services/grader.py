"""Auto-grading service: static analysis + coqc compilation."""

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from server.config import COQC_PATH, VOLUMES
from server.services.parser import parse_exercises, parse_test_file

logger = logging.getLogger(__name__)


@dataclass
class ExerciseGradeResult:
    exercise_name: str
    status: str  # "completed", "not_started", "compile_error"
    points_earned: float
    message: str | None = None


@dataclass
class GradeResult:
    volume_id: str
    chapter_name: str
    success: bool
    exercises: list[ExerciseGradeResult]
    compile_output: str | None = None


async def quick_grade(volume_id: str, chapter_name: str) -> GradeResult:
    """Tier 1: Fast static analysis — check for Admitted/FILL IN HERE markers."""
    if volume_id not in VOLUMES:
        return GradeResult(volume_id, chapter_name, False, [], "Unknown volume")

    vol = VOLUMES[volume_id]
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        return GradeResult(volume_id, chapter_name, False, [], f"{chapter_name}.v not found")

    # Parse exercises
    exercises = parse_exercises(v_file)

    # Get test points if available
    test_file = Path(vol["path"]) / f"{chapter_name}Test.v"
    test_points = parse_test_file(test_file) if test_file.exists() else {}

    results = []
    for ex in exercises:
        pts = test_points.get(ex.name, float(ex.stars))

        if ex.status == "completed":
            results.append(ExerciseGradeResult(
                exercise_name=ex.name,
                status="completed",
                points_earned=pts,
                message="No Admitted/FILL IN HERE markers found",
            ))
        else:
            results.append(ExerciseGradeResult(
                exercise_name=ex.name,
                status="not_started",
                points_earned=0.0,
                message="Contains Admitted or FILL IN HERE",
            ))

    return GradeResult(
        volume_id=volume_id,
        chapter_name=chapter_name,
        success=True,
        exercises=results,
    )


async def full_grade(volume_id: str, chapter_name: str) -> GradeResult:
    """Tier 2: Full compilation with coqc + static analysis."""
    if volume_id not in VOLUMES:
        return GradeResult(volume_id, chapter_name, False, [], "Unknown volume")

    vol = VOLUMES[volume_id]
    vol_path = str(vol["path"])
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        return GradeResult(volume_id, chapter_name, False, [], f"{chapter_name}.v not found")

    # First try to compile
    cmd = [str(COQC_PATH)] + vol["coq_flags"] + [f"{chapter_name}.v"]
    logger.info(f"Compiling: {' '.join(cmd)} in {vol_path}")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=vol_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        compile_output = (stdout.decode() + "\n" + stderr.decode()).strip()
        compiled_ok = proc.returncode == 0
    except asyncio.TimeoutError:
        compile_output = "Compilation timed out (120s)"
        compiled_ok = False
    except Exception as e:
        compile_output = str(e)
        compiled_ok = False

    # Parse exercises for static analysis
    exercises = parse_exercises(v_file)
    test_file = Path(vol["path"]) / f"{chapter_name}Test.v"
    test_points = parse_test_file(test_file) if test_file.exists() else {}

    results = []
    for ex in exercises:
        pts = test_points.get(ex.name, float(ex.stars))

        if not compiled_ok:
            results.append(ExerciseGradeResult(
                exercise_name=ex.name,
                status="compile_error",
                points_earned=0.0,
                message="Chapter failed to compile",
            ))
        elif ex.status == "completed":
            results.append(ExerciseGradeResult(
                exercise_name=ex.name,
                status="completed",
                points_earned=pts,
                message="Proof verified by Coq",
            ))
        else:
            results.append(ExerciseGradeResult(
                exercise_name=ex.name,
                status="not_started",
                points_earned=0.0,
                message="Contains Admitted or FILL IN HERE",
            ))

    return GradeResult(
        volume_id=volume_id,
        chapter_name=chapter_name,
        success=compiled_ok,
        exercises=results,
        compile_output=compile_output if not compiled_ok else None,
    )
