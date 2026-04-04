"""Parse .v files into structured blocks for Jupyter-style display.

Block types:
  - section_header: (** * Title *)
  - subsection_header: (** ** Title *)
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
    kind: str  # "section_header", "subsection_header", "comment", "code", "exercise"
    content: str
    line_start: int  # 1-indexed
    line_end: int    # 1-indexed
    title: str | None = None  # For headers and exercises
    exercise_name: str | None = None
    exercise_stars: int | None = None
    exercise_difficulty: str | None = None
    exercise_modifier: str | None = None
    editable: bool = True  # Whether the user can edit this block


@dataclass
class TocEntry:
    block_id: int
    level: int  # 1 = section, 2 = subsection, 3 = exercise
    title: str


@dataclass
class ChapterBlocks:
    filename: str
    blocks: list[Block]
    toc: list[TocEntry]


# Patterns
SECTION_DIVIDER = re.compile(r'^\(\*\s*[#]{4,}\s*\*\)$')
SUBSECTION_DIVIDER = re.compile(r'^\(\*\s*[=]{4,}\s*\*\)$')
SECTION_TITLE = re.compile(r'^\(\*\*\s+\*\s+(.+?)\s*\*\)$')
SUBSECTION_TITLE = re.compile(r'^\(\*\*\s+\*\*\s+(.+?)\s*\*\)$')
EXERCISE_HEADER = re.compile(
    r'\(\*\*\s+\*{4}\s+Exercise:\s+'
    r'(\d+)\s+stars?,\s+'
    r'(standard|advanced)'
    r'(?:,\s+(optional|especially useful))?'
    r'\s+\(([^)]+)\)',
    re.IGNORECASE
)
EXERCISE_END = re.compile(r'\(\*\*\s+\[\]\s+\*\)')
DOC_COMMENT_START = re.compile(r'^\(\*\*\s')
DOC_COMMENT_SINGLE = re.compile(r'^\(\*\*\s.*\*\)\s*$')
COMMENT_END = re.compile(r'\*\)\s*$')


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

        # --- Section divider + title ---
        if SECTION_DIVIDER.match(line):
            # Look for title on next non-empty line
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                title_match = SECTION_TITLE.match(lines[j].strip())
                if title_match:
                    title = title_match.group(1).rstrip()
                    blocks.append(Block(
                        id=block_id, kind="section_header",
                        content="\n".join(lines[i:j+1]),
                        line_start=i+1, line_end=j+1,
                        title=title, editable=False,
                    ))
                    toc.append(TocEntry(block_id=block_id, level=1, title=title))
                    block_id += 1
                    i = j + 1
                    continue

        # --- Subsection divider + title ---
        if SUBSECTION_DIVIDER.match(line):
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                title_match = SUBSECTION_TITLE.match(lines[j].strip())
                if title_match:
                    title = title_match.group(1).rstrip()
                    blocks.append(Block(
                        id=block_id, kind="subsection_header",
                        content="\n".join(lines[i:j+1]),
                        line_start=i+1, line_end=j+1,
                        title=title, editable=False,
                    ))
                    toc.append(TocEntry(block_id=block_id, level=2, title=title))
                    block_id += 1
                    i = j + 1
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
                line_start=start+1, line_end=j,
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
            if DOC_COMMENT_SINGLE.match(line):
                # Single-line doc comment
                # Check if it's a section/subsection title without divider
                st = SECTION_TITLE.match(line.strip())
                sst = SUBSECTION_TITLE.match(line.strip())
                if st:
                    title = st.group(1).rstrip()
                    blocks.append(Block(
                        id=block_id, kind="section_header",
                        content=line, line_start=start+1, line_end=start+1,
                        title=title, editable=False,
                    ))
                    toc.append(TocEntry(block_id=block_id, level=1, title=title))
                    block_id += 1
                    i += 1
                    continue
                elif sst:
                    title = sst.group(1).rstrip()
                    blocks.append(Block(
                        id=block_id, kind="subsection_header",
                        content=line, line_start=start+1, line_end=start+1,
                        title=title, editable=False,
                    ))
                    toc.append(TocEntry(block_id=block_id, level=2, title=title))
                    block_id += 1
                    i += 1
                    continue
                else:
                    blocks.append(Block(
                        id=block_id, kind="comment",
                        content=line, line_start=start+1, line_end=start+1,
                        editable=False,
                    ))
                    block_id += 1
                    i += 1
                    continue
            else:
                # Multi-line doc comment — find closing *)
                j = i
                while j < len(lines):
                    if COMMENT_END.search(lines[j]) and j > i:
                        j += 1
                        break
                    if j > i and COMMENT_END.search(lines[j]):
                        j += 1
                        break
                    j += 1
                # Check first line for title
                st = SECTION_TITLE.match(line.strip())
                sst = SUBSECTION_TITLE.match(line.strip())
                blocks.append(Block(
                    id=block_id, kind="comment",
                    content="\n".join(lines[start:j]),
                    line_start=start+1, line_end=j,
                    editable=False,
                ))
                block_id += 1
                i = j
                continue

        # --- Code block ---
        # Accumulate code lines until we hit a doc comment, section divider, or exercise
        if line.strip():
            start = i
            j = i + 1
            while j < len(lines):
                next_line = lines[j].rstrip()
                # Stop at structural markers
                if (SECTION_DIVIDER.match(next_line) or
                    SUBSECTION_DIVIDER.match(next_line) or
                    EXERCISE_HEADER.search(next_line) or
                    (DOC_COMMENT_START.match(next_line) and not next_line.strip().startswith('(**)'))
                ):
                    break
                # Also stop at standalone section/subsection titles
                if SECTION_TITLE.match(next_line.strip()) or SUBSECTION_TITLE.match(next_line.strip()):
                    break
                j += 1

            # Trim trailing empty lines
            while j > start and not lines[j-1].strip():
                j -= 1

            if j > start:
                code_content = "\n".join(lines[start:j])
                blocks.append(Block(
                    id=block_id, kind="code",
                    content=code_content,
                    line_start=start+1, line_end=j,
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
