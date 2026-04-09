/**
 * Splits a Coq document into sentences.
 *
 * A sentence ends at '.' followed by whitespace or EOF.
 * Must handle: nested comments (* ... *), strings "...", and
 * avoid splitting inside these.
 */

export interface CoqSentence {
  text: string;
  startOffset: number;  // byte offset in the full document
  endOffset: number;    // byte offset (exclusive) — points past the '.'
}

export interface LineCharPosition {
  line: number;       // 0-indexed
  character: number;  // 0-indexed
}

/**
 * Convert a byte offset in `text` to a 0-indexed {line, character} position.
 */
export function offsetToLineChar(text: string, offset: number): LineCharPosition {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  return { line, character: offset - lastNewline - 1 };
}

/**
 * Parse a Coq document into sentences.
 *
 * Rules:
 * - A sentence ends at '.' followed by whitespace, EOF, or ')'
 *   (the ')' case handles things like "... ." at end of comments, but
 *    we skip content inside comments so this mainly catches edge cases)
 * - Inside comments (* ... *): skip entirely (nested)
 * - Inside strings "...": skip entirely
 * - Sentences include the terminating '.'
 * - Leading/trailing whitespace between sentences is trimmed from the sentence text
 *   but the offsets reflect the actual positions in the document
 */
export function parseSentences(text: string): CoqSentence[] {
  const sentences: CoqSentence[] = [];
  const len = text.length;
  let i = 0;
  let sentenceStart = 0;

  // Skip leading whitespace for the first sentence
  while (i < len && isWhitespace(text[i])) i++;
  sentenceStart = i;

  while (i < len) {
    const ch = text[i];

    // Start of comment: (* ... *)
    if (ch === '(' && i + 1 < len && text[i + 1] === '*') {
      i = skipComment(text, i);
      continue;
    }

    // Start of string: "..."
    if (ch === '"') {
      i = skipString(text, i);
      continue;
    }

    // Potential sentence terminator: '.' followed by whitespace/EOF/closing-paren
    if (ch === '.') {
      const next = i + 1 < len ? text[i + 1] : '\0';
      // '.' is a sentence terminator if followed by whitespace, EOF, or ')'
      // But NOT if followed by another identifier char (e.g., "Coq.Init.Logic")
      if (i + 1 >= len || isWhitespace(next) || next === ')') {
        // Also check it's not part of "..." (number like 0.5 - but Coq doesn't have float literals in SF)
        // And not part of a qualified name like "Nat.add" — check char before '.'
        // Actually, qualified names like `Nat.add` have identifier chars on BOTH sides of '.'
        // A sentence-ending '.' has non-identifier char after it (whitespace/EOF)
        // So the check above (whitespace/EOF after '.') is sufficient.

        const endOffset = i + 1; // past the '.'
        const sentenceText = text.slice(sentenceStart, endOffset);

        // Only add non-empty sentences (skip pure whitespace)
        if (sentenceText.trim().length > 0) {
          sentences.push({
            text: sentenceText.trim(),
            startOffset: sentenceStart,
            endOffset,
          });
        }

        i = endOffset;
        // Skip whitespace to find next sentence start
        while (i < len && isWhitespace(text[i])) i++;
        sentenceStart = i;
        continue;
      }
    }

    // Bullet markers: -, +, * at the start of a tactic (after whitespace or at line start)
    // In Coq, bullets like "- ", "+ ", "* ", "-- ", "++ ", "** " are individual "sentences"
    // They appear right after a '{' or another bullet. Handle them:
    if ((ch === '-' || ch === '+' || ch === '*') && i === sentenceStart) {
      // Check if this is a bullet: repeated chars followed by whitespace
      let j = i;
      while (j < len && text[j] === ch) j++;
      if (j < len && isWhitespace(text[j])) {
        // This is a bullet marker — it's a sentence by itself
        // But only if it's not a comment-opening (*
        if (ch === '*' && i > 0 && text[i - 1] === '(') {
          // Part of a comment, not a bullet
          i++;
          continue;
        }
        const bulletText = text.slice(i, j);
        sentences.push({
          text: bulletText,
          startOffset: i,
          endOffset: j,
        });
        i = j;
        while (i < len && isWhitespace(text[i])) i++;
        sentenceStart = i;
        continue;
      }
    }

    // Braces { and } are sentence terminators in Coq proof mode
    if (ch === '{' || ch === '}') {
      // If there's content before this brace, that content is NOT a separate sentence;
      // the brace itself is a sentence. But only emit the brace as a standalone sentence
      // if it's at the sentence start.
      if (i === sentenceStart) {
        sentences.push({
          text: ch,
          startOffset: i,
          endOffset: i + 1,
        });
        i++;
        while (i < len && isWhitespace(text[i])) i++;
        sentenceStart = i;
        continue;
      }
      // If there's content before, the brace will be part of next sentence
      // Actually in Coq, '{' and '}' are standalone sentences. We should emit
      // whatever came before as a sentence (unlikely in well-formed Coq but defensive).
    }

    i++;
  }

  // Handle remaining text (no terminator found — incomplete sentence)
  // Don't add it as a sentence since Coq requires complete sentences
  return sentences;
}

/**
 * Skip a nested comment starting at position i (where text[i]='(' and text[i+1]='*').
 * Returns the position after the closing '*)'
 */
function skipComment(text: string, i: number): number {
  let depth = 1;
  i += 2; // skip '(*'
  const len = text.length;
  while (i < len && depth > 0) {
    if (text[i] === '(' && i + 1 < len && text[i + 1] === '*') {
      depth++;
      i += 2;
    } else if (text[i] === '*' && i + 1 < len && text[i + 1] === ')') {
      depth--;
      i += 2;
    } else {
      i++;
    }
  }
  return i;
}

/**
 * Skip a string starting at position i (where text[i]='"').
 * Returns the position after the closing '"'.
 * Coq strings use "" to escape a literal quote inside.
 */
function skipString(text: string, i: number): number {
  i++; // skip opening '"'
  const len = text.length;
  while (i < len) {
    if (text[i] === '"') {
      if (i + 1 < len && text[i + 1] === '"') {
        i += 2; // escaped quote ""
      } else {
        return i + 1; // closing quote
      }
    } else {
      i++;
    }
  }
  return i; // unterminated string
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}
