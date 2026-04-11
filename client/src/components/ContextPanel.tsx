/**
 * Context panel: shows all definitions, theorems, lemmas, inductives, etc.
 * that have been executed so far — i.e., the current Coq environment.
 *
 * Features:
 *   - Grouped by kind (Types / Definitions / Theorems / Examples / Notations)
 *   - Click a name to expand its body inline (no round-trip to the code area)
 *   - "Jump" link scrolls the corresponding block into view
 *   - Search box filters by name
 */

import { useMemo, useState } from 'react';
import CoqCodeBlock from './CoqCodeBlock';

export interface ContextEntry {
  kind: string;         // "Definition", "Theorem", "Lemma", ...
  name: string;
  signature: string;    // first line (e.g. "Definition nandb (b1 b2:bool) : bool :=")
  body: string;         // full text of the vernacular sentence
  blockId: number;      // which block it belongs to (for jump-to-source)
  line: number;         // 0-indexed absolute line number where it begins
}

interface Props {
  entries: ContextEntry[];
  onJumpTo?: (blockId: number, line: number) => void;
}

const KIND_COLORS: Record<string, { text: string; bg: string }> = {
  Definition:   { text: 'text-blue-700',   bg: 'bg-blue-50' },
  Fixpoint:     { text: 'text-blue-700',   bg: 'bg-blue-50' },
  CoFixpoint:   { text: 'text-blue-700',   bg: 'bg-blue-50' },
  Function:     { text: 'text-blue-700',   bg: 'bg-blue-50' },
  Let:          { text: 'text-blue-700',   bg: 'bg-blue-50' },
  Theorem:      { text: 'text-purple-700', bg: 'bg-purple-50' },
  Lemma:        { text: 'text-purple-700', bg: 'bg-purple-50' },
  Fact:         { text: 'text-purple-700', bg: 'bg-purple-50' },
  Corollary:    { text: 'text-purple-700', bg: 'bg-purple-50' },
  Proposition:  { text: 'text-purple-700', bg: 'bg-purple-50' },
  Remark:       { text: 'text-purple-700', bg: 'bg-purple-50' },
  Inductive:    { text: 'text-green-700',  bg: 'bg-green-50' },
  CoInductive:  { text: 'text-green-700',  bg: 'bg-green-50' },
  Variant:      { text: 'text-green-700',  bg: 'bg-green-50' },
  Record:       { text: 'text-green-700',  bg: 'bg-green-50' },
  Structure:    { text: 'text-green-700',  bg: 'bg-green-50' },
  Class:        { text: 'text-green-700',  bg: 'bg-green-50' },
  Instance:     { text: 'text-teal-700',   bg: 'bg-teal-50' },
  Example:      { text: 'text-amber-700',  bg: 'bg-amber-50' },
  Notation:     { text: 'text-gray-600',   bg: 'bg-gray-100' },
  Module:       { text: 'text-red-700',    bg: 'bg-red-50' },
  Axiom:        { text: 'text-rose-700',   bg: 'bg-rose-50' },
  Hypothesis:   { text: 'text-rose-700',   bg: 'bg-rose-50' },
};

const GROUP_OF: Record<string, string> = {
  Definition: 'Definitions', Fixpoint: 'Definitions', CoFixpoint: 'Definitions', Function: 'Definitions', Let: 'Definitions',
  Theorem: 'Theorems & Lemmas', Lemma: 'Theorems & Lemmas', Fact: 'Theorems & Lemmas',
  Corollary: 'Theorems & Lemmas', Proposition: 'Theorems & Lemmas', Remark: 'Theorems & Lemmas',
  Inductive: 'Types', CoInductive: 'Types', Variant: 'Types',
  Record: 'Types', Structure: 'Types', Class: 'Types',
  Instance: 'Instances',
  Example: 'Examples',
  Notation: 'Notations',
  Module: 'Modules',
  Axiom: 'Axioms', Hypothesis: 'Axioms',
};

const GROUP_ORDER = [
  'Types', 'Definitions', 'Theorems & Lemmas', 'Instances',
  'Examples', 'Notations', 'Modules', 'Axioms', 'Other',
];

export default function ContextPanel({ entries, onJumpTo }: Props) {
  const [query, setQuery] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e => e.name.toLowerCase().includes(q));
  }, [entries, query]);

  const groups = useMemo(() => {
    const map = new Map<string, ContextEntry[]>();
    for (const e of filtered) {
      const group = GROUP_OF[e.kind] || 'Other';
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(e);
    }
    return map;
  }, [filtered]);

  return (
    <div className="h-full flex flex-col">
      {/* Header + search */}
      <div className="px-3 py-2 border-b border-gray-100 bg-white">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
            Environment
          </p>
          <span className="text-[10px] text-gray-400">
            {filtered.length} of {entries.length}
          </span>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name&hellip;"
          className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:border-indigo-400"
        />
      </div>

      {/* Entry list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {entries.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-gray-500 text-sm">No definitions yet</p>
            <p className="text-gray-600 text-xs mt-1">Step through code to populate</p>
          </div>
        )}

        {entries.length > 0 && filtered.length === 0 && (
          <div className="p-6 text-center text-xs text-gray-400">
            No definitions match "{query}"
          </div>
        )}

        {GROUP_ORDER.map(groupName => {
          const items = groups.get(groupName);
          if (!items || items.length === 0) return null;
          return (
            <div key={groupName} className="mb-1">
              <div className="px-3 py-1.5 sticky top-0 bg-gray-50/90 backdrop-blur-sm border-b border-gray-100">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  {groupName}
                </span>
                <span className="text-[10px] text-gray-400 ml-1">({items.length})</span>
              </div>
              <div className="py-0.5">
                {items.map((e) => {
                  const key = `${e.kind}-${e.name}-${e.line}`;
                  const expanded = expandedKeys.has(key);
                  const colors = KIND_COLORS[e.kind] || { text: 'text-gray-600', bg: 'bg-gray-100' };
                  return (
                    <div key={key} className="border-b border-gray-50 last:border-b-0">
                      {/* Row: kind badge + name + jump button */}
                      <div
                        onClick={() => toggleExpand(key)}
                        className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                          expanded ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                        }`}
                      >
                        <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded shrink-0 ${colors.text} ${colors.bg}`}>
                          {e.kind.slice(0, 3)}
                        </span>
                        <span className="text-xs font-mono text-gray-800 truncate flex-1" title={e.signature}>
                          {e.name}
                        </span>
                        <span className="text-[10px] text-gray-300 shrink-0">
                          {expanded ? '\u25B2' : '\u25BC'}
                        </span>
                        {onJumpTo && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); onJumpTo(e.blockId, e.line); }}
                            className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium shrink-0"
                            title="Jump to where this is defined"
                          >
                            jump
                          </button>
                        )}
                      </div>

                      {/* Expanded body */}
                      {expanded && (
                        <div className="px-3 pb-2.5 pt-0.5 bg-indigo-50/20">
                          <CoqCodeBlock code={e.body} maxLines={20} />
                          <div className="text-[10px] text-gray-400 mt-1">
                            defined at line {e.line + 1}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Extract just the names for auto-completion (consumed by coqLanguage) */
export function getContextNames(entries: ContextEntry[]): { name: string; kind: string }[] {
  return entries.map(e => ({ name: e.name, kind: e.kind }));
}

// --- Rich parsing: extract entries from fully-processed blocks ---

const VERNAC_KIND_RE = new RegExp(
  '^\\s*(Theorem|Lemma|Fact|Remark|Corollary|Proposition|' +
  'Definition|Fixpoint|CoFixpoint|Function|Let|' +
  'Inductive|CoInductive|Variant|Record|Structure|Class|Instance|' +
  'Example|Notation|Module|Axiom|Hypothesis)\\b'
);

const NAME_RE = /^\s*\w+\s+(?:Local\s+|Global\s+|Polymorphic\s+)?([A-Za-z_][\w']*)/;
const NOTATION_NAME_RE = /^\s*Notation\s+"([^"]+)"/;

/**
 * Parse a processed block's source into a list of top-level vernacular
 * entries. Uses the same period-terminated sentence model as the Coq engine
 * (via parseSentences from `coq/sentenceParser`), so comments and strings are
 * handled correctly.
 *
 * @param text       Source text of the block
 * @param blockId    ID to attach to each entry
 * @param baseLine0  0-indexed absolute line number of the block's first line
 *                   (so entries carry their true document-line for jump-to)
 */
export function parseBlockEntries(
  text: string,
  blockId: number,
  baseLine0: number,
  parseSentences: (src: string) => Array<{ text: string; startOffset: number; endOffset: number }>,
): ContextEntry[] {
  const entries: ContextEntry[] = [];
  const sentences = parseSentences(text);

  for (const s of sentences) {
    const body = s.text.trim();
    if (!body) continue;
    const kindMatch = body.match(VERNAC_KIND_RE);
    if (!kindMatch) continue;
    const kind = kindMatch[1];

    let name: string | null = null;
    if (kind === 'Notation') {
      const m = body.match(NOTATION_NAME_RE);
      name = m ? m[1] : null;
    } else {
      const m = body.match(NAME_RE);
      name = m ? m[1] : null;
    }
    if (!name) continue;

    // Compute the absolute line of this sentence's start
    const prefix = text.slice(0, s.startOffset);
    const localLine = (prefix.match(/\n/g) || []).length;
    const line = baseLine0 + localLine;

    entries.push({
      kind,
      name,
      signature: body.split('\n')[0],
      body,
      blockId,
      line,
    });
  }

  return entries;
}
