import type { CSSProperties } from 'react';

/**
 * Lightweight Coq syntax highlighter that mirrors the lecture's coqTheme.
 *
 * Not a full Monaco editor — just a regex-based tokenizer rendered as React spans.
 * Matches the colors from coqLanguage.ts (SF theme):
 *   keyword / tactic / vernacular: #697f2f (olive green)
 *   inductive types:               #034764 (dark teal)
 *   comments:                      #808080 italic
 *   string:                        #a31515
 *   number:                        #098658
 *   identifiers:                   #660066 (purple)
 *   operators / delimiters:        #444444
 */

const KEYWORDS = new Set([
  'Theorem', 'Lemma', 'Proof', 'Qed', 'Defined', 'Admitted', 'Abort',
  'Definition', 'Fixpoint', 'CoFixpoint', 'Function',
  'Inductive', 'CoInductive', 'Record', 'Structure',
  'Example', 'Fact', 'Remark', 'Corollary', 'Proposition',
  'Module', 'End', 'Section', 'Import', 'Export', 'Require', 'From', 'Open', 'Scope',
  'Variable', 'Variables', 'Parameter', 'Parameters', 'Axiom', 'Hypothesis', 'Hypotheses',
  'Notation', 'Infix', 'Reserved',
  'Check', 'Compute', 'Eval', 'Print', 'Search', 'SearchAbout', 'SearchPattern',
  'Set', 'Unset', 'Local', 'Global',
  'Ltac', 'Ltac2', 'Tactic',
  'Declare', 'Instance', 'Class', 'Existing',
  'Transparent', 'Opaque', 'Arguments', 'Implicit',
  'Program', 'Obligation', 'Next', 'Solve', 'Obligations',
  'Derive', 'Equations',
  'with', 'as', 'in', 'return', 'where',
]);

const TACTICS = new Set([
  'intros', 'intro', 'simpl', 'reflexivity', 'rewrite', 'induction',
  'destruct', 'apply', 'unfold', 'assert', 'exact', 'assumption',
  'auto', 'eauto', 'omega', 'lia', 'ring', 'field',
  'discriminate', 'injection', 'inversion', 'subst',
  'split', 'left', 'right', 'exists', 'constructor',
  'contradiction', 'exfalso', 'absurd',
  'trivial', 'tauto', 'intuition', 'firstorder',
  'generalize', 'dependent', 'specialize', 'pose', 'remember',
  'clear', 'rename', 'revert', 'replace', 'symmetry', 'transitivity',
  'case', 'elim', 'pattern', 'change', 'compute', 'cbv', 'lazy',
  'fold', 'red', 'hnf', 'cbn',
  'try', 'repeat', 'now', 'solve',
  'f_equal', 'congruence', 'decide', 'equality',
]);

const VERNACULAR = new Set([
  'forall', 'exists', 'fun', 'match', 'end', 'let', 'if', 'then', 'else',
  'fix', 'cofix', 'struct', 'Type', 'Prop', 'SProp',
]);

const TYPES = new Set([
  'nat', 'bool', 'list', 'option', 'string', 'unit', 'Empty_set',
  'True', 'False', 'O', 'S', 'nil', 'cons',
  'Some', 'None', 'pair', 'fst', 'snd',
  'true', 'false', 'tt',
  'Nat', 'Bool', 'List', 'String',
  'eq', 'eq_refl', 'and', 'or', 'not', 'iff',
]);

const STYLES: Record<string, CSSProperties> = {
  keyword:   { color: '#697f2f' },
  tactic:    { color: '#697f2f' },
  vern:      { color: '#697f2f' },
  type:      { color: '#034764' },
  comment:   { color: '#808080', fontStyle: 'italic' },
  string:    { color: '#a31515' },
  number:    { color: '#098658' },
  ident:     { color: '#660066' },
  op:        { color: '#444444' },
  plain:     { color: '#1f2937' },
};

type Token = { type: keyof typeof STYLES; text: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    // Block comment (* ... *) with nesting
    if (c === '(' && src[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === '(' && src[j + 1] === '*') { depth++; j += 2; }
        else if (src[j] === '*' && src[j + 1] === ')') { depth--; j += 2; }
        else { j++; }
      }
      tokens.push({ type: 'comment', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // String
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < n) j += 2;
        else j++;
      }
      if (j < n) j++; // include closing quote
      tokens.push({ type: 'string', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Number
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9]/.test(src[j])) j++;
      tokens.push({ type: 'number', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Identifier / keyword
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[a-zA-Z0-9_']/.test(src[j])) j++;
      const word = src.slice(i, j);
      let type: Token['type'];
      if (KEYWORDS.has(word)) type = 'keyword';
      else if (TACTICS.has(word)) type = 'tactic';
      else if (VERNACULAR.has(word)) type = 'vern';
      else if (TYPES.has(word)) type = 'type';
      else type = 'ident';
      tokens.push({ type, text: word });
      i = j;
      continue;
    }

    // Operators and punctuation — run together
    if (/[=><!~?:&|+\-*/^%@#.,;(){}\[\]]/.test(c)) {
      // Grab a small run of punctuation
      let j = i + 1;
      while (j < n && /[=><!~?:&|+\-*/^%@#]/.test(src[j])) j++;
      tokens.push({ type: 'op', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Whitespace or other
    let j = i + 1;
    while (j < n && /\s/.test(src[j])) j++;
    tokens.push({ type: 'plain', text: src.slice(i, j) });
    i = j;
  }

  return tokens;
}

interface Props {
  code: string;
  className?: string;
  /**
   * If provided, clamp visible lines to this many with a fade-out gradient.
   * Omit to show the full code.
   */
  maxLines?: number;
}

export default function CoqCodeBlock({ code, className = '', maxLines }: Props) {
  const tokens = tokenize(code);
  const approxLines = code.split('\n').length;
  const clamp = maxLines !== undefined && approxLines > maxLines;

  return (
    <div
      className={`relative font-mono text-[12px] leading-[1.55] bg-[#fafafa] border border-gray-200 rounded-lg p-3 whitespace-pre-wrap overflow-x-auto ${className}`}
      style={clamp
        ? { maxHeight: `${maxLines! * 1.55 + 1.5}em`, overflowY: 'hidden' }
        : undefined}
    >
      {tokens.map((t, k) => (
        <span key={k} style={STYLES[t.type]}>{t.text}</span>
      ))}
      {clamp && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#fafafa] to-transparent" />
      )}
    </div>
  );
}
