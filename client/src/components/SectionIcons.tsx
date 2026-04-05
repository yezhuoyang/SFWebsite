import React from 'react';
/**
 * Small thematic SVG icons for chapter section headings.
 * Maps common PL topic keywords to visual icons.
 */

const S = 22; // icon size

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width={S} height={S} viewBox="0 0 22 22" fill="none" className="shrink-0 inline-block mr-2 -mt-0.5">
      {children}
    </svg>
  );
}

const icons: Record<string, () => React.JSX.Element> = {
  // Data & types
  'types': () => <Icon><text x="2" y="17" fill="#8b5cf6" fontSize="14" fontFamily="serif" fontWeight="bold">τ</text></Icon>,
  'data': () => <Icon><rect x="3" y="3" width="16" height="16" rx="3" stroke="#3b82f6" strokeWidth="1.5" fill="#eff6ff" /><text x="6" y="16" fill="#2563eb" fontSize="11" fontFamily="monospace" fontWeight="bold">{ }</text></Icon>,
  'enumerat': () => <Icon><circle cx="6" cy="7" r="3" fill="#3b82f6" /><circle cx="6" cy="15" r="3" fill="#60a5fa" /><line x1="12" y1="7" x2="20" y2="7" stroke="#3b82f6" strokeWidth="1.5" /><line x1="12" y1="15" x2="20" y2="15" stroke="#60a5fa" strokeWidth="1.5" /></Icon>,

  // Booleans & logic
  'boolean': () => <Icon><text x="1" y="16" fill="#16a34a" fontSize="13" fontFamily="monospace" fontWeight="bold">⊤⊥</text></Icon>,
  'logic': () => <Icon><text x="2" y="17" fill="#7c3aed" fontSize="16" fontFamily="serif" fontWeight="bold">∧</text></Icon>,

  // Numbers & arithmetic
  'number': () => <Icon><text x="1" y="17" fill="#0891b2" fontSize="14" fontFamily="monospace" fontWeight="bold">ℕ</text></Icon>,
  'nat': () => <Icon><text x="1" y="17" fill="#0891b2" fontSize="14" fontFamily="monospace" fontWeight="bold">ℕ</text></Icon>,

  // Functions
  'function': () => <Icon><text x="2" y="17" fill="#7c3aed" fontSize="15" fontFamily="serif" fontStyle="italic" fontWeight="bold">λ</text></Icon>,

  // Proof
  'proof': () => <Icon><text x="2" y="17" fill="#ea580c" fontSize="14" fontFamily="serif" fontWeight="bold">∎</text></Icon>,
  'simplif': () => <Icon><text x="1" y="16" fill="#ea580c" fontSize="12" fontFamily="monospace" fontWeight="bold">≡</text></Icon>,
  'rewrite': () => <Icon><text x="1" y="16" fill="#ea580c" fontSize="14" fontFamily="monospace" fontWeight="bold">⇝</text></Icon>,
  'case': () => <Icon><text x="2" y="16" fill="#ea580c" fontSize="12" fontFamily="monospace" fontWeight="bold">⋮│</text></Icon>,

  // Induction
  'induction': () => <Icon><text x="0" y="17" fill="#dc2626" fontSize="13" fontFamily="serif" fontWeight="bold">∀n</text></Icon>,

  // Lists & polymorphism
  'list': () => <Icon><text x="0" y="16" fill="#0891b2" fontSize="11" fontFamily="monospace" fontWeight="bold">[;;]</text></Icon>,
  'poly': () => <Icon><text x="2" y="17" fill="#7c3aed" fontSize="15" fontFamily="serif" fontStyle="italic" fontWeight="bold">∀α</text></Icon>,

  // Tactics
  'tactic': () => <Icon><text x="2" y="16" fill="#16a34a" fontSize="13" fontFamily="monospace" fontWeight="bold">⊢</text></Icon>,

  // Maps & trees
  'map': () => <Icon><text x="0" y="16" fill="#16a34a" fontSize="11" fontFamily="monospace" fontWeight="bold">k↦v</text></Icon>,
  'tree': () => <Icon><circle cx="11" cy="5" r="3" fill="#16a34a" /><line x1="9" y1="8" x2="5" y2="14" stroke="#16a34a" strokeWidth="1.5" /><line x1="13" y1="8" x2="17" y2="14" stroke="#16a34a" strokeWidth="1.5" /><circle cx="5" cy="16" r="2.5" fill="#22c55e" /><circle cx="17" cy="16" r="2.5" fill="#22c55e" /></Icon>,

  // Tuples & pairs
  'tuple': () => <Icon><text x="0" y="16" fill="#0891b2" fontSize="12" fontFamily="monospace" fontWeight="bold">(,)</text></Icon>,
  'pair': () => <Icon><text x="0" y="16" fill="#0891b2" fontSize="12" fontFamily="monospace" fontWeight="bold">(,)</text></Icon>,

  // Modules
  'module': () => <Icon><rect x="2" y="2" width="18" height="18" rx="3" stroke="#6b7280" strokeWidth="1.5" fill="#f9fafb" /><line x1="2" y1="8" x2="20" y2="8" stroke="#6b7280" strokeWidth="1" /><text x="5" y="17" fill="#6b7280" fontSize="8" fontFamily="monospace" fontWeight="bold">M</text></Icon>,

  // Relations & Props
  'relation': () => <Icon><text x="0" y="16" fill="#7c3aed" fontSize="14" fontFamily="serif" fontWeight="bold">R</text></Icon>,
  'prop': () => <Icon><text x="2" y="17" fill="#7c3aed" fontSize="15" fontFamily="serif" fontWeight="bold">P</text></Icon>,

  // Imp / programs
  'imp': () => <Icon><text x="0" y="16" fill="#dc2626" fontSize="11" fontFamily="monospace" fontWeight="bold">:=;</text></Icon>,
  'program': () => <Icon><text x="0" y="16" fill="#dc2626" fontSize="11" fontFamily="monospace" fontWeight="bold">:=;</text></Icon>,

  // Hoare
  'hoare': () => <Icon><text x="0" y="16" fill="#ea580c" fontSize="11" fontFamily="monospace" fontWeight="bold">{'{'}P{'}'}</text></Icon>,

  // Intro / general
  'intro': () => <Icon><text x="2" y="17" fill="#6366f1" fontSize="15" fontFamily="serif" fontStyle="italic">i</text></Icon>,
  'homework': () => <Icon><text x="2" y="16" fill="#f59e0b" fontSize="14">✎</text></Icon>,
  'identif': () => <Icon><text x="1" y="16" fill="#6366f1" fontSize="12" fontFamily="monospace" fontWeight="bold">id</text></Icon>,

  // Sorting
  'sort': () => <Icon><text x="0" y="10" fill="#16a34a" fontSize="8" fontFamily="monospace">3 1</text><text x="0" y="19" fill="#059669" fontSize="8" fontFamily="monospace">1 3</text><path d="M16,4 L16,18" stroke="#16a34a" strokeWidth="1" /><path d="M14,16 L16,19 L18,16" fill="#16a34a" /></Icon>,

  // Security
  'security': () => <Icon><text x="2" y="16" fill="#dc2626" fontSize="14">🔒</text></Icon>,
  'noninter': () => <Icon><text x="1" y="16" fill="#dc2626" fontSize="12" fontFamily="monospace" fontWeight="bold">≈_L</text></Icon>,

  // Separation logic
  'heap': () => <Icon><rect x="2" y="6" width="8" height="10" rx="2" stroke="#ea580c" strokeWidth="1.5" fill="#fff7ed" /><line x1="10" y1="11" x2="18" y2="11" stroke="#ea580c" strokeWidth="1.5" /><rect x="12" y="6" width="8" height="10" rx="2" stroke="#ea580c" strokeWidth="1.5" fill="#fff7ed" /></Icon>,
  'separat': () => <Icon><text x="3" y="17" fill="#ea580c" fontSize="16" fontWeight="bold">★</text></Icon>,
};

/** Get a section icon based on the section title. */
export function getSectionIcon(title: string): (() => React.JSX.Element) | null {
  const lower = title.toLowerCase();
  for (const [keyword, icon] of Object.entries(icons)) {
    if (lower.includes(keyword)) return icon;
  }
  return null;
}
