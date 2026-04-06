"""Parse .v files to extract exercise metadata and completion status.

Exercise format in Software Foundations:
  (** **** Exercise: N stars, standard|advanced [, optional|especially useful] (exercise_name)
  ... exercise body ...
  (** [] *)

Incomplete markers:
  (* FILL IN HERE *)
  (* REPLACE THIS LINE WITH ":= _your_definition_ ." *)
  Admitted.

Manual grading:
  Definition manual_grade_for_<name> : option (nat*string) := None.
"""

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ParsedExercise:
    name: str
    stars: int
    difficulty: str        # "standard" or "advanced"
    modifier: str | None   # "optional", "especially useful", or None
    is_manual: bool
    line_start: int        # 1-indexed line number of exercise header
    line_end: int | None   # 1-indexed line number of end marker
    status: str            # "not_started" or "completed"


# Regex for exercise header
# Examples:
#   (** **** Exercise: 1 star, standard (nandb)
#   (** **** Exercise: 2 stars, standard, especially useful (basic_induction)
#   (** **** Exercise: 2 stars, standard, optional (decreasing)
EXERCISE_HEADER_RE = re.compile(
    r'\(\*\*\s+\*{4}\s+Exercise:\s+'
    r'(\d+)\s+stars?,\s+'           # N star(s)
    r'(standard|advanced)'           # difficulty
    r'(?:,\s+(optional|especially useful))?' # optional modifier
    r'\s+\(([^)]+)\)',              # (exercise_name)
    re.IGNORECASE
)

# Exercise end marker
# Exercise end marker: (** [] *) or (* ... [] *) — both single and double star
EXERCISE_END_RE = re.compile(r'\(\*\*?\s+\[\]\s*\*\)|\[\]\s*\*\)')

# Incomplete markers
FILL_IN_HERE_RE = re.compile(r'\(\*\s+FILL IN HERE')
REPLACE_LINE_RE = re.compile(r'\(\*\s+REPLACE THIS LINE WITH')
ADMITTED_RE = re.compile(r'\bAdmitted\.')

# Manual grading sentinel
MANUAL_GRADE_RE = re.compile(
    r'Definition\s+manual_grade_for_(\w+)\s*:\s*option\s*\(nat\*string\)\s*:=\s*None\.'
)


def parse_exercises(filepath: Path) -> list[ParsedExercise]:
    """Parse a .v file and extract all exercises with their metadata and status."""
    text = filepath.read_text(encoding="utf-8", errors="replace")
    lines = text.split("\n")

    # Find all manual grade definitions
    manual_exercises = set()
    for m in MANUAL_GRADE_RE.finditer(text):
        manual_exercises.add(m.group(1))

    exercises = []
    i = 0
    while i < len(lines):
        line = lines[i]
        header_match = EXERCISE_HEADER_RE.search(line)
        if not header_match:
            i += 1
            continue

        stars = int(header_match.group(1))
        difficulty = header_match.group(2)
        modifier = header_match.group(3)
        name = header_match.group(4)
        line_start = i + 1  # 1-indexed

        # Find the end marker (** [] *)
        line_end = None
        end_idx = i + 1
        while end_idx < len(lines):
            if EXERCISE_END_RE.search(lines[end_idx]):
                line_end = end_idx + 1  # 1-indexed
                break
            end_idx += 1

        # Extract exercise body text
        if line_end is not None:
            body = "\n".join(lines[i:end_idx + 1])
        else:
            # No end marker found — take next 100 lines or to end
            body = "\n".join(lines[i:min(i + 100, len(lines))])

        # Determine status based on incomplete markers
        has_fill_in = bool(FILL_IN_HERE_RE.search(body))
        has_replace = bool(REPLACE_LINE_RE.search(body))
        has_admitted = bool(ADMITTED_RE.search(body))
        has_qed = bool(re.search(r'\b(Qed|Defined)\s*\.', body))
        # Check if user added substantive Coq code (definitions, inductive types, etc.)
        # Strip out the manual_grade sentinel before checking
        code_after = body.split('FILL IN HERE')[-1] if 'FILL IN HERE' in body else body
        code_after = re.sub(r'Definition\s+manual_grade_for_\w+\s*:.*?\.', '', code_after)
        has_real_code = bool(re.search(
            r'\b(Inductive|Fixpoint|Definition|Lemma|Theorem|Example|'
            r'Corollary|Fact|Remark|Proposition|Record|Class|Instance)\b',
            code_after
        ))

        is_manual = name in manual_exercises

        if has_admitted and not has_qed:
            # Admitted without Qed means incomplete
            status = "not_started"
        elif (has_fill_in or has_replace) and not has_qed and not has_real_code:
            # Placeholder still present, no completed proof, no new definitions
            status = "not_started"
        else:
            # User wrote proof (Qed) or added real definitions
            status = "completed"

        exercises.append(ParsedExercise(
            name=name,
            stars=stars,
            difficulty=difficulty,
            modifier=modifier,
            is_manual=is_manual,
            line_start=line_start,
            line_end=line_end,
            status=status,
        ))

        # Advance past the end marker
        i = end_idx + 1 if line_end else i + 1

    return exercises


@dataclass
class TestExerciseInfo:
    """Points info extracted from *Test.v files."""
    name: str
    points: float


def parse_test_file(filepath: Path) -> dict[str, float]:
    """Parse a *Test.v file to extract point values per exercise.

    Returns a dict mapping exercise_name -> total points.
    """
    text = filepath.read_text(encoding="utf-8", errors="replace")

    # Pattern: exercise group header followed by points
    # idtac "-------------------  exercise_name  --------------------".
    # ... idtac "Possible points: N".
    exercise_points: dict[str, float] = {}
    current_exercise = None

    for line in text.split("\n"):
        # Detect exercise group header
        group_match = re.search(r'idtac\s+"[-]+\s+(\S+)\s+[-]+"', line)
        if group_match:
            current_exercise = group_match.group(1)
            if current_exercise not in exercise_points:
                exercise_points[current_exercise] = 0.0

        # Accumulate points
        points_match = re.search(r'idtac\s+"Possible points:\s+([0-9.]+)"', line)
        if points_match and current_exercise:
            exercise_points[current_exercise] += float(points_match.group(1))

    return exercise_points
