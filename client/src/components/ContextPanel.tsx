/**
 * Shows all definitions, theorems, lemmas, etc. that have been
 * executed so far — the current Coq environment.
 */

import { useMemo } from 'react';

interface ContextEntry {
  kind: string;       // "Definition", "Theorem", "Lemma", "Inductive", etc.
  name: string;
  signature: string;  // The full first line or type signature
  blockId: number;
}

interface Props {
  executedSentences: string[];  // All sentences that have been executed
  onJumpTo?: (blockId: number) => void;
}

const DEFINITION_RE = /^(Definition|Fixpoint|CoFixpoint|Function|Let)\s+(\w+)/;
const THEOREM_RE = /^(Theorem|Lemma|Fact|Remark|Corollary|Proposition)\s+(\w+)/;
const INDUCTIVE_RE = /^(Inductive|CoInductive|Variant)\s+(\w+)/;
const RECORD_RE = /^(Record|Structure|Class)\s+(\w+)/;
const EXAMPLE_RE = /^(Example)\s+(\w+)/;
const NOTATION_RE = /^(Notation)\s+"([^"]+)"/;
const MODULE_RE = /^(Module)\s+(\w+)/;

const KIND_COLORS: Record<string, string> = {
  Definition: 'text-blue-400 bg-blue-950/50',
  Fixpoint: 'text-blue-400 bg-blue-950/50',
  Theorem: 'text-purple-400 bg-purple-950/50',
  Lemma: 'text-purple-400 bg-purple-950/50',
  Fact: 'text-purple-400 bg-purple-950/50',
  Corollary: 'text-purple-400 bg-purple-950/50',
  Proposition: 'text-purple-400 bg-purple-950/50',
  Inductive: 'text-emerald-400 bg-emerald-950/50',
  Record: 'text-emerald-400 bg-emerald-950/50',
  Example: 'text-amber-400 bg-amber-950/50',
  Notation: 'text-gray-400 bg-gray-800',
  Module: 'text-red-400 bg-red-950/50',
};

export function parseContextEntries(sentences: string[]): ContextEntry[] {
  const entries: ContextEntry[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    const firstLine = trimmed.split('\n')[0];

    for (const [re, kind] of [
      [DEFINITION_RE, null],
      [THEOREM_RE, null],
      [INDUCTIVE_RE, null],
      [RECORD_RE, null],
      [EXAMPLE_RE, null],
      [NOTATION_RE, null],
      [MODULE_RE, null],
    ] as [RegExp, null][]) {
      const m = firstLine.match(re);
      if (m) {
        entries.push({
          kind: m[1],
          name: m[2],
          signature: firstLine,
          blockId: 0,
        });
        break;
      }
    }
  }

  return entries;
}

/** Extract just the names for auto-completion */
export function getContextNames(entries: ContextEntry[]): { name: string; kind: string }[] {
  return entries.map(e => ({ name: e.name, kind: e.kind }));
}

export default function ContextPanel({ executedSentences }: Props) {
  const entries = useMemo(() => parseContextEntries(executedSentences), [executedSentences]);

  // Group by kind
  const groups = useMemo(() => {
    const map = new Map<string, ContextEntry[]>();
    for (const e of entries) {
      const group = ['Theorem', 'Lemma', 'Fact', 'Corollary', 'Proposition'].includes(e.kind)
        ? 'Theorems & Lemmas'
        : ['Definition', 'Fixpoint', 'CoFixpoint', 'Function', 'Let'].includes(e.kind)
        ? 'Definitions'
        : ['Inductive', 'CoInductive', 'Variant', 'Record', 'Structure', 'Class'].includes(e.kind)
        ? 'Types'
        : e.kind === 'Example'
        ? 'Examples'
        : e.kind === 'Notation'
        ? 'Notations'
        : 'Other';
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(e);
    }
    return map;
  }, [entries]);

  const groupOrder = ['Types', 'Definitions', 'Theorems & Lemmas', 'Examples', 'Notations', 'Other'];

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3">
        <p className="text-[10px] text-gray-500">{entries.length} definitions in scope</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-gray-500 text-sm">No definitions yet</p>
            <p className="text-gray-600 text-xs mt-1">Step through code to populate</p>
          </div>
        )}

        {groupOrder.map(groupName => {
          const items = groups.get(groupName);
          if (!items || items.length === 0) return null;
          return (
            <div key={groupName} className="mb-1">
              <div className="px-4 py-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  {groupName}
                </span>
                <span className="text-[10px] text-gray-600 ml-1">({items.length})</span>
              </div>
              <div className="px-2 py-0.5 space-y-px">
                {items.map((e, i) => (
                  <div
                    key={`${e.name}-${i}`}
                    className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-gray-800/50 cursor-default"
                    title={e.signature}
                  >
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                      KIND_COLORS[e.kind] || 'text-gray-400 bg-gray-800'
                    }`}>
                      {e.kind.slice(0, 3)}
                    </span>
                    <span className="text-xs font-mono text-gray-300 truncate">
                      {e.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
