"""Splice user-edited Coq code blocks back into a chapter .v file.

Two paths:

  1. **Splice into upstream HTML** (preferred). Our .v.orig may be a
     different revision than the source coqdoc rendered into upstream's
     HTML — variable renames, added exercises, etc. — and any drift
     misaligns block indices and produces garbage Coq. Driving the
     reconstruction from the upstream HTML guarantees the block count
     matches the iframe's CodeMirror instances exactly (one
     `<div class="code">` per CodeMirror, in document order). We
     rebuild the .v as alternating prose comments (from `<div class="doc">`
     extracted text) and user code (from each CodeMirror's value).
     This is what the same-origin grade flow uses.

  2. **Splice into a local .v.orig** (legacy). For chapters where we
     don't have upstream HTML available, fall back to splitting our
     local .v.orig into `(** ... *)` doc comments vs code segments
     and replacing the code segments. Brittle when revisions drift,
     but kept around for environments without upstream access.

Coqdoc treats *only* `(** ... *)` (double-star) as a doc comment;
regular `(* ... *)` comments stay inside code segments. Both can be
nested.
"""

from __future__ import annotations

import html as html_module
import re
from dataclasses import dataclass
from html.parser import HTMLParser


@dataclass
class Segment:
    kind: str  # 'code' or 'doc'
    text: str


def split_segments(text: str) -> list[Segment]:
    """Split a Coq source string into alternating code / doc-comment
    segments. Returns segments in source order; empty code segments are
    preserved so we can reassemble the file exactly."""
    segments: list[Segment] = []
    cur_start = 0
    i = 0
    n = len(text)
    while i < n:
        # Doc comment: `(**` followed by something other than another `*`
        # (so `(***` and friends are *not* treated as doc comments —
        # those don't appear in SF anyway).
        if text[i:i+3] == '(**' and (i + 3 >= n or text[i+3] != '*'):
            if i > cur_start:
                segments.append(Segment('code', text[cur_start:i]))
            # Walk past the doc comment, tracking nesting (Coq comments
            # can nest).
            depth = 1
            j = i + 3
            while j < n and depth > 0:
                if text[j:j+2] == '(*':
                    depth += 1
                    j += 2
                elif text[j:j+2] == '*)':
                    depth -= 1
                    j += 2
                else:
                    j += 1
            segments.append(Segment('doc', text[i:j]))
            cur_start = j
            i = j
        elif text[i:i+2] == '(*':
            # Regular comment: stays inside the current code segment.
            # Skip to its end so we don't accidentally see `(**` inside.
            depth = 1
            j = i + 2
            while j < n and depth > 0:
                if text[j:j+2] == '(*':
                    depth += 1
                    j += 2
                elif text[j:j+2] == '*)':
                    depth -= 1
                    j += 2
                else:
                    j += 1
            i = j
        else:
            i += 1
    if cur_start < n:
        segments.append(Segment('code', text[cur_start:]))
    return segments


_REGULAR_COMMENT = __import__('re').compile(r'\(\*(?:[^*(]|\*(?!\))|\((?!\*))*\*\)', __import__('re').DOTALL)


def is_substantive_code(text: str) -> bool:
    """Coqdoc emits a `<div class="code">` only for code regions that
    contain *something other than* whitespace and regular `(* ... *)`
    comments. Whitespace-only or comment-only regions get collapsed
    into the surrounding doc structure. We mirror that here so our
    splice matches coqdoc's segmentation 1:1 (which is what wacoq
    drives its CodeMirror instances from).

    Strip out regular comments first, then check if there's any
    non-whitespace residue."""
    stripped = _REGULAR_COMMENT.sub('', text).strip()
    return bool(stripped)


class SpliceError(ValueError):
    """Raised when the number of user-supplied blocks doesn't match the
    number of substantive code segments in the chapter source."""


class _ChapterHTMLParser(HTMLParser):
    """Walk a coqdoc-rendered chapter HTML and emit (kind, text)
    tuples in document order, where kind is 'doc' or 'code'.

    coqdoc HTML structure:
      <div id="main">
        <div class="doc"> ... prose, may contain nested divs ... </div>
        <div class="code"> ... Coq source, with <span> + <br/> ... </div>
        ...
      </div>

    We track div depth so nested `<div class="paragraph">` inside a doc
    block doesn't terminate the doc block early."""

    def __init__(self) -> None:
        super().__init__()
        self.segments: list[tuple[str, str]] = []
        self._kind: str | None = None       # 'doc' / 'code' / None
        self._open_depth: int = 0
        self._depth: int = 0
        self._buf: list[str] = []
        self._skip_until_depth: int | None = None  # for nested unwanted blocks

    def handle_starttag(self, tag: str, attrs):  # type: ignore[override]
        if tag == 'br':
            if self._kind is not None:
                self._buf.append('\n')
            return
        if tag == 'div':
            self._depth += 1
            cls = dict(attrs).get('class', '')
            classes = cls.split()
            if self._kind is None:
                if 'doc' in classes:
                    self._kind = 'doc'
                    self._open_depth = self._depth
                    self._buf = []
                elif 'code' in classes:
                    self._kind = 'code'
                    self._open_depth = self._depth
                    self._buf = []

    def handle_endtag(self, tag: str):  # type: ignore[override]
        if tag != 'div':
            return
        if self._kind is not None and self._depth == self._open_depth:
            self.segments.append((self._kind, ''.join(self._buf)))
            self._kind = None
            self._buf = []
        self._depth -= 1

    def handle_data(self, data: str):  # type: ignore[override]
        if self._kind is not None:
            self._buf.append(data)

    def handle_entityref(self, name: str):  # type: ignore[override]
        if self._kind is not None:
            self._buf.append(html_module.unescape(f'&{name};'))

    def handle_charref(self, name: str):  # type: ignore[override]
        if self._kind is not None:
            self._buf.append(html_module.unescape(f'&#{name};'))


def extract_chapter_segments(html_text: str) -> list[tuple[str, str]]:
    """Parse the upstream chapter HTML into ('doc', text) / ('code', text)
    segments in document order. Only segments inside the page's main
    section are kept."""
    # Limit parsing to <div id="main"> if present (skips header/menu).
    main_match = re.search(
        r'<div id="main"[^>]*>(.*)<!--\s*/main\s*-->|<div id="main"[^>]*>(.*?)</div>\s*<div id="footer"',
        html_text,
        re.DOTALL,
    )
    if main_match:
        body = main_match.group(1) or main_match.group(2) or html_text
    else:
        # Fallback: parse the entire body.
        body = html_text
    parser = _ChapterHTMLParser()
    parser.feed(body)
    parser.close()
    return parser.segments


# Exercise heading as it appears in the HTML's extracted text:
#   "Exercise: 1 star, standard (foo)"
#   "Exercise: 2 stars, advanced, optional (bar)"
# The full line plus everything until the line break (so we capture
# the exercise name in parens). parse_exercises in
# server/services/parser.py requires `(** **** Exercise: ...` ALL on
# one line, so we lift each match into its own dedicated comment.
_EXERCISE_LINE_RE = re.compile(
    r'^\s*(Exercise:\s+\d+\s+stars?[^\n]*?\([A-Za-z_][A-Za-z_0-9]*\))',
    re.MULTILINE,
)


def _wrap_as_doc_comment(prose: str) -> str:
    """Turn extracted prose text into Coq doc comments.

    coqdoc merges adjacent source `(** ... *)` blocks into a single
    `<div class="doc">`, so one prose segment can contain *multiple*
    Exercise headings AND end markers. We:
      * Escape any `*)` inside the prose (would close the comment
        prematurely).
      * Split each `Exercise: N stars... (name)` line out into its
        own dedicated `(** **** Exercise: ... (name) *)` comment.
      * Detect bare `[]` end markers and emit them as single-line
        `(** [] *)` so parse_exercises's line-based EXERCISE_END_RE
        matches.

    Both regexes in parse_exercises require the relevant marker to be
    on a single line, so a multi-line wrapped comment fails them.
    """
    # If the entire segment is just an end marker, emit it inline.
    if prose.strip() == '[]':
        return '(** [] *)'

    safe = prose.replace('*)', '* )')

    chunks: list[str] = []
    last = 0
    for m in _EXERCISE_LINE_RE.finditer(safe):
        before = safe[last:m.start()].strip()
        if before:
            chunks.append(_wrap_prose_chunk(before))
        # One-line exercise comment so parse_exercises matches.
        chunks.append(f'(** **** {m.group(1)} *)')
        last = m.end()
    tail = safe[last:].strip()
    if tail:
        chunks.append(_wrap_prose_chunk(tail))
    if not chunks:
        return f'(**\n{safe}\n*)'
    return '\n\n'.join(chunks)


def _wrap_prose_chunk(text: str) -> str:
    """Wrap a piece of prose as a Coq doc comment, special-casing the
    bare end marker `[]` which must stay on one line for the grader's
    EXERCISE_END_RE."""
    if text.strip() == '[]':
        return '(** [] *)'
    # If the trimmed text *ends* with a `[]` line on its own, peel it
    # into its own one-line comment so the line-based regex matches.
    lines = text.splitlines()
    if lines and lines[-1].strip() == '[]':
        head = '\n'.join(lines[:-1]).rstrip()
        if head:
            return f'(**\n{head}\n*)\n\n(** [] *)'
        return '(** [] *)'
    return f'(**\n{text}\n*)'


# Coqdoc with `--utf8` (which is what coq.vercel.app's HTML uses)
# replaces ASCII tokens with Unicode glyphs for prettier rendering.
# wacoq imports a `utf8` package so its Coq accepts these tokens;
# standalone coqc doesn't, and Coq's stdlib `Utf8` only covers a few
# (→ ∀ ∃ ↔ ¬ ∧ ∨ — *not* ⇒ ≤ ≥ ≠ ×). Easiest reliable answer:
# translate every glyph back to its ASCII source before grading.
# Risk: would break a Notation definition that uses these glyphs as
# literals — SF chapters don't define such notations in editable
# code (they live in imported support modules), so this is safe here.
_UTF8_TO_ASCII = {
    '→': '->',
    '⇒': '=>',
    '↔': '<->',
    '⇔': '<->',
    '∀': 'forall',
    '∃': 'exists',
    '≤': '<=',
    '≥': '>=',
    '≠': '<>',
    '¬': '~',
    '∧': '/\\',
    '∨': '\\/',
    '×': '*',
    '·': '.',
    '∈': 'In',
    '∅': 'empty',
    '☐': '',      # coqdoc trailing ballot-box marker (&#9744;) emitted
                       # at end of some code blocks; visible in the iframe
                       # but not Coq source.
    '☑': '',
    ' ': ' ',     # NBSP — coqdoc uses these for indentation; coqc's
                       # lexer doesn't accept them as whitespace.
    '​': '',      # zero-width space (just in case)
    ' ': ' ',     # em space
}


def _utf8_to_ascii(text: str) -> str:
    for u, a in _UTF8_TO_ASCII.items():
        text = text.replace(u, a)
    return text


def reassemble_v_from_html(html_text: str, user_blocks: list[str]) -> str:
    """Build a Coq .v source by walking the upstream chapter HTML and
    substituting each `<div class="code">` with the corresponding
    entry from `user_blocks` (in document order). `<div class="doc">`
    contents are wrapped as `(** ... *)` so the grader still sees the
    Exercise: headers it needs.

    Prepends `From Coq Require Import Utf8.` so coqc accepts the
    Unicode glyphs (→ ∀ ∃ ⇒ ≤ ⇔ ¬ ∧ ∨) coqdoc emits in place of
    `-> forall exists => <= <-> ~ /\ \/`.

    Tolerant of count mismatch:
      * If client sent fewer blocks than the HTML has (e.g. wacoq
        was still creating CodeMirrors when the user clicked Submit),
        the missing tail uses the HTML's own extracted code text — the
        user just hasn't edited those blocks. The file still compiles.
      * If client sent more blocks than the HTML has, the extras are
        dropped (mirror situation, less common).
    """
    segments = extract_chapter_segments(html_text)
    out: list[str] = []
    bi = 0
    n_blocks = len(user_blocks)
    for kind, text in segments:
        if kind == 'doc':
            out.append(_wrap_as_doc_comment(text))
        else:
            # Coqdoc replaces the source's `(** [] *)` exercise-end
            # markers with a `☐` (U+2610) glyph at the end of the code
            # block. We check the *original* (pre-translation) code
            # text for this glyph and inject the end marker so
            # parse_exercises can find each exercise's bounds.
            ends_exercise = '☐' in text or '☑' in text
            block_text = user_blocks[bi] if bi < n_blocks else text
            out.append('\n')
            out.append(_utf8_to_ascii(block_text))
            out.append('\n')
            if ends_exercise:
                out.append('(** [] *)')
            bi += 1
    return '\n'.join(out)


def splice_blocks(orig: str, blocks: list[str]) -> str:
    """Replace each substantive code segment in `orig` with the
    corresponding entry from `blocks`. Whitespace-only and
    comment-only code segments (which coqdoc collapses into the
    surrounding doc structure) are preserved as-is.

    Coqdoc's segmentation rules don't *exactly* match our `(** ... *)`
    splitter — there are corner cases (HIDEFROMHTML wrappers, `*)`
    inside string literals, etc.) where the two diverge by 1–2
    segments. Rather than 422-ing the request, we align block-by-block
    from the start and warn-via-log if the counts mismatch by more than
    a small margin. Excess blocks are dropped; missing blocks leave the
    original code in place. For users who only edit a few specific
    proofs (the common case) this stays correct: their edits land in
    the right segments, and the rest of the file is byte-identical to
    `.v.orig`."""
    segments = split_segments(orig)
    fillable_indices = [
        i for i, s in enumerate(segments)
        if s.kind == 'code' and is_substantive_code(s.text)
    ]
    drift = abs(len(fillable_indices) - len(blocks))
    if drift > 5:
        # Off by more than 5 — splitter is genuinely out of sync with
        # coqdoc, not just a corner case. Fail loudly so the user can
        # fall back to the paste modal.
        raise SpliceError(
            f"Block count mismatch: client sent {len(blocks)} edited block(s), "
            f"but the chapter source has {len(fillable_indices)} substantive code "
            f"region(s). The iframe may not have finished loading — reload the "
            f"chapter and try again, or use the paste modal."
        )
    n = min(len(fillable_indices), len(blocks))
    bi_index = {idx: bi for bi, idx in enumerate(fillable_indices[:n])}
    out: list[str] = []
    for idx, seg in enumerate(segments):
        if idx in bi_index:
            out.append(blocks[bi_index[idx]])
        else:
            out.append(seg.text)
    return ''.join(out)
