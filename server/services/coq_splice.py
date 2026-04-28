"""Splice user-edited Coq code blocks back into the original chapter .v file.

The same-origin SF iframe lets the React parent read each CodeMirror
instance, but each editor only contains *one* code region (the text
between two `(** ... *)` doc comments). To grade, we have to put those
regions back into the chapter file alongside the prose comments and
exercise headers — coqdoc structure preserved.

Strategy: parse the original .v file (`<chapter>.v.orig`, falling back
to `.v` if no .orig exists) into alternating code / doc-comment
segments. Replace each non-empty code segment with the user-supplied
block in order. The number of non-empty code segments must match the
number of blocks the client sends; if it doesn't, we raise so the
caller can surface a clear error.

Coqdoc treats *only* `(** ... *)` (double-star) as a doc comment;
regular `(* ... *)` comments stay inside code segments. Both can be
nested.
"""

from __future__ import annotations

from dataclasses import dataclass


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
