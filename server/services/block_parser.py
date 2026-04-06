"""Parse .v files into structured blocks for Jupyter-style display.

Block types:
  - section_header: (** * Title *)       — major section (h1)
  - subsection_header: (** ** Title *)   — subsection (h2)
  - subsubsection_header: (** *** Title *) — subsubsection (h3)
  - comment: (** ... *) documentation blocks
  - code: Definitions, examples, notations, etc.
  - exercise: Exercise block from header to (** [] *)
"""

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Block:
    id: int
    kind: str
    content: str
    line_start: int  # 1-indexed
    line_end: int    # 1-indexed
    title: str | None = None
    exercise_name: str | None = None
    exercise_stars: int | None = None
    exercise_difficulty: str | None = None
    exercise_modifier: str | None = None
    editable: bool = True


@dataclass
class TocEntry:
    block_id: int
    level: int  # 1 = section, 2 = subsection, 3 = exercise/subsubsection
    title: str


@dataclass
class ChapterBlocks:
    filename: str
    blocks: list[Block]
    toc: list[TocEntry]


# Patterns — divider lines that appear BEFORE section/subsection titles
# Both (* ###...### *) and (* ===...=== *) and (* ---...--- *)
MAJOR_DIVIDER = re.compile(r'^\(\*\s*[#]{4,}\s*\*\)$')
MINOR_DIVIDER = re.compile(r'^\(\*\s*[=]{4,}\s*\*\)$')
SUB_DIVIDER = re.compile(r'^\(\*\s*[-]{4,}\s*\*\)$')

# Title patterns — detect star count for heading level
# (** * Title *)         → section (h1)
# (** ** Title *)        → subsection (h2)
# (** *** Title *)       → subsubsection (h3)
# Note: titles may contain [brackets], so use greedy match
HEADING_RE = re.compile(r'^\(\*\*\s+(\*{1,4})\s+(.+?)\s*\*\)$')

EXERCISE_HEADER = re.compile(
    r'\(\*\*\s+\*{4}\s+Exercise:\s+'
    r'(\d+)\s+stars?,\s+'
    r'(standard|advanced)'
    r'(?:,\s+(optional|especially useful))?'
    r'\s+\(([^)]+)\)',
    re.IGNORECASE
)
# Exercise end marker: (** [] *) or (* ... [] *) — both single and double star
EXERCISE_END = re.compile(r'\(\*\*?\s+\[\]\s*\*\)|\[\]\s*\*\)')
DOC_COMMENT_START = re.compile(r'^\(\*\*\s')
COMMENT_END = re.compile(r'\*\)\s*$')


def _is_divider(line: str) -> bool:
    """Check if a line is any kind of Coq comment divider."""
    return bool(MAJOR_DIVIDER.match(line) or MINOR_DIVIDER.match(line) or SUB_DIVIDER.match(line))


def _clean_title(title: str) -> str:
    """Clean Coq doc markup from titles: [foo] → foo."""
    return re.sub(r'\[([^\]]*)\]', r'\1', title).strip()


def parse_blocks(filepath: Path) -> ChapterBlocks:
    """Parse a .v file into structured blocks."""
    text = filepath.read_text(encoding="utf-8", errors="replace")
    lines = text.split("\n")
    blocks: list[Block] = []
    toc: list[TocEntry] = []
    block_id = 0

    i = 0
    while i < len(lines):
        line = lines[i].rstrip()

        # --- Divider lines (###, ===, ---) followed by a heading ---
        if _is_divider(line):
            # Look for a heading on the next non-empty line
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1

            if j < len(lines):
                heading_match = HEADING_RE.match(lines[j].strip())
                if heading_match:
                    stars = len(heading_match.group(1))
                    title = _clean_title(heading_match.group(2))

                    if stars == 1:
                        kind = "section_header"
                        toc_level = 1
                    elif stars == 2:
                        kind = "subsection_header"
                        toc_level = 2
                    else:
                        kind = "subsection_header"  # h3+ treated same as h2
                        toc_level = 2

                    # Merge divider + title into one block (don't show divider separately)
                    blocks.append(Block(
                        id=block_id, kind=kind,
                        content=lines[j].strip(),  # just the title, not the divider
                        line_start=i + 1, line_end=j + 1,
                        title=title, editable=False,
                    ))
                    toc.append(TocEntry(block_id=block_id, level=toc_level, title=title))
                    block_id += 1
                    i = j + 1
                    continue
            # Divider with no heading after it — skip it silently
            i += 1
            continue

        # --- Standalone heading (no divider before it) ---
        heading_match = HEADING_RE.match(line.strip())
        if heading_match and not EXERCISE_HEADER.search(line):
            stars = len(heading_match.group(1))
            title = _clean_title(heading_match.group(2))

            if stars == 1:
                kind = "section_header"
                toc_level = 1
            elif stars == 2:
                kind = "subsection_header"
                toc_level = 2
            else:
                kind = "subsection_header"
                toc_level = 2

            blocks.append(Block(
                id=block_id, kind=kind,
                content=line, line_start=i + 1, line_end=i + 1,
                title=title, editable=False,
            ))
            toc.append(TocEntry(block_id=block_id, level=toc_level, title=title))
            block_id += 1
            i += 1
            continue

        # --- Exercise block ---
        ex_match = EXERCISE_HEADER.search(line)
        if ex_match:
            stars = int(ex_match.group(1))
            difficulty = ex_match.group(2)
            modifier = ex_match.group(3)
            name = ex_match.group(4)

            # Collect everything until (** [] *)
            start = i
            j = i + 1
            while j < len(lines):
                if EXERCISE_END.search(lines[j]):
                    j += 1  # include the end marker
                    break
                j += 1

            blocks.append(Block(
                id=block_id, kind="exercise",
                content="\n".join(lines[start:j]),
                line_start=start + 1, line_end=j,
                title=f"{name} ({stars}{'*' * stars}, {difficulty}{', ' + modifier if modifier else ''})",
                exercise_name=name,
                exercise_stars=stars,
                exercise_difficulty=difficulty,
                exercise_modifier=modifier,
                editable=True,
            ))
            toc.append(TocEntry(block_id=block_id, level=3, title=f"{name} ({stars}\u2605)"))
            block_id += 1
            i = j
            continue

        # --- Documentation comment block ---
        if DOC_COMMENT_START.match(line) and not EXERCISE_HEADER.search(line):
            start = i
            # Single-line doc comment
            if COMMENT_END.search(line):
                blocks.append(Block(
                    id=block_id, kind="comment",
                    content=line, line_start=start + 1, line_end=start + 1,
                    editable=False,
                ))
                block_id += 1
                i += 1
                continue
            else:
                # Multi-line doc comment — find closing *)
                j = i + 1
                while j < len(lines):
                    if COMMENT_END.search(lines[j]):
                        j += 1
                        break
                    j += 1
                blocks.append(Block(
                    id=block_id, kind="comment",
                    content="\n".join(lines[start:j]),
                    line_start=start + 1, line_end=j,
                    editable=False,
                ))
                block_id += 1
                i = j
                continue

        # --- Code block ---
        if line.strip():
            start = i
            j = i + 1
            while j < len(lines):
                next_line = lines[j].rstrip()
                # Stop at structural markers
                if (_is_divider(next_line) or
                    EXERCISE_HEADER.search(next_line) or
                    HEADING_RE.match(next_line.strip()) or
                    (DOC_COMMENT_START.match(next_line) and not next_line.strip().startswith('(**)'))):
                    break
                j += 1

            # Trim trailing empty lines
            while j > start and not lines[j - 1].strip():
                j -= 1

            if j > start:
                code_content = "\n".join(lines[start:j])
                blocks.append(Block(
                    id=block_id, kind="code",
                    content=code_content,
                    line_start=start + 1, line_end=j,
                    editable=True,
                ))
                block_id += 1
                i = j
                continue

        # Skip empty lines
        i += 1

    return ChapterBlocks(
        filename=filepath.name,
        blocks=blocks,
        toc=toc,
    )
