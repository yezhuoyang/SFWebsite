"""Auto-grading service: static analysis + coqc compilation."""

import asyncio
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from server.config import COQC_PATH, VOLUMES
from server.services.parser import parse_exercises, parse_test_file

logger = logging.getLogger(__name__)


@dataclass
class ExerciseGradeResult:
    exercise_name: str
    # Status values:
    #   "completed"     - Proof verified
    #   "not_started"   - Still has Admitted/FILL IN HERE
    #   "compile_error" - Code doesn't compile
    #   "tampered"      - User modified template/deleted required code
    status: str
    points_earned: float
    feedback: str    # User-facing message explaining the result
    error_detail: str | None = None  # Compile error excerpt, if any


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
                feedback="\u2705 Looks good! No Admitted markers detected.",
            ))
        else:
            results.append(ExerciseGradeResult(
                exercise_name=ex.name,
                status="not_started",
                points_earned=0.0,
                feedback="\u26A0 You still have Admitted or FILL IN HERE. Replace it with a real proof.",
            ))

    return GradeResult(
        volume_id=volume_id,
        chapter_name=chapter_name,
        success=True,
        exercises=results,
    )


async def full_grade(volume_id: str, chapter_name: str) -> GradeResult:
    """Tier 2: Full compilation with coqc + static analysis + tampering detection."""
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

    # Parse exercises in current file
    exercises = parse_exercises(v_file)
    test_file = Path(vol["path"]) / f"{chapter_name}Test.v"
    test_points = parse_test_file(test_file) if test_file.exists() else {}

    # Per-exercise tamper detection: each exercise is considered tampered
    # only if ITS OWN template declaration is gone. Unrelated theorems
    # added/renamed elsewhere are the student's prerogative.
    current_text = v_file.read_text(encoding="utf-8", errors="replace")
    _IDENT_RE = re.compile(
        r'\b(?:Theorem|Lemma|Definition|Fixpoint|Example|Corollary|'
        r'Inductive|Fact|Remark|Proposition|CoFixpoint|Function)\s+(\w+)\b'
    )
    current_names = {m.group(1) for m in _IDENT_RE.finditer(current_text)}

    results = []
    for ex in exercises:
        pts = test_points.get(ex.name, float(ex.stars))

        # Detect: compile error
        if not compiled_ok:
            error_excerpt = _extract_error_for_exercise(compile_output, ex.name)
            results.append(ExerciseGradeResult(
                exercise_name=ex.name,
                status="compile_error",
                points_earned=0.0,
                feedback=(
                    f"\u274C Your code doesn't compile. Coq reported errors that prevent grading. "
                    f"Check the exact error message below and fix the issue."
                ),
                error_detail=error_excerpt or _short_compile_error(compile_output),
            ))
            continue

        # Detect: tampering — only check that THIS exercise's own theorem /
        # definition still exists in the file. We don't care about unrelated
        # theorems being added or renamed; each exercise is graded against
        # its own target only. This matches user intent: you should be able
        # to add as many helper lemmas as you like, rearrange the file, or
        # skip ahead — as long as you didn't delete the template declaration
        # for the exercise being graded.
        if ex.status == "completed" and ex.name not in current_names:
            results.append(ExerciseGradeResult(
                exercise_name=ex.name,
                status="tampered",
                points_earned=0.0,
                feedback=(
                    f"\u26A0 The template declaration for `{ex.name}` is missing. "
                    f"You can add helper lemmas freely, but don't delete or rename "
                    f"the original Theorem/Lemma that this exercise was asking you to prove."
                ),
            ))
            continue

        # Detect: still has Admitted / FILL IN HERE
        if ex.status != "completed":
            results.append(ExerciseGradeResult(
                exercise_name=ex.name,
                status="not_started",
                points_earned=0.0,
                feedback=(
                    f"\u26A0 You still have Admitted or FILL IN HERE in this exercise. "
                    f"Remove the Admitted and write a real proof to get credit."
                ),
            ))
            continue

        # All checks passed: completed
        results.append(ExerciseGradeResult(
            exercise_name=ex.name,
            status="completed",
            points_earned=pts,
            feedback=f"\U0001F389 Proof verified by Coq! You earned {pts} point(s).",
        ))

    return GradeResult(
        volume_id=volume_id,
        chapter_name=chapter_name,
        success=compiled_ok,
        exercises=results,
        compile_output=compile_output if not compiled_ok else None,
    )


async def full_grade_exercise(
    volume_id: str, chapter_name: str, exercise_name: str
) -> GradeResult:
    """Per-exercise grade: compile only up to (and including) the target
    exercise, so unrelated errors later in the file don't block judgment,
    and we don't waste time on exercises the user didn't submit.

    Strategy: write a truncated copy of the saved .v file to a temporary
    `{chapter}__grade_{ex}.v` next to the original, close any open Modules /
    Sections, and run coqc on that.
    """
    if volume_id not in VOLUMES:
        return GradeResult(volume_id, chapter_name, False, [], "Unknown volume")
    vol = VOLUMES[volume_id]
    vol_path = str(vol["path"])
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        return GradeResult(volume_id, chapter_name, False, [], f"{chapter_name}.v not found")

    # Locate target exercise in the user's saved file
    exercises = parse_exercises(v_file)
    target = next((ex for ex in exercises if ex.name == exercise_name), None)
    if target is None:
        return GradeResult(
            volume_id, chapter_name, False, [],
            f"Exercise '{exercise_name}' not found in {chapter_name}.v",
        )

    # Figure out where to truncate
    text = v_file.read_text(encoding="utf-8", errors="replace")
    lines = text.split("\n")
    # If parser couldn't find the (** [] *) marker (line_end is None), fall
    # back to the exercise's line_start + a few hundred lines or EOF.
    cutoff = target.line_end if target.line_end is not None else min(target.line_start + 400, len(lines))
    truncated = "\n".join(lines[:cutoff])

    # Close any open Module / Section scopes left dangling by truncation
    closers = _close_open_scopes(truncated)
    if closers:
        truncated += "\n\n" + "\n".join(closers) + "\n"

    # Write to a sibling temp file so the real .v stays on disk for the user
    temp_path = v_file.with_name(f"{chapter_name}__grade_{exercise_name}.v")
    try:
        temp_path.write_text(truncated, encoding="utf-8")

        cmd = [str(COQC_PATH)] + vol["coq_flags"] + [temp_path.name]
        logger.info(f"Per-exercise compile: {' '.join(cmd)} in {vol_path}")

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=vol_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=90)
            compile_output = (stdout.decode() + "\n" + stderr.decode()).strip()
            compiled_ok = proc.returncode == 0
        except asyncio.TimeoutError:
            compile_output = "Compilation timed out (90s)"
            compiled_ok = False
        except Exception as e:
            compile_output = str(e)
            compiled_ok = False

        # Re-parse the truncated file to find the target exercise's final status
        truncated_exercises = parse_exercises(temp_path)
        ex = next((e for e in truncated_exercises if e.name == exercise_name), None)

        test_file = Path(vol["path"]) / f"{chapter_name}Test.v"
        test_points = parse_test_file(test_file) if test_file.exists() else {}
        pts = test_points.get(exercise_name, float(ex.stars if ex else target.stars))

        # Tamper detection: did the user remove THIS exercise's theorem/
        # definition? We only check the target's own identifier. Previously
        # we compared the full set of theorems between original-truncated
        # and user-truncated at the same line number, but that falsely
        # accused students who added many helper lemmas above the target
        # (their truncation extends past the original's, so theorems that
        # originally appeared AFTER the target show up as "missing").
        _IDENT_RE = re.compile(
            r'\b(?:Theorem|Lemma|Definition|Fixpoint|Example|Corollary|'
            r'Inductive|Fact|Remark|Proposition|CoFixpoint|Function)\s+(\w+)\b'
        )
        declared_names = {m.group(1) for m in _IDENT_RE.finditer(truncated)}
        target_missing = exercise_name not in declared_names

        if not compiled_ok:
            err = _extract_error_for_exercise(compile_output, exercise_name) or _short_compile_error(compile_output)
            return GradeResult(
                volume_id=volume_id,
                chapter_name=chapter_name,
                success=False,
                exercises=[ExerciseGradeResult(
                    exercise_name=exercise_name,
                    status="compile_error",
                    points_earned=0.0,
                    feedback=(
                        "\u274C Your code doesn't compile up to the end of this exercise. "
                        "Only the code needed for this exercise was compiled — fix the error below."
                    ),
                    error_detail=err,
                )],
                compile_output=compile_output,
            )

        if target_missing and ex and ex.status == "completed":
            return GradeResult(
                volume_id=volume_id,
                chapter_name=chapter_name,
                success=True,
                exercises=[ExerciseGradeResult(
                    exercise_name=exercise_name,
                    status="tampered",
                    points_earned=0.0,
                    feedback=(
                        f"\u26A0 The template declaration for `{exercise_name}` is missing. "
                        f"You can add as many helper lemmas as you like, but don't delete "
                        f"or rename the original Theorem/Lemma that this exercise was asking "
                        f"you to prove."
                    ),
                )],
            )

        if ex is None or ex.status != "completed":
            return GradeResult(
                volume_id=volume_id,
                chapter_name=chapter_name,
                success=True,
                exercises=[ExerciseGradeResult(
                    exercise_name=exercise_name,
                    status="not_started",
                    points_earned=0.0,
                    feedback=(
                        "\u26A0 You still have Admitted or FILL IN HERE in this exercise. "
                        "Remove them and write a real proof / definition to get credit."
                    ),
                )],
            )

        return GradeResult(
            volume_id=volume_id,
            chapter_name=chapter_name,
            success=True,
            exercises=[ExerciseGradeResult(
                exercise_name=exercise_name,
                status="completed",
                points_earned=pts,
                feedback=f"\U0001F389 Proof verified by Coq! You earned {pts} point(s).",
            )],
        )
    finally:
        # Clean up temp file
        try:
            temp_path.unlink(missing_ok=True)
            # Also clean up coqc byproducts
            for suffix in (".vo", ".vok", ".vos", ".glob"):
                p = temp_path.with_suffix(suffix)
                p.unlink(missing_ok=True)
        except Exception:
            pass


# Regexes to track Module / Section nesting across truncated content.
# We skip single-line module aliases (`Module X := Y.`) which don't need closing.
_MODULE_OPEN_RE = re.compile(r'^\s*Module\s+(?:Type\s+)?(\w+)(?![\w])')
_SECTION_OPEN_RE = re.compile(r'^\s*Section\s+(\w+)\s*\.')
_END_RE = re.compile(r'^\s*End\s+(\w+)\s*\.')


def _close_open_scopes(text: str) -> list[str]:
    """Return `End X.` statements needed to close any Module/Section blocks
    left open by truncation. Single-line `Module X := Y.` aliases are ignored."""
    stack: list[str] = []
    in_comment = 0
    for line in text.split("\n"):
        # Toggle comment depth (conservative: a single line can open AND close)
        j = 0
        while j < len(line) - 1:
            if line[j] == '(' and line[j + 1] == '*':
                in_comment += 1
                j += 2
                continue
            if line[j] == '*' and line[j + 1] == ')' and in_comment:
                in_comment -= 1
                j += 2
                continue
            j += 1
        if in_comment:
            continue

        stripped = line.strip()
        if not stripped or stripped.startswith('(*'):
            continue

        m = _MODULE_OPEN_RE.match(line)
        if m and ':=' not in line:
            stack.append(m.group(1))
            continue
        m = _SECTION_OPEN_RE.match(line)
        if m:
            stack.append(m.group(1))
            continue
        m = _END_RE.match(line)
        if m and stack and stack[-1] == m.group(1):
            stack.pop()

    return [f"End {name}." for name in reversed(stack)]


def _short_compile_error(output: str, max_lines: int = 8) -> str:
    """Extract a short, useful excerpt from coqc output."""
    if not output:
        return ""
    lines = [l for l in output.split("\n") if l.strip()]
    # Find the first line containing 'Error' and take a few lines around it
    for i, l in enumerate(lines):
        if "Error" in l or "error" in l:
            start = max(0, i - 1)
            end = min(len(lines), i + max_lines)
            return "\n".join(lines[start:end])
    return "\n".join(lines[:max_lines])


def _extract_error_for_exercise(output: str, exercise_name: str) -> str | None:
    """Try to find compile error lines that mention this exercise."""
    if not output or not exercise_name:
        return None
    lines = output.split("\n")
    for i, l in enumerate(lines):
        if exercise_name in l and ("Error" in l or "error" in l or "File" in l):
            start = max(0, i - 1)
            end = min(len(lines), i + 6)
            return "\n".join(lines[start:end])
    return None
