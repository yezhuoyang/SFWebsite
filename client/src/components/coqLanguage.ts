/**
 * Coq/Rocq language definition for Monaco editor.
 * Provides syntax highlighting matching VSCode's Coq extension.
 */
import type * as Monaco from 'monaco-editor';

export const COQ_LANGUAGE_ID = 'coq';

export const coqLanguageConfig: Monaco.languages.LanguageConfiguration = {
  comments: {
    blockComment: ['(*', '*)'],
  },
  brackets: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"' },
  ],
};

export const coqTokenProvider: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',

  keywords: [
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
  ],

  tactics: [
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
  ],

  vernacular: [
    'forall', 'exists', 'fun', 'match', 'end', 'let', 'if', 'then', 'else',
    'fix', 'cofix', 'struct', 'Type', 'Prop', 'SProp',
  ],

  builtinTypes: [
    'nat', 'bool', 'list', 'option', 'string', 'unit', 'Empty_set',
    'True', 'False', 'O', 'S', 'nil', 'cons',
    'Some', 'None', 'pair', 'fst', 'snd',
    'true', 'false', 'tt',
    'Nat', 'Bool', 'List', 'String',
    'eq', 'eq_refl', 'and', 'or', 'not', 'iff',
  ],

  operators: [
    '->', '<->', '/\\', '\\/', '~', ':=', '=>', '|', ':',
    '+', '-', '*', '/', '=', '<', '>', '<=', '>=', '<>',
    '++', '::', '&&', '||', ';;',
  ],

  symbols: /[=><!~?:&|+\-*\/\^%@#]+/,

  tokenizer: {
    root: [
      // Comments - block comments can nest in Coq
      [/\(\*(?!\*)/, 'comment', '@comment'],

      // Documentation comments (** ... *)
      [/\(\*\*/, 'comment.doc', '@docComment'],

      // Strings
      [/"/, 'string', '@string'],

      // Numbers
      [/\b\d+\b/, 'number'],

      // Bullets and focusing
      [/^[\s]*[-+*]+(?=\s)/, 'keyword.tactic'],

      // Identifiers and keywords
      [/[a-zA-Z_]\w*'*/, {
        cases: {
          '@keywords': 'keyword',
          '@tactics': 'keyword.tactic',
          '@vernacular': 'keyword.vernacular',
          '@builtinTypes': 'type',
          '@default': 'identifier',
        },
      }],

      // Operators
      [/@symbols/, {
        cases: {
          '@operators': 'operator',
          '@default': '',
        },
      }],

      // Delimiters
      [/[{}()\[\]]/, '@brackets'],

      // Period (sentence terminator)
      [/\.(?=\s|$)/, 'delimiter.period'],

      // Whitespace
      [/\s+/, 'white'],
    ],

    comment: [
      [/\(\*/, 'comment', '@push'],  // nested comment
      [/\*\)/, 'comment', '@pop'],
      [/./, 'comment'],
    ],

    docComment: [
      [/\*\)/, 'comment.doc', '@pop'],
      [/./, 'comment.doc'],
    ],

    string: [
      [/[^"]+/, 'string'],
      [/""/, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],
  },
};

// Colors extracted from SF website's sf.css:
// .id[title="keyword"]       → #697f2f (olive green)
// .id[title="constructor"]   → #697f2f
// .id[title="var"]           → rgb(40%,0%,40%) = #660066
// .id[title="definition"]    → rgb(0%,40%,0%) = #006600
// .id[title="inductive"]     → #034764 (dark teal)
// .inlinecode                → #444444
// .doc .inlinecode            → rgb(35%,35%,70%) = #5959b3
export const coqTheme: Monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '697f2f' },             // SF keyword green
    { token: 'keyword.tactic', foreground: '697f2f' },      // Same as keyword in SF
    { token: 'keyword.vernacular', foreground: '697f2f' },
    { token: 'type', foreground: '034764' },                 // SF inductive teal
    { token: 'comment', foreground: '808080', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '808080', fontStyle: 'italic' },
    { token: 'string', foreground: 'a31515' },
    { token: 'number', foreground: '098658' },
    { token: 'operator', foreground: '444444' },
    { token: 'delimiter.period', foreground: '444444' },
    { token: 'identifier', foreground: '660066' },           // SF variable purple
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#444444',
    'editorLineNumber.foreground': '#cccccc',
    'editorCursor.foreground': '#333333',
    'editor.selectionBackground': '#b0c4de50',
    'editor.lineHighlightBackground': '#f8f8f5',
  },
};

/**
 * Dynamic context names for auto-completion.
 * Updated by ChapterPage as sentences are executed.
 */
let _contextNames: { name: string; kind: string }[] = [];
export function setCompletionContext(names: { name: string; kind: string }[]) {
  _contextNames = names;
}

const TACTIC_COMPLETIONS = [
  { name: 'intros', detail: 'Introduce variables and hypotheses' },
  { name: 'intro', detail: 'Introduce one variable' },
  { name: 'simpl', detail: 'Simplify computations' },
  { name: 'reflexivity', detail: 'Prove X = X' },
  { name: 'rewrite', detail: 'Rewrite using equality' },
  { name: 'induction', detail: 'Structural induction' },
  { name: 'destruct', detail: 'Case analysis' },
  { name: 'apply', detail: 'Apply hypothesis/lemma' },
  { name: 'exact', detail: 'Provide exact proof term' },
  { name: 'assumption', detail: 'Solve from hypothesis' },
  { name: 'unfold', detail: 'Expand a definition' },
  { name: 'assert', detail: 'Introduce sub-lemma' },
  { name: 'auto', detail: 'Automatic proof search' },
  { name: 'eauto', detail: 'Extended auto' },
  { name: 'omega', detail: 'Linear arithmetic (deprecated, use lia)' },
  { name: 'lia', detail: 'Linear integer arithmetic' },
  { name: 'discriminate', detail: 'Contradictory equality' },
  { name: 'injection', detail: 'Constructor injectivity' },
  { name: 'inversion', detail: 'Invert a hypothesis' },
  { name: 'subst', detail: 'Substitute variable' },
  { name: 'split', detail: 'Split conjunction' },
  { name: 'left', detail: 'Prove left of disjunction' },
  { name: 'right', detail: 'Prove right of disjunction' },
  { name: 'exists', detail: 'Provide existential witness' },
  { name: 'constructor', detail: 'Apply matching constructor' },
  { name: 'exfalso', detail: 'Prove by contradiction' },
  { name: 'contradiction', detail: 'Contradictory hypotheses' },
  { name: 'symmetry', detail: 'Swap equality sides' },
  { name: 'transitivity', detail: 'Transitive equality step' },
  { name: 'generalize', detail: 'Generalize a term' },
  { name: 'specialize', detail: 'Instantiate universal hypothesis' },
  { name: 'pose', detail: 'Local definition' },
  { name: 'remember', detail: 'Name a subterm' },
  { name: 'clear', detail: 'Remove hypothesis' },
  { name: 'rename', detail: 'Rename hypothesis' },
  { name: 'revert', detail: 'Move hypothesis to goal' },
  { name: 'replace', detail: 'Replace a subterm' },
  { name: 'f_equal', detail: 'Reduce f x = f y to x = y' },
  { name: 'congruence', detail: 'Congruence closure' },
  { name: 'tauto', detail: 'Propositional tautology' },
  { name: 'intuition', detail: 'Propositional + some first-order' },
  { name: 'firstorder', detail: 'First-order logic' },
  { name: 'ring', detail: 'Ring equations' },
  { name: 'field', detail: 'Field equations' },
  { name: 'trivial', detail: 'Trivial goals' },
  { name: 'now', detail: 'Apply and close all subgoals' },
  { name: 'try', detail: 'Try tactic, no-op if fails' },
  { name: 'repeat', detail: 'Repeat until failure' },
  { name: 'compute', detail: 'Full reduction' },
  { name: 'cbn', detail: 'Call-by-name reduction' },
  { name: 'cbv', detail: 'Call-by-value reduction' },
  { name: 'fold', detail: 'Fold back a definition' },
  { name: 'change', detail: 'Change goal to convertible term' },
  { name: 'pattern', detail: 'Abstract a subterm' },
];

const KEYWORD_COMPLETIONS = [
  'Theorem', 'Lemma', 'Definition', 'Fixpoint', 'Inductive',
  'Example', 'Proof', 'Qed', 'Admitted', 'Abort',
  'Check', 'Compute', 'Print', 'Search', 'Eval',
  'From', 'Require', 'Import', 'Export', 'Open', 'Scope',
  'Module', 'End', 'Section', 'Variable', 'Hypothesis',
  'Notation', 'Record', 'Structure', 'Class', 'Instance',
  'match', 'with', 'end', 'fun', 'forall', 'exists',
  'let', 'in', 'if', 'then', 'else', 'return', 'as',
  'Type', 'Prop', 'Set',
];

let _completionRegistered = false;

export function registerCoqLanguage(monaco: typeof Monaco) {
  if (!monaco.languages.getLanguages().some(l => l.id === COQ_LANGUAGE_ID)) {
    monaco.languages.register({ id: COQ_LANGUAGE_ID, extensions: ['.v'] });
    monaco.languages.setLanguageConfiguration(COQ_LANGUAGE_ID, coqLanguageConfig);
    monaco.languages.setMonarchTokensProvider(COQ_LANGUAGE_ID, coqTokenProvider);
    monaco.editor.defineTheme('coqTheme', coqTheme);
  }

  // Register completion provider once
  if (!_completionRegistered) {
    _completionRegistered = true;
    monaco.languages.registerCompletionItemProvider(COQ_LANGUAGE_ID, {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions: Monaco.languages.CompletionItem[] = [];

        // Tactics
        for (const t of TACTIC_COMPLETIONS) {
          suggestions.push({
            label: t.name,
            kind: monaco.languages.CompletionItemKind.Function,
            detail: t.detail,
            insertText: t.name,
            range,
            sortText: `0_${t.name}`, // Tactics first
          });
        }

        // Context definitions (from executed code)
        for (const ctx of _contextNames) {
          suggestions.push({
            label: ctx.name,
            kind: ctx.kind === 'Theorem' || ctx.kind === 'Lemma'
              ? monaco.languages.CompletionItemKind.Reference
              : ctx.kind === 'Inductive'
              ? monaco.languages.CompletionItemKind.Enum
              : monaco.languages.CompletionItemKind.Variable,
            detail: ctx.kind,
            insertText: ctx.name,
            range,
            sortText: `1_${ctx.name}`, // Context second
          });
        }

        // Keywords
        for (const kw of KEYWORD_COMPLETIONS) {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            sortText: `2_${kw}`, // Keywords last
          });
        }

        return { suggestions };
      },
    });
  }
}
