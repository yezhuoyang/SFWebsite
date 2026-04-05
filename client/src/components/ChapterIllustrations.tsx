import React from 'react';
/**
 * Small thematic SVG illustrations for individual chapters.
 * Displayed in the VolumePage chapter list.
 */

const W = 120, H = 56;

function Mini({ children }: { children: React.ReactNode }) {
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" className="shrink-0">{children}</svg>;
}

const chapters: Record<string, () => React.JSX.Element> = {
  // === LF ===
  Basics: () => (
    <Mini>
      <text x="4" y="18" fill="#2563eb" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="600">true</text>
      <text x="48" y="18" fill="#6b7280" fontSize="10" fontFamily="monospace">|</text>
      <text x="58" y="18" fill="#dc2626" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="600">false</text>
      <text x="4" y="38" fill="#0891b2" fontSize="13" fontFamily="monospace" fontWeight="700">O | S n</text>
      <text x="70" y="38" fill="#9ca3af" fontSize="10" fontFamily="monospace">: nat</text>
      <text x="4" y="52" fill="#a3a3a3" fontSize="9" fontFamily="monospace">match · with</text>
    </Mini>
  ),
  Induction: () => (
    <Mini>
      <text x="4" y="15" fill="#dc2626" fontSize="10" fontFamily="monospace" fontWeight="600">P(0) ✓</text>
      <text x="4" y="30" fill="#dc2626" fontSize="10" fontFamily="monospace" fontWeight="600">P(k)→P(S k) ✓</text>
      <line x1="4" y1="35" x2="95" y2="35" stroke="#dc2626" strokeWidth="1.5" />
      <text x="4" y="50" fill="#991b1b" fontSize="12" fontFamily="monospace" fontWeight="700">∀n. P(n)</text>
    </Mini>
  ),
  Lists: () => (
    <Mini>
      <rect x="4" y="12" width="20" height="16" rx="3" stroke="#0891b2" strokeWidth="1.5" fill="#ecfeff" />
      <text x="9" y="24" fill="#0e7490" fontSize="10" fontFamily="monospace" fontWeight="700">1</text>
      <line x1="24" y1="20" x2="32" y2="20" stroke="#0891b2" strokeWidth="1.5" />
      <rect x="32" y="12" width="20" height="16" rx="3" stroke="#0891b2" strokeWidth="1.5" fill="#ecfeff" />
      <text x="37" y="24" fill="#0e7490" fontSize="10" fontFamily="monospace" fontWeight="700">2</text>
      <line x1="52" y1="20" x2="60" y2="20" stroke="#0891b2" strokeWidth="1.5" />
      <rect x="60" y="12" width="20" height="16" rx="3" stroke="#0891b2" strokeWidth="1.5" fill="#ecfeff" />
      <text x="65" y="24" fill="#0e7490" fontSize="10" fontFamily="monospace" fontWeight="700">3</text>
      <line x1="80" y1="20" x2="88" y2="20" stroke="#0891b2" strokeWidth="1.5" />
      <text x="90" y="24" fill="#9ca3af" fontSize="9" fontFamily="monospace">nil</text>
      <text x="4" y="48" fill="#a3a3a3" fontSize="9" fontFamily="monospace">app · rev · map</text>
    </Mini>
  ),
  Poly: () => (
    <Mini>
      <text x="4" y="18" fill="#7c3aed" fontSize="12" fontFamily="monospace" fontWeight="700">∀ X : Type,</text>
      <text x="4" y="34" fill="#6d28d9" fontSize="11" fontFamily="monospace" fontWeight="600">list X → list X</text>
      <text x="4" y="50" fill="#a3a3a3" fontSize="9" fontFamily="monospace">map · fold · filter</text>
    </Mini>
  ),
  Tactics: () => (
    <Mini>
      <text x="4" y="15" fill="#16a34a" fontSize="10" fontFamily="monospace" fontWeight="600">intros n.</text>
      <text x="4" y="28" fill="#16a34a" fontSize="10" fontFamily="monospace" fontWeight="600">destruct n.</text>
      <text x="4" y="41" fill="#16a34a" fontSize="10" fontFamily="monospace" fontWeight="600">apply IHn.</text>
      <text x="80" y="41" fill="#15803d" fontSize="12">⊢</text>
      <text x="4" y="53" fill="#a3a3a3" fontSize="9" fontFamily="monospace">proof strategy</text>
    </Mini>
  ),
  Logic: () => (
    <Mini>
      <text x="4" y="16" fill="#7c3aed" fontSize="12" fontFamily="serif" fontWeight="700">P ∧ Q    P ∨ Q</text>
      <text x="4" y="34" fill="#7c3aed" fontSize="12" fontFamily="serif" fontWeight="700">P → Q    ¬P</text>
      <text x="4" y="50" fill="#7c3aed" fontSize="11" fontFamily="serif" fontWeight="600">∀x. ∃y. P x y</text>
    </Mini>
  ),
  IndProp: () => (
    <Mini>
      <text x="4" y="14" fill="#dc2626" fontSize="9" fontFamily="monospace" fontWeight="600">ev_0 : ev 0</text>
      <text x="4" y="28" fill="#dc2626" fontSize="9" fontFamily="monospace" fontWeight="600">ev_SS: ev n→ev(S(S n))</text>
      <line x1="4" y1="33" x2="115" y2="33" stroke="#dc2626" strokeWidth="1" />
      <text x="4" y="48" fill="#991b1b" fontSize="10" fontFamily="monospace" fontWeight="700">Inductive ev : nat→Prop</text>
    </Mini>
  ),
  Maps: () => (
    <Mini>
      <rect x="4" y="6" width="50" height="14" rx="3" stroke="#16a34a" strokeWidth="1.5" fill="#f0fdf4" />
      <text x="8" y="17" fill="#15803d" fontSize="9" fontFamily="monospace" fontWeight="600">"x" ↦ 5</text>
      <rect x="4" y="24" width="50" height="14" rx="3" stroke="#16a34a" strokeWidth="1.5" fill="#f0fdf4" />
      <text x="8" y="35" fill="#15803d" fontSize="9" fontFamily="monospace" fontWeight="600">"y" ↦ 3</text>
      <rect x="4" y="42" width="50" height="14" rx="3" stroke="#16a34a" strokeWidth="1.5" fill="#f0fdf4" />
      <text x="8" y="53" fill="#15803d" fontSize="9" fontFamily="monospace" fontWeight="600">"_" ↦ 0</text>
      <text x="62" y="35" fill="#a3a3a3" fontSize="9" fontFamily="monospace">total_map</text>
    </Mini>
  ),
  ProofObjects: () => (
    <Mini>
      <text x="4" y="16" fill="#7c3aed" fontSize="10" fontFamily="monospace" fontWeight="600">Prop ≅ Type</text>
      <text x="4" y="32" fill="#6d28d9" fontSize="10" fontFamily="monospace" fontWeight="600">proof ≅ term</text>
      <text x="4" y="48" fill="#a78bfa" fontSize="9" fontFamily="monospace">Curry-Howard</text>
    </Mini>
  ),
  Rel: () => (
    <Mini>
      <text x="4" y="16" fill="#7c3aed" fontSize="11" fontFamily="monospace" fontWeight="600">R : A→A→Prop</text>
      <text x="4" y="34" fill="#6d28d9" fontSize="10" fontFamily="monospace" fontWeight="500">reflexive · transitive</text>
      <text x="4" y="48" fill="#a78bfa" fontSize="9" fontFamily="monospace">partial_order</text>
    </Mini>
  ),
  Imp: () => (
    <Mini>
      <text x="4" y="14" fill="#dc2626" fontSize="9" fontFamily="monospace" fontWeight="600">X := X + 1;</text>
      <text x="4" y="27" fill="#dc2626" fontSize="9" fontFamily="monospace" fontWeight="600">while X {'<'} 5 do</text>
      <text x="4" y="40" fill="#dc2626" fontSize="9" fontFamily="monospace" fontWeight="600">  Y := Y * X</text>
      <text x="4" y="53" fill="#a3a3a3" fontSize="9" fontFamily="monospace">imperative lang</text>
    </Mini>
  ),
  IndPrinciples: () => (
    <Mini>
      <text x="4" y="16" fill="#dc2626" fontSize="10" fontFamily="monospace" fontWeight="600">nat_ind :</text>
      <text x="4" y="30" fill="#b91c1c" fontSize="9" fontFamily="monospace">P 0 →</text>
      <text x="4" y="42" fill="#b91c1c" fontSize="9" fontFamily="monospace">(∀n. P n→P(S n)) →</text>
      <text x="4" y="54" fill="#991b1b" fontSize="10" fontFamily="monospace" fontWeight="700">∀n. P n</text>
    </Mini>
  ),

  // === PLF ===
  Equiv: () => (
    <Mini>
      <text x="4" y="16" fill="#7c3aed" fontSize="10" fontFamily="monospace" fontWeight="600">c₁ ≅ c₂ ↔</text>
      <text x="4" y="32" fill="#6d28d9" fontSize="9" fontFamily="monospace">∀st st'. st=[c₁]⇒st'</text>
      <text x="4" y="44" fill="#6d28d9" fontSize="9" fontFamily="monospace">      ↔ st=[c₂]⇒st'</text>
    </Mini>
  ),
  Hoare: () => (
    <Mini>
      <rect x="4" y="8" width="110" height="22" rx="5" stroke="#ea580c" strokeWidth="1.5" fill="#fff7ed" />
      <text x="10" y="24" fill="#c2410c" fontSize="12" fontFamily="monospace" fontWeight="700">{'{'}P{'}'} c {'{'}Q{'}'}</text>
      <text x="4" y="48" fill="#ea580c" fontSize="9" fontFamily="monospace">precondition → postcondition</text>
    </Mini>
  ),
  Hoare2: () => (
    <Mini>
      <text x="4" y="16" fill="#ea580c" fontSize="10" fontFamily="monospace" fontWeight="600">{'{'}P{'}'} while b do c {'{'}Q{'}'}</text>
      <text x="4" y="32" fill="#c2410c" fontSize="9" fontFamily="monospace">decorated programs</text>
      <text x="4" y="48" fill="#a3a3a3" fontSize="9" fontFamily="monospace">loop invariants</text>
    </Mini>
  ),
  Smallstep: () => (
    <Mini>
      <text x="4" y="16" fill="#7c3aed" fontSize="11" fontFamily="monospace" fontWeight="600">t → t'</text>
      <text x="4" y="32" fill="#6d28d9" fontSize="10" fontFamily="monospace" fontWeight="500">t →* v</text>
      <text x="4" y="48" fill="#a78bfa" fontSize="9" fontFamily="monospace">small-step semantics</text>
    </Mini>
  ),
  Types: () => (
    <Mini>
      <text x="4" y="16" fill="#7c3aed" fontSize="11" fontFamily="monospace" fontWeight="600">⊢ t : T</text>
      <text x="4" y="32" fill="#6d28d9" fontSize="10" fontFamily="monospace" fontWeight="500">progress + preserv.</text>
      <text x="4" y="48" fill="#a78bfa" fontSize="9" fontFamily="monospace">type safety</text>
    </Mini>
  ),
  Stlc: () => (
    <Mini>
      <text x="4" y="18" fill="#7c3aed" fontSize="12" fontFamily="serif" fontWeight="700" fontStyle="italic">λx:T. t</text>
      <text x="4" y="36" fill="#6d28d9" fontSize="10" fontFamily="monospace">Bool → Bool → Bool</text>
      <text x="4" y="50" fill="#a78bfa" fontSize="9" fontFamily="monospace">simply typed λ-calc</text>
    </Mini>
  ),
  StlcProp: () => (
    <Mini>
      <text x="4" y="16" fill="#16a34a" fontSize="10" fontFamily="monospace" fontWeight="600">progress:</text>
      <text x="4" y="30" fill="#15803d" fontSize="9" fontFamily="monospace">⊢ t:T → val t ∨ ∃t'. t→t'</text>
      <text x="4" y="48" fill="#16a34a" fontSize="10" fontFamily="monospace" fontWeight="600">preservation</text>
    </Mini>
  ),
  Sub: () => (
    <Mini>
      <text x="4" y="16" fill="#7c3aed" fontSize="11" fontFamily="monospace" fontWeight="600">S {'<:'} T</text>
      <text x="60" y="16" fill="#6d28d9" fontSize="10" fontFamily="monospace">⊢ t : S</text>
      <line x1="4" y1="22" x2="110" y2="22" stroke="#8b5cf6" strokeWidth="1.5" />
      <text x="30" y="38" fill="#5b21b6" fontSize="11" fontFamily="monospace" fontWeight="700">⊢ t : T</text>
      <text x="4" y="52" fill="#a78bfa" fontSize="9" fontFamily="monospace">subtyping</text>
    </Mini>
  ),
  MoreStlc: () => (
    <Mini>
      <text x="4" y="16" fill="#7c3aed" fontSize="10" fontFamily="monospace" fontWeight="600">let · sum · fix</text>
      <text x="4" y="32" fill="#6d28d9" fontSize="10" fontFamily="monospace" fontWeight="500">pairs · records</text>
      <text x="4" y="48" fill="#a78bfa" fontSize="9" fontFamily="monospace">STLC extensions</text>
    </Mini>
  ),
  References: () => (
    <Mini>
      <text x="4" y="16" fill="#ea580c" fontSize="10" fontFamily="monospace" fontWeight="600">ref · !ℓ · ℓ:=v</text>
      <text x="4" y="32" fill="#c2410c" fontSize="10" fontFamily="monospace" fontWeight="500">Σ | μ ⊢ t : T</text>
      <text x="4" y="48" fill="#a3a3a3" fontSize="9" fontFamily="monospace">mutable state</text>
    </Mini>
  ),

  // === VFA ===
  Perm: () => (
    <Mini>
      <text x="4" y="16" fill="#16a34a" fontSize="10" fontFamily="monospace" fontWeight="600">[3;1;2] ~ [1;2;3]</text>
      <text x="4" y="34" fill="#15803d" fontSize="10" fontFamily="monospace" fontWeight="500">Permutation l l'</text>
      <text x="4" y="48" fill="#a3a3a3" fontSize="9" fontFamily="monospace">permutation proofs</text>
    </Mini>
  ),
  Sort: () => (
    <Mini>
      <text x="4" y="14" fill="#16a34a" fontSize="10" fontFamily="monospace" fontWeight="500">[3,1,4,1,5]</text>
      <text x="68" y="14" fill="#9ca3af" fontSize="10">→</text>
      <text x="78" y="14" fill="#059669" fontSize="10" fontFamily="monospace" fontWeight="700">[1,1,3,4,5]</text>
      <text x="4" y="32" fill="#15803d" fontSize="10" fontFamily="monospace" fontWeight="500">sorted l'</text>
      <text x="4" y="48" fill="#a3a3a3" fontSize="9" fontFamily="monospace">insertion sort</text>
    </Mini>
  ),
  SearchTree: () => (
    <Mini>
      <circle cx="40" cy="10" r="7" stroke="#16a34a" strokeWidth="1.5" fill="#f0fdf4" />
      <text x="37" y="14" fill="#15803d" fontSize="8" fontFamily="monospace" fontWeight="700">5</text>
      <line x1="34" y1="16" x2="20" y2="28" stroke="#22c55e" strokeWidth="1" />
      <line x1="46" y1="16" x2="60" y2="28" stroke="#22c55e" strokeWidth="1" />
      <circle cx="18" cy="32" r="6" stroke="#16a34a" strokeWidth="1" fill="#f0fdf4" />
      <text x="15" y="35" fill="#15803d" fontSize="7" fontFamily="monospace" fontWeight="600">3</text>
      <circle cx="62" cy="32" r="6" stroke="#16a34a" strokeWidth="1" fill="#f0fdf4" />
      <text x="59" y="35" fill="#15803d" fontSize="7" fontFamily="monospace" fontWeight="600">8</text>
      <text x="4" y="52" fill="#a3a3a3" fontSize="9" fontFamily="monospace">BST invariant</text>
    </Mini>
  ),
  Redblack: () => (
    <Mini>
      <circle cx="40" cy="10" r="7" stroke="#111" strokeWidth="1.5" fill="#1f2937" />
      <text x="37" y="14" fill="white" fontSize="8" fontFamily="monospace" fontWeight="700">7</text>
      <line x1="34" y1="16" x2="20" y2="28" stroke="#6b7280" strokeWidth="1" />
      <line x1="46" y1="16" x2="60" y2="28" stroke="#6b7280" strokeWidth="1" />
      <circle cx="18" cy="32" r="6" stroke="#dc2626" strokeWidth="1.5" fill="#fef2f2" />
      <text x="15" y="35" fill="#dc2626" fontSize="7" fontFamily="monospace" fontWeight="700">3</text>
      <circle cx="62" cy="32" r="6" stroke="#dc2626" strokeWidth="1.5" fill="#fef2f2" />
      <text x="59" y="35" fill="#dc2626" fontSize="7" fontFamily="monospace" fontWeight="700">9</text>
      <text x="4" y="52" fill="#a3a3a3" fontSize="9" fontFamily="monospace">red-black tree</text>
    </Mini>
  ),
  Trie: () => (
    <Mini>
      <circle cx="40" cy="8" r="5" stroke="#16a34a" strokeWidth="1" fill="#f0fdf4" />
      <line x1="36" y1="12" x2="20" y2="22" stroke="#22c55e" strokeWidth="1" />
      <line x1="44" y1="12" x2="60" y2="22" stroke="#22c55e" strokeWidth="1" />
      <text x="15" y="20" fill="#9ca3af" fontSize="7" fontFamily="monospace">0</text>
      <text x="55" y="20" fill="#9ca3af" fontSize="7" fontFamily="monospace">1</text>
      <circle cx="18" cy="26" r="4" stroke="#16a34a" strokeWidth="1" fill="#f0fdf4" />
      <circle cx="62" cy="26" r="4" stroke="#16a34a" strokeWidth="1" fill="#f0fdf4" />
      <line x1="15" y1="30" x2="8" y2="38" stroke="#22c55e" strokeWidth="1" />
      <line x1="21" y1="30" x2="28" y2="38" stroke="#22c55e" strokeWidth="1" />
      <circle cx="8" cy="42" r="4" stroke="#16a34a" strokeWidth="1" fill="#dcfce7" />
      <circle cx="28" cy="42" r="4" stroke="#16a34a" strokeWidth="1" fill="#dcfce7" />
      <text x="50" y="48" fill="#a3a3a3" fontSize="9" fontFamily="monospace">binary trie</text>
    </Mini>
  ),
  Binom: () => (
    <Mini>
      <text x="4" y="16" fill="#16a34a" fontSize="10" fontFamily="monospace" fontWeight="600">pri_queue</text>
      <text x="4" y="32" fill="#15803d" fontSize="9" fontFamily="monospace">insert · delete_min</text>
      <text x="4" y="48" fill="#a3a3a3" fontSize="9" fontFamily="monospace">binomial heap</text>
    </Mini>
  ),

  // === SLF ===
  Basic: () => (
    <Mini>
      <text x="4" y="16" fill="#ea580c" fontSize="10" fontFamily="monospace" fontWeight="600">let x = ref 0 in</text>
      <text x="4" y="30" fill="#c2410c" fontSize="10" fontFamily="monospace" fontWeight="600">incr x; !x</text>
      <text x="4" y="48" fill="#a3a3a3" fontSize="9" fontFamily="monospace">heap programs</text>
    </Mini>
  ),
  Triples: () => (
    <Mini>
      <rect x="4" y="6" width="110" height="22" rx="5" stroke="#ea580c" strokeWidth="1.5" fill="#fff7ed" />
      <text x="10" y="22" fill="#c2410c" fontSize="11" fontFamily="monospace" fontWeight="700">{'{'}H{'}'} t {'{'}Q{'}'}</text>
      <text x="4" y="48" fill="#a3a3a3" fontSize="9" fontFamily="monospace">Hoare triples for heaps</text>
    </Mini>
  ),
  Rules: () => (
    <Mini>
      <text x="4" y="16" fill="#ea580c" fontSize="10" fontFamily="monospace" fontWeight="600">triple_seq</text>
      <text x="4" y="30" fill="#c2410c" fontSize="10" fontFamily="monospace" fontWeight="600">triple_if</text>
      <text x="4" y="44" fill="#ea580c" fontSize="10" fontFamily="monospace" fontWeight="600">triple_while</text>
    </Mini>
  ),

  // === SecF ===
  Noninterference: () => (
    <Mini>
      <text x="4" y="16" fill="#dc2626" fontSize="10" fontFamily="monospace" fontWeight="600">s₁ ≈_L s₂ →</text>
      <text x="4" y="30" fill="#b91c1c" fontSize="10" fontFamily="monospace" fontWeight="600">exec c s₁ ≈_L</text>
      <text x="4" y="44" fill="#b91c1c" fontSize="10" fontFamily="monospace" fontWeight="600">exec c s₂</text>
    </Mini>
  ),
  StaticIFC: () => (
    <Mini>
      <text x="4" y="16" fill="#dc2626" fontSize="10" fontFamily="monospace" fontWeight="600">Γ ⊢ c : pc</text>
      <text x="4" y="32" fill="#b91c1c" fontSize="9" fontFamily="monospace">security typing</text>
      <text x="4" y="48" fill="#a3a3a3" fontSize="9" fontFamily="monospace">information flow</text>
    </Mini>
  ),
};

/** Get chapter illustration by name. Returns null if none exists. */
export function getChapterIllustration(name: string): (() => React.JSX.Element) | null {
  return chapters[name] || null;
}
