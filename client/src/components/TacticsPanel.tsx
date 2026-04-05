/**
 * Tactics cheatsheet — quick reference for common Coq tactics.
 */

import { useState } from 'react';

interface Tactic {
  name: string;
  desc: string;
  example?: string;
}

interface TacticGroup {
  category: string;
  tactics: Tactic[];
}

const TACTICS: TacticGroup[] = [
  {
    category: 'Basic',
    tactics: [
      { name: 'intros', desc: 'Introduce variables and hypotheses from the goal', example: 'intros n m H.' },
      { name: 'exact', desc: 'Provide the exact proof term', example: 'exact H.' },
      { name: 'assumption', desc: 'Prove goal if it matches a hypothesis', example: 'assumption.' },
      { name: 'trivial', desc: 'Solve trivial goals automatically' },
      { name: 'auto', desc: 'Automatic proof search using hint databases' },
      { name: 'eauto', desc: 'Like auto but with existential variables' },
    ],
  },
  {
    category: 'Simplification',
    tactics: [
      { name: 'simpl', desc: 'Simplify computations in the goal', example: 'simpl.' },
      { name: 'unfold', desc: 'Expand a definition', example: 'unfold my_function.' },
      { name: 'fold', desc: 'Collapse a term back into a definition', example: 'fold my_function.' },
      { name: 'compute', desc: 'Full beta-delta-iota reduction' },
      { name: 'cbv', desc: 'Call-by-value reduction' },
      { name: 'cbn', desc: 'Call-by-name reduction (smarter than simpl)' },
    ],
  },
  {
    category: 'Equality',
    tactics: [
      { name: 'reflexivity', desc: 'Prove X = X', example: 'reflexivity.' },
      { name: 'symmetry', desc: 'Swap sides of an equality goal', example: 'symmetry.' },
      { name: 'transitivity', desc: 'Prove a = c via a = b and b = c', example: 'transitivity b.' },
      { name: 'rewrite', desc: 'Rewrite goal using an equality hypothesis', example: 'rewrite -> H.' },
      { name: 'rewrite <-', desc: 'Rewrite right-to-left', example: 'rewrite <- H.' },
      { name: 'subst', desc: 'Substitute a variable equal to a term', example: 'subst x.' },
      { name: 'f_equal', desc: 'Reduce f x = f y to x = y' },
      { name: 'congruence', desc: 'Solve goals by congruence closure' },
    ],
  },
  {
    category: 'Case Analysis',
    tactics: [
      { name: 'destruct', desc: 'Case analysis on a term', example: 'destruct n as [| n\'].' },
      { name: 'induction', desc: 'Proof by structural induction', example: 'induction n as [| n\' IHn\'].' },
      { name: 'inversion', desc: 'Invert a hypothesis (derive consequences)', example: 'inversion H.' },
      { name: 'discriminate', desc: 'Prove goal from a contradictory equality', example: 'discriminate H.' },
      { name: 'injection', desc: 'Derive equalities from constructor equality', example: 'injection H as H1.' },
    ],
  },
  {
    category: 'Logic',
    tactics: [
      { name: 'split', desc: 'Split a conjunction goal A /\\ B into two subgoals' },
      { name: 'left', desc: 'Prove A \\/ B by proving A' },
      { name: 'right', desc: 'Prove A \\/ B by proving B' },
      { name: 'exists', desc: 'Provide a witness for an existential', example: 'exists 42.' },
      { name: 'constructor', desc: 'Apply the first matching constructor' },
      { name: 'exfalso', desc: 'Prove any goal by proving False' },
      { name: 'contradiction', desc: 'Solve goal from contradictory hypotheses' },
      { name: 'tauto', desc: 'Solve propositional tautologies' },
    ],
  },
  {
    category: 'Hypothesis Management',
    tactics: [
      { name: 'apply', desc: 'Apply a hypothesis or lemma to the goal', example: 'apply H.' },
      { name: 'apply ... in', desc: 'Apply in a hypothesis (forward reasoning)', example: 'apply H1 in H2.' },
      { name: 'specialize', desc: 'Instantiate a universal hypothesis', example: 'specialize (H 0).' },
      { name: 'generalize', desc: 'Move a term from the goal to a universal', example: 'generalize dependent n.' },
      { name: 'assert', desc: 'Introduce a new sub-lemma', example: 'assert (H: P).' },
      { name: 'pose', desc: 'Introduce a local definition', example: 'pose (x := 5).' },
      { name: 'remember', desc: 'Name a subterm with an equation', example: 'remember (f x) as y.' },
      { name: 'clear', desc: 'Remove a hypothesis', example: 'clear H.' },
      { name: 'rename', desc: 'Rename a hypothesis', example: 'rename H into H2.' },
      { name: 'revert', desc: 'Move hypothesis back into the goal', example: 'revert n.' },
    ],
  },
  {
    category: 'Automation',
    tactics: [
      { name: 'omega / lia', desc: 'Solve linear integer arithmetic' },
      { name: 'ring', desc: 'Solve ring equations (nat, Z, etc.)' },
      { name: 'field', desc: 'Solve field equations' },
      { name: 'decide equality', desc: 'Prove decidable equality automatically' },
      { name: 'firstorder', desc: 'First-order logic solver' },
      { name: 'intuition', desc: 'Propositional logic with some first-order' },
    ],
  },
  {
    category: 'Control',
    tactics: [
      { name: 'try', desc: 'Try a tactic; do nothing if it fails', example: 'try reflexivity.' },
      { name: 'repeat', desc: 'Repeat a tactic until it fails', example: 'repeat rewrite H.' },
      { name: ';', desc: 'Apply tactic to all generated subgoals', example: 'split; auto.' },
      { name: 'now', desc: 'Apply tactic and close all subgoals', example: 'now auto.' },
      { name: '- + *', desc: 'Bullet markers to focus on subgoals', example: '- simpl.' },
      { name: '{ }', desc: 'Braces to focus on a subgoal' },
    ],
  },
];

export default function TacticsPanel() {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(TACTICS.map(g => g.category)));

  const toggle = (cat: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const filtered = TACTICS.map(g => ({
    ...g,
    tactics: g.tactics.filter(t =>
      !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.desc.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(g => g.tactics.length > 0);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tactics..."
          className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.map(group => (
          <div key={group.category} className="mb-1">
            <button
              onClick={() => toggle(group.category)}
              className="w-full flex items-center px-4 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                {group.category}
              </span>
              <span className="text-[10px] text-gray-600 ml-1">({group.tactics.length})</span>
              <span className="ml-auto text-gray-600 text-xs">
                {expanded.has(group.category) ? '▾' : '▸'}
              </span>
            </button>

            {expanded.has(group.category) && (
              <div className="px-2 py-1 space-y-px">
                {group.tactics.map(tactic => (
                  <div
                    key={tactic.name}
                    className="px-3 py-2 rounded-lg hover:bg-blue-50 group"
                  >
                    <code className="text-sm font-mono font-semibold text-blue-700">
                      {tactic.name}
                    </code>
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                      {tactic.desc}
                    </p>
                    {tactic.example && (
                      <code className="text-[11px] text-gray-600 font-mono mt-1 block">
                        {tactic.example}
                      </code>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Export tactic names for auto-completion */
export const ALL_TACTICS = TACTICS.flatMap(g =>
  g.tactics.map(t => ({ name: t.name, desc: t.desc }))
);
