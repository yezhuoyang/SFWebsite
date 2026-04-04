"""AI Tutor service using Claude API, grounded in real Coq proof state.

The tutor receives the ACTUAL goals/hypotheses/errors from SerAPI,
so it can give accurate hints without hallucinating about proof state.
"""

import asyncio
import json
import logging
from pathlib import Path

from anthropic import Anthropic

from server.config import VOLUMES

logger = logging.getLogger(__name__)

client = Anthropic()  # Uses ANTHROPIC_API_KEY env var

SYSTEM_PROMPT = """You are a Socratic tutor for the Software Foundations textbook series (Rocq/Coq).
Your role is to help students learn formal verification by guiding them through exercises.

STRICT RULES:
1. NEVER give the complete proof or solution.
2. Give hints that guide the student toward discovering the answer themselves.
3. When suggesting tactics, explain WHY that tactic would be useful here, not just "try X".
4. Reference specific hypotheses and goals from the CURRENT PROOF STATE shown below.
5. If the student has an error, explain what the error means and suggest how to fix it.
6. You may explain Coq/Rocq concepts, tactics, and notation in general terms.
7. Encourage the student when they make progress.

COMMON TACTICS YOU CAN SUGGEST (with explanations):
- intros: introduce variables and hypotheses from the goal
- simpl: simplify computations
- reflexivity: prove goals of the form X = X
- rewrite: use an equality hypothesis to rewrite the goal
- induction: perform structural induction on a variable
- destruct: case analysis on a term
- apply: apply a hypothesis or lemma to the goal
- unfold: expand a definition
- assert: introduce a helper lemma mid-proof
- omega/lia: solve linear arithmetic goals

When the student provides their current proof state, USE IT to give specific, targeted hints.
For example, if the goal is "S n + 0 = S n" and there's a hypothesis "IHn : n + 0 = n",
you might say: "Look at your induction hypothesis IHn. Can you use `rewrite` to transform the goal?"
"""


def build_context(
    volume_id: str | None,
    chapter_name: str | None,
    exercise_name: str | None,
    current_goals: str | None,
    current_error: str | None,
    current_code: str | None,
) -> str:
    """Build context string from real Coq state."""
    parts = []

    if volume_id and chapter_name:
        vol = VOLUMES.get(volume_id, {})
        vol_name = vol.get("name", volume_id)
        parts.append(f"## Context\nVolume: {vol_name}\nChapter: {chapter_name}")
        if exercise_name:
            parts.append(f"Exercise: {exercise_name}")

        # Try to read exercise text from the .v file
        if vol.get("path"):
            v_file = Path(vol["path"]) / f"{chapter_name}.v"
            if v_file.exists():
                try:
                    text = v_file.read_text(encoding="utf-8", errors="replace")
                    # Find the exercise text
                    if exercise_name:
                        import re
                        pattern = rf'\(\*\*\s+\*{{4}}\s+Exercise:.*?\({re.escape(exercise_name)}\)'
                        match = re.search(pattern, text)
                        if match:
                            start = match.start()
                            end_match = re.search(r'\(\*\*\s+\[\]\s+\*\)', text[start:])
                            if end_match:
                                exercise_text = text[start:start + end_match.end()]
                                parts.append(f"\n## Exercise Text\n```coq\n{exercise_text}\n```")
                except Exception:
                    pass

    if current_goals:
        parts.append(f"\n## Current Proof State (from Coq)\n```\n{current_goals}\n```")

    if current_error:
        parts.append(f"\n## Error Message (from Coq)\n```\n{current_error}\n```")

    if current_code:
        # Only include the last ~50 lines of code for context
        lines = current_code.strip().split("\n")
        if len(lines) > 50:
            lines = lines[-50:]
        parts.append(f"\n## Student's Recent Code\n```coq\n{'chr(10)'.join(lines)}\n```")

    return "\n".join(parts)


async def chat(
    message: str,
    volume_id: str | None = None,
    chapter_name: str | None = None,
    exercise_name: str | None = None,
    current_goals: str | None = None,
    current_error: str | None = None,
    current_code: str | None = None,
    history: list[dict] | None = None,
):
    """Send a message to the AI tutor and get a streaming response.

    Yields text chunks as they arrive from the Claude API.
    """
    context = build_context(
        volume_id, chapter_name, exercise_name,
        current_goals, current_error, current_code,
    )

    messages = []
    if history:
        for h in history[-20:]:  # Keep last 20 messages for context
            messages.append({"role": h["role"], "content": h["content"]})

    # Add context + user message
    user_content = message
    if context:
        user_content = f"{context}\n\n## My Question\n{message}"

    messages.append({"role": "user", "content": user_content})

    # Run synchronous streaming in a thread to make it async-compatible
    def _stream_sync():
        chunks = []
        with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                chunks.append(text)
        return chunks

    loop = asyncio.get_event_loop()
    chunks = await loop.run_in_executor(None, _stream_sync)
    for chunk in chunks:
        yield chunk
