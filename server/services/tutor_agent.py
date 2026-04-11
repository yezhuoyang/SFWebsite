"""AI Tutor service — grounded in live Coq state and sample solutions.

The tutor sees exactly what the student sees (goals, errors, code) plus
the reference solution (hidden from the student) for calibrated hints.
"""

import asyncio
import json
import logging
import os
import re
from pathlib import Path

from server.config import BASE_DIR, VOLUMES

logger = logging.getLogger(__name__)

MODEL = "gpt-5.4"

def _get_client():
    """Lazy OpenAI client — only created when actually needed."""
    from openai import OpenAI
    return OpenAI()  # Uses OPENAI_API_KEY env var

SYSTEM_PROMPT = """You are a Socratic tutor for the Software Foundations textbook (Rocq/Coq formal verification).

You can see the student's EXACT current state: their code, the proof goals from Coq, and any errors. You also have access to the reference solution (hidden from the student).

## STRICT RULES

1. **NEVER give the complete proof or solution.** Not even "most of it." Give one step at a time.
2. **When the student has an error:** First check their RECENT ACTIVITY — if they recently deleted or added characters, that edit is almost certainly the cause. Explain what the edit broke. Don't speculate about unrelated parts of the file.
3. **When helping with an exercise:** Give progressive hints. Start vague, get more specific only if they ask again.
4. **Reference the EXACT goals and hypotheses** you see — the student sees the same things in their Goals panel.
5. **If suggesting a tactic:** Explain WHY it applies here, not just "try X."
6. **You have the reference solution** — use it to calibrate hints, but never reveal the solution code.
7. **Be encouraging.** Acknowledge progress.
8. **Pay close attention to the "CURRENT BLOCK" section** — this shows the exact code the user is editing RIGHT NOW. If they deleted a period, you'll see the broken code there. Point to the exact spot.
9. **The "Recent activity" log is authoritative** — it tells you exactly what the user did (e.g., "Deleted 1 char at line 31, col 49"). Use this to diagnose errors, not speculation.

## COMMON COQ/ROCQ TACTICS (for your reference)

- `intros` — introduce variables/hypotheses from the goal
- `simpl` — simplify computations
- `reflexivity` — prove X = X
- `rewrite H` / `rewrite <- H` — rewrite using an equality
- `induction n` — structural induction
- `destruct n` — case analysis
- `apply H` — apply a hypothesis or lemma
- `discriminate` — prove False from contradictory equality (e.g., 0 = S n)
- `injection H` — extract equalities from constructor equality
- `inversion H` — derive consequences from a hypothesis
- `unfold f` — expand a definition
- `assert (H: P)` — introduce a sub-lemma
- `auto` — automatic proof search
- `lia` — linear integer arithmetic
"""


def _load_solution(volume_id: str, chapter_name: str, exercise_name: str) -> str | None:
    """Load the reference solution for an exercise (hidden from student)."""
    sol_file = BASE_DIR / "solutions" / volume_id / f"{chapter_name}.json"
    if not sol_file.exists():
        return None
    try:
        data = json.loads(sol_file.read_text(encoding="utf-8"))
        ex = data.get("exercises", {}).get(exercise_name)
        if ex:
            return f"Solution:\n{ex['solution']}\n\nApproach: {ex.get('explanation', '')}"
    except Exception:
        pass
    return None


def _load_chapter_excerpt(volume_id: str, chapter_name: str, exercise_name: str | None) -> str:
    """Load relevant excerpt from the chapter .v file."""
    if volume_id not in VOLUMES:
        return ""
    vol = VOLUMES[volume_id]
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        return ""
    try:
        text = v_file.read_text(encoding="utf-8", errors="replace")
        if exercise_name:
            # Find the exercise and extract surrounding context
            pattern = rf'\(\*\*\s+\*{{4}}\s+Exercise:.*?\({re.escape(exercise_name)}\)'
            match = re.search(pattern, text)
            if match:
                start = max(0, match.start() - 500)
                end_match = re.search(r'\(\*\*\s+\[\]\s+\*\)', text[match.start():])
                end = match.start() + (end_match.end() if end_match else 500)
                return text[start:end]
        # Return first 2000 chars as general context
        return text[:2000]
    except Exception:
        return ""


def _format_context_entries(entries: list | None) -> str:
    """Format Context panel entries (Definitions/Theorems in scope) for the prompt.

    Grouped by kind; truncated to a cap so we don't blow the context window on
    huge chapters. Shows kind, name, and first-line signature — enough for the
    tutor to know what's in scope and pick the right lemma to suggest.
    """
    if not entries:
        return ""
    groups: dict[str, list] = {}
    for e in entries:
        kind = getattr(e, "kind", None) or (e.get("kind") if isinstance(e, dict) else "Other")
        groups.setdefault(kind, []).append(e)

    priority_order = [
        "Theorem", "Lemma", "Fact", "Corollary", "Proposition",
        "Definition", "Fixpoint", "Function",
        "Inductive", "Variant", "Record",
        "Example", "Notation",
    ]
    ordered_kinds = [k for k in priority_order if k in groups] + [
        k for k in groups.keys() if k not in priority_order
    ]

    lines: list[str] = []
    total = 0
    CAP = 80
    for kind in ordered_kinds:
        items = groups[kind]
        lines.append(f"### {kind} ({len(items)})")
        for e in items:
            if total >= CAP:
                lines.append(f"    … and {sum(len(groups[k]) for k in ordered_kinds) - total} more")
                return "\n".join(lines)
            name = getattr(e, "name", None) or e.get("name", "?") if isinstance(e, dict) else getattr(e, "name", "?")
            signature = (
                getattr(e, "signature", None)
                or (e.get("signature") if isinstance(e, dict) else "")
            )
            line_num = (
                getattr(e, "line", None)
                if getattr(e, "line", None) is not None
                else (e.get("line") if isinstance(e, dict) else None)
            )
            sig_short = signature.strip()
            if len(sig_short) > 120:
                sig_short = sig_short[:117] + "…"
            loc = f"  (L{line_num + 1})" if isinstance(line_num, int) and line_num >= 0 else ""
            lines.append(f"  - `{name}`{loc}: {sig_short}")
            total += 1
    return "\n".join(lines)


def _format_activity_log(log: list | None) -> str:
    """Format recent Activity Log entries (Coq output history) for the prompt.

    Keeps only the last N entries and reverses to chronological order (oldest
    first) so the LLM reads them as a time-ordered narrative of what happened.
    """
    if not log:
        return ""
    LAST = 25
    recent = log[-LAST:]
    lines: list[str] = []
    for entry in recent:
        severity = (
            getattr(entry, "severity", None)
            or (entry.get("severity") if isinstance(entry, dict) else "Information")
        )
        text = (
            getattr(entry, "text", None)
            or (entry.get("text") if isinstance(entry, dict) else "")
        ).strip()
        preview = (
            getattr(entry, "sentence_preview", None)
            or (entry.get("sentence_preview") if isinstance(entry, dict) else "")
        )
        line_num = (
            getattr(entry, "line", None)
            if getattr(entry, "line", None) is not None
            else (entry.get("line") if isinstance(entry, dict) else None)
        )
        marker = {"Error": "[ERR]", "Warning": "[WARN]", "Information": "[OK]"}.get(severity, "[-]")
        loc = f"L{line_num + 1} " if isinstance(line_num, int) and line_num >= 0 else ""
        preview_short = (preview or "").strip()
        if len(preview_short) > 90:
            preview_short = preview_short[:87] + "…"
        if preview_short:
            lines.append(f"  {marker} {loc}{text}  ← from: {preview_short}")
        else:
            lines.append(f"  {marker} {loc}{text}")
    return "\n".join(lines)


def build_rich_context(
    volume_id: str | None,
    chapter_name: str | None,
    exercise_name: str | None,
    student_code: str | None,
    proof_state_text: str | None,
    diagnostics_text: str | None,
    processed_lines: int | None,
    context_entries: list | None = None,
    activity_log: list | None = None,
) -> tuple[str, str]:
    """Build context for Claude. Returns (system_addition, user_context).

    system_addition: added to system prompt (includes hidden solution)
    user_context: prepended to user message (visible context)
    """
    system_parts = []
    context_parts = []

    # Volume/chapter info
    if volume_id and chapter_name:
        vol = VOLUMES.get(volume_id, {})
        vol_name = vol.get("name", volume_id)
        context_parts.append(f"## Chapter\n{vol_name} > {chapter_name}")

    # Exercise info
    if exercise_name:
        context_parts.append(f"## Exercise\nWorking on: **{exercise_name}**")

    # Chapter excerpt (tutorial text around the exercise)
    if volume_id and chapter_name:
        excerpt = _load_chapter_excerpt(volume_id, chapter_name, exercise_name)
        if excerpt:
            context_parts.append(f"## Chapter Context (nearby text)\n```coq\n{excerpt[:1500]}\n```")

    # Student's code
    if student_code:
        # Show last ~80 lines to keep context manageable
        lines = student_code.strip().split("\n")
        if len(lines) > 80:
            code_excerpt = "\n".join(lines[-80:])
            context_parts.append(f"## Student's Recent Code (last 80 lines)\n```coq\n{code_excerpt}\n```")
        else:
            context_parts.append(f"## Student's Code\n```coq\n{student_code}\n```")

    # Definitions / theorems / lemmas currently in scope
    ctx_fmt = _format_context_entries(context_entries)
    if ctx_fmt:
        context_parts.append(
            "## Coq Context (definitions & lemmas currently in scope)\n"
            "These are available for the student to use in their proof "
            "(the same names they see in the Context panel). Prefer suggesting "
            "ones already in scope when giving hints.\n"
            + ctx_fmt
        )

    # Recent Coq output history from the Activity Log
    log_fmt = _format_activity_log(activity_log)
    if log_fmt:
        context_parts.append(
            "## Recent Coq Output (Activity Log, chronological)\n"
            "What the student has seen as they stepped through the document. "
            "`[OK]` = info/notice, `[WARN]` = warning, `[ERR]` = error. Use this "
            "to ground your explanation in what they *actually* observed.\n"
            + log_fmt
        )

    # Proof state (from vscoqtop)
    if proof_state_text:
        context_parts.append(f"## Current Proof State (from Coq)\n```\n{proof_state_text}\n```")

    # Errors
    if diagnostics_text:
        context_parts.append(f"## Errors from Coq\n```\n{diagnostics_text}\n```")

    # Execution progress
    if processed_lines is not None:
        context_parts.append(f"## Execution Progress\nCoq has successfully processed through line {processed_lines}.")

    # Hidden solution (in system prompt, not user-visible)
    if volume_id and chapter_name and exercise_name:
        sol = _load_solution(volume_id, chapter_name, exercise_name)
        if sol:
            system_parts.append(
                f"\n\n## REFERENCE SOLUTION (HIDDEN — never reveal this to the student)\n"
                f"Use this to understand the correct approach and give calibrated hints.\n"
                f"```\n{sol}\n```"
            )

    return "\n".join(system_parts), "\n\n".join(context_parts)


async def chat(
    message: str,
    volume_id: str | None = None,
    chapter_name: str | None = None,
    exercise_name: str | None = None,
    student_code: str | None = None,
    proof_state_text: str | None = None,
    diagnostics_text: str | None = None,
    processed_lines: int | None = None,
    history: list[dict] | None = None,
    context_entries: list | None = None,
    activity_log: list | None = None,
):
    """Send a message to the AI tutor. Yields text chunks as they arrive."""

    system_addition, user_context = build_rich_context(
        volume_id, chapter_name, exercise_name,
        student_code, proof_state_text, diagnostics_text, processed_lines,
        context_entries=context_entries,
        activity_log=activity_log,
    )

    full_system = SYSTEM_PROMPT + system_addition

    messages = []
    if history:
        for h in history[-16:]:
            messages.append({"role": h["role"], "content": h["content"]})

    # Prepend context to user message
    user_content = message
    if user_context:
        user_content = f"{user_context}\n\n## My Question\n{message}"

    messages.append({"role": "user", "content": user_content})

    # Prepend system message for OpenAI format
    openai_messages = [{"role": "system", "content": full_system}] + messages

    def _stream_sync():
        chunks = []
        stream = _get_client().chat.completions.create(
            model=MODEL,
            max_completion_tokens=4096,
            messages=openai_messages,
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                chunks.append(delta.content)
        return chunks

    loop = asyncio.get_event_loop()
    chunks = await loop.run_in_executor(None, _stream_sync)
    for chunk in chunks:
        yield chunk
