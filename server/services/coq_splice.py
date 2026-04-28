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


class SpliceError(ValueError):
    """Raised when the number of user-supplied blocks doesn't match the
    number of non-empty code segments in the chapter source."""


def splice_blocks(orig: str, blocks: list[str]) -> str:
    """Replace each non-empty code segment in `orig` with the
    corresponding entry from `blocks`. Empty/whitespace-only code
    segments (which coqdoc usually doesn't render as `<div class=code>`,
    and which therefore don't have a CodeMirror instance) are preserved
    as-is."""
    segments = split_segments(orig)
    fillable_indices = [
        i for i, s in enumerate(segments)
        if s.kind == 'code' and s.text.strip()
    ]
    if len(fillable_indices) != len(blocks):
        raise SpliceError(
            f"Block count mismatch: client sent {len(blocks)} edited block(s), "
            f"but the chapter has {len(fillable_indices)} editable code region(s). "
            f"This usually means the iframe finished loading after the click — "
            f"reload the chapter and try again, or use the paste modal."
        )
    out: list[str] = []
    for idx, seg in enumerate(segments):
        if idx in fillable_indices:
            block_idx = fillable_indices.index(idx)
            out.append(blocks[block_idx])
        else:
            out.append(seg.text)
    return ''.join(out)
