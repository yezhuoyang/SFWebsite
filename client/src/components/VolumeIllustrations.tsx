import React from 'react';
/**
 * Thematic SVG illustrations for each SF volume.
 * Designed for light background, bold readable colors.
 */

/** LF: Natural deduction proof tree */
export function LFIllustration() {
  return (
    <svg width="320" height="180" viewBox="0 0 320 180" fill="none">
      {/* Top premises */}
      <text x="30" y="30" fill="#2563eb" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="600">[x : P]</text>
      <text x="140" y="30" fill="#2563eb" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="600">P → Q</text>

      {/* First inference line */}
      <line x1="20" y1="40" x2="230" y2="40" stroke="#3b82f6" strokeWidth="2.5" />
      <text x="238" y="38" fill="#60a5fa" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="600">→E</text>

      {/* Middle */}
      <text x="100" y="62" fill="#1d4ed8" fontSize="15" fontFamily="JetBrains Mono, monospace" fontWeight="700">Q</text>
      <text x="220" y="62" fill="#2563eb" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="600">Q → R</text>

      {/* Second inference line */}
      <line x1="80" y1="72" x2="300" y2="72" stroke="#3b82f6" strokeWidth="2.5" />
      <text x="305" y="70" fill="#60a5fa" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="600">→E</text>

      <text x="160" y="95" fill="#1d4ed8" fontSize="15" fontFamily="JetBrains Mono, monospace" fontWeight="700">R</text>

      {/* Discharge line */}
      <line x1="110" y1="105" x2="240" y2="105" stroke="#3b82f6" strokeWidth="2.5" />
      <text x="248" y="103" fill="#60a5fa" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="600">→I¹</text>

      {/* Final conclusion */}
      <rect x="120" y="113" width="100" height="28" rx="6" fill="#eff6ff" stroke="#3b82f6" strokeWidth="1.5" />
      <text x="135" y="132" fill="#1e40af" fontSize="16" fontFamily="JetBrains Mono, monospace" fontWeight="800">P → R</text>

      {/* Induction axiom faded */}
      <text x="15" y="168" fill="#93c5fd" fontSize="10" fontFamily="JetBrains Mono, monospace">∀n. P(0) → (∀k. P(k)→P(S k)) → P(n)</text>
    </svg>
  );
}

/** PLF: Lambda calculus typing + reduction */
export function PLFIllustration() {
  return (
    <svg width="320" height="180" viewBox="0 0 320 180" fill="none">
      {/* Typing rule */}
      <text x="20" y="28" fill="#7c3aed" fontSize="13" fontFamily="JetBrains Mono, monospace" fontWeight="600">Γ, x:T₁ ⊢ t₂ : T₂</text>
      <line x1="15" y1="38" x2="260" y2="38" stroke="#8b5cf6" strokeWidth="2.5" />
      <text x="268" y="36" fill="#a78bfa" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="600">T-Abs</text>

      <rect x="15" y="46" width="260" height="26" rx="6" fill="#f5f3ff" stroke="#8b5cf6" strokeWidth="1.5" />
      <text x="22" y="64" fill="#5b21b6" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="700">Γ ⊢ λx:T₁. t₂ : T₁→T₂</text>

      {/* Small-step rule */}
      <text x="20" y="105" fill="#7c3aed" fontSize="13" fontFamily="JetBrains Mono, monospace" fontWeight="600">t₁ → t₁'</text>
      <line x1="15" y1="115" x2="230" y2="115" stroke="#8b5cf6" strokeWidth="2.5" />
      <text x="238" y="113" fill="#a78bfa" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="600">ST-App1</text>

      <text x="20" y="137" fill="#5b21b6" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="700">t₁ t₂ → t₁' t₂</text>

      {/* Beta reduction example */}
      <text x="15" y="170" fill="#c4b5fd" fontSize="10" fontFamily="JetBrains Mono, monospace">(λx:Bool. if x then 0 else 1) true →* 0</text>
    </svg>
  );
}

/** VFA: Binary search tree */
export function VFAIllustration() {
  return (
    <svg width="320" height="180" viewBox="0 0 320 180" fill="none">
      {/* Root: 5 */}
      <circle cx="160" cy="30" r="18" stroke="#16a34a" strokeWidth="2.5" fill="#f0fdf4" />
      <text x="153" y="36" fill="#15803d" fontSize="16" fontFamily="JetBrains Mono, monospace" fontWeight="800">5</text>

      {/* Left: 3 */}
      <line x1="145" y1="44" x2="90" y2="68" stroke="#22c55e" strokeWidth="2" />
      <circle cx="80" cy="75" r="16" stroke="#16a34a" strokeWidth="2" fill="#f0fdf4" />
      <text x="74" y="81" fill="#15803d" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="700">3</text>

      {/* Right: 8 */}
      <line x1="175" y1="44" x2="230" y2="68" stroke="#22c55e" strokeWidth="2" />
      <circle cx="240" cy="75" r="16" stroke="#16a34a" strokeWidth="2" fill="#f0fdf4" />
      <text x="234" y="81" fill="#15803d" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="700">8</text>

      {/* LL: 1 */}
      <line x1="67" y1="88" x2="40" y2="108" stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />
      <circle cx="35" cy="115" r="14" stroke="#16a34a" strokeWidth="1.5" fill="#f0fdf4" opacity="0.8" />
      <text x="30" y="120" fill="#15803d" fontSize="13" fontFamily="JetBrains Mono, monospace" fontWeight="600">1</text>

      {/* LR: 4 */}
      <line x1="93" y1="88" x2="120" y2="108" stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />
      <circle cx="125" cy="115" r="14" stroke="#16a34a" strokeWidth="1.5" fill="#f0fdf4" opacity="0.8" />
      <text x="120" y="120" fill="#15803d" fontSize="13" fontFamily="JetBrains Mono, monospace" fontWeight="600">4</text>

      {/* RL: 7 */}
      <line x1="227" y1="88" x2="200" y2="108" stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />
      <circle cx="195" cy="115" r="14" stroke="#16a34a" strokeWidth="1.5" fill="#f0fdf4" opacity="0.8" />
      <text x="190" y="120" fill="#15803d" fontSize="13" fontFamily="JetBrains Mono, monospace" fontWeight="600">7</text>

      {/* RR: 9 */}
      <line x1="253" y1="88" x2="280" y2="108" stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />
      <circle cx="285" cy="115" r="14" stroke="#16a34a" strokeWidth="1.5" fill="#f0fdf4" opacity="0.8" />
      <text x="280" y="120" fill="#15803d" fontSize="13" fontFamily="JetBrains Mono, monospace" fontWeight="600">9</text>

      {/* Invariant */}
      <rect x="40" y="145" width="250" height="22" rx="5" fill="#f0fdf4" stroke="#86efac" strokeWidth="1" />
      <text x="52" y="161" fill="#166534" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="500">BST t → lookup k (insert k v t) = v</text>
    </svg>
  );
}

/** SLF: Heap cells with separation logic */
export function SLFIllustration() {
  return (
    <svg width="320" height="180" viewBox="0 0 320 180" fill="none">
      <defs>
        <marker id="ptrArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#ea580c" />
        </marker>
      </defs>

      {/* Heap cell 1 */}
      <rect x="15" y="18" width="65" height="40" rx="6" stroke="#ea580c" strokeWidth="2.5" fill="#fff7ed" />
      <text x="30" y="44" fill="#c2410c" fontSize="16" fontFamily="JetBrains Mono, monospace" fontWeight="800">42</text>
      <text x="18" y="12" fill="#9a3412" fontSize="10" fontFamily="JetBrains Mono, monospace" fontWeight="600">ℓ₁</text>

      {/* Arrow */}
      <line x1="80" y1="38" x2="108" y2="38" stroke="#ea580c" strokeWidth="2" markerEnd="url(#ptrArrow)" />

      {/* Heap cell 2 */}
      <rect x="115" y="18" width="65" height="40" rx="6" stroke="#ea580c" strokeWidth="2.5" fill="#fff7ed" />
      <text x="122" y="44" fill="#c2410c" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="700">nil</text>
      <text x="118" y="12" fill="#9a3412" fontSize="10" fontFamily="JetBrains Mono, monospace" fontWeight="600">ℓ₂</text>

      {/* Star separator */}
      <text x="195" y="45" fill="#ea580c" fontSize="26" fontWeight="bold" opacity="0.7">★</text>

      {/* Heap cell 3 */}
      <rect x="230" y="18" width="65" height="40" rx="6" stroke="#ea580c" strokeWidth="2.5" fill="#fff7ed" />
      <text x="251" y="44" fill="#c2410c" fontSize="16" fontFamily="JetBrains Mono, monospace" fontWeight="800">7</text>
      <text x="233" y="12" fill="#9a3412" fontSize="10" fontFamily="JetBrains Mono, monospace" fontWeight="600">ℓ₃</text>

      {/* Formula */}
      <rect x="15" y="75" width="290" height="28" rx="6" fill="#fff7ed" stroke="#fdba74" strokeWidth="1.5" />
      <text x="25" y="94" fill="#9a3412" fontSize="13" fontFamily="JetBrains Mono, monospace" fontWeight="600">
        ℓ₁ ↦ 42  ∗  ℓ₂ ↦ nil  ∗  ℓ₃ ↦ 7
      </text>

      {/* Hoare triple */}
      <text x="15" y="130" fill="#c2410c" fontSize="12" fontFamily="JetBrains Mono, monospace" fontWeight="600">
        {'{'} ℓ ↦ n {'}'}  (ℓ := n+1)  {'{'} ℓ ↦ n+1 {'}'}
      </text>

      {/* Frame rule faded */}
      <text x="15" y="165" fill="#fdba74" fontSize="10" fontFamily="JetBrains Mono, monospace">
        H₁ ⊥ H₂ → (P ∗ Q)(H₁ ∪ H₂)
      </text>
    </svg>
  );
}

/** SecF: Security lattice + information flow */
export function SecFIllustration() {
  return (
    <svg width="320" height="180" viewBox="0 0 320 180" fill="none">
      <defs>
        <marker id="flowArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#6b7280" />
        </marker>
        <marker id="okArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#16a34a" />
        </marker>
      </defs>

      {/* High box */}
      <rect x="110" y="10" width="90" height="34" rx="8" stroke="#dc2626" strokeWidth="2.5" fill="#fef2f2" />
      <text x="128" y="33" fill="#b91c1c" fontSize="16" fontFamily="JetBrains Mono, monospace" fontWeight="800">High</text>

      {/* Low box */}
      <rect x="110" y="100" width="90" height="34" rx="8" stroke="#16a34a" strokeWidth="2.5" fill="#f0fdf4" />
      <text x="132" y="123" fill="#15803d" fontSize="16" fontFamily="JetBrains Mono, monospace" fontWeight="800">Low</text>

      {/* Lattice arrow Low ⊑ High */}
      <line x1="155" y1="98" x2="155" y2="48" stroke="#6b7280" strokeWidth="2" strokeDasharray="5,4" markerEnd="url(#flowArrow)" />
      <text x="163" y="78" fill="#6b7280" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="700">⊑</text>

      {/* Forbidden flow: High → Low */}
      <g>
        <text x="225" y="30" fill="#dc2626" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="700">H</text>
        <line x1="245" y1="26" x2="282" y2="26" stroke="#dc2626" strokeWidth="2" />
        <text x="290" y="30" fill="#16a34a" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="700">L</text>
        {/* Big X */}
        <line x1="250" y1="14" x2="278" y2="38" stroke="#dc2626" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="278" y1="14" x2="250" y2="38" stroke="#dc2626" strokeWidth="3.5" strokeLinecap="round" />
      </g>

      {/* Allowed flow: Low → High */}
      <g>
        <text x="225" y="82" fill="#16a34a" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="700">L</text>
        <line x1="242" y1="78" x2="279" y2="78" stroke="#16a34a" strokeWidth="2" markerEnd="url(#okArrow)" />
        <text x="290" y="82" fill="#dc2626" fontSize="14" fontFamily="JetBrains Mono, monospace" fontWeight="700">H</text>
        <text x="255" y="98" fill="#16a34a" fontSize="16" fontWeight="bold">✓</text>
      </g>

      {/* Noninterference theorem */}
      <rect x="15" y="148" width="295" height="24" rx="5" fill="#fef2f2" stroke="#fca5a5" strokeWidth="1" />
      <text x="22" y="165" fill="#991b1b" fontSize="10" fontFamily="JetBrains Mono, monospace" fontWeight="500">
        s₁ ≈_L s₂ → ⟨c,s₁⟩⇓s₁' → ⟨c,s₂⟩⇓s₂' → s₁' ≈_L s₂'
      </text>
    </svg>
  );
}

/** Main SF logo — lambda in a proof tree */
export function SFLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="10" fill="url(#logoGrad)" />
      <text x="10" y="30" fill="white" fontSize="26" fontFamily="serif" fontWeight="bold" fontStyle="italic">λ</text>
      <line x1="6" y1="14" x2="34" y2="14" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export const VOLUME_ILLUSTRATIONS: Record<string, () => React.JSX.Element> = {
  lf: LFIllustration,
  plf: PLFIllustration,
  vfa: VFAIllustration,
  slf: SLFIllustration,
  secf: SecFIllustration,
};
