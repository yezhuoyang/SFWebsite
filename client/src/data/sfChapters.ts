/**
 * Per-volume chapter list, in pedagogical order.
 *
 * Source: coq.vercel.app's `/ext/sf/<vol>/full/toc.html`. We bake them in
 * here so the TOC sidebar works without depending on the FastAPI server.
 *
 * `slug` is the chapter URL component (matches the SF book's filename
 * minus `.html`). `title` is the human-readable display string.
 */

export interface ChapterEntry {
  slug: string;
  title: string;
}

export const SF_CHAPTERS: Record<string, ChapterEntry[]> = {
  lf: [
    { slug: 'Preface', title: 'Preface' },
    { slug: 'Basics', title: 'Basics — Functional Programming' },
    { slug: 'Induction', title: 'Induction — Proof by Induction' },
    { slug: 'Lists', title: 'Lists — Working with Structured Data' },
    { slug: 'Poly', title: 'Poly — Polymorphism & Higher-Order Functions' },
    { slug: 'Tactics', title: 'Tactics — More Basic Tactics' },
    { slug: 'Logic', title: 'Logic — Logic in Coq' },
    { slug: 'IndProp', title: 'IndProp — Inductively Defined Propositions' },
    { slug: 'Maps', title: 'Maps — Total and Partial Maps' },
    { slug: 'ProofObjects', title: 'ProofObjects — Curry-Howard' },
    { slug: 'IndPrinciples', title: 'IndPrinciples — Induction Principles' },
    { slug: 'Rel', title: 'Rel — Properties of Relations' },
    { slug: 'Imp', title: 'Imp — Simple Imperative Programs' },
    { slug: 'ImpParser', title: 'ImpParser — Lexing and Parsing' },
    { slug: 'ImpCEvalFun', title: 'ImpCEvalFun — Evaluation Function for Imp' },
    { slug: 'Extraction', title: 'Extraction — Extracting OCaml from Coq' },
    { slug: 'Auto', title: 'Auto — More Automation' },
    { slug: 'AltAuto', title: 'AltAuto — Streamlined Automation' },
    { slug: 'Postscript', title: 'Postscript' },
    { slug: 'Bib', title: 'Bibliography' },
  ],
  plf: [
    { slug: 'Preface', title: 'Preface' },
    { slug: 'Equiv', title: 'Equiv — Program Equivalence' },
    { slug: 'Hoare', title: 'Hoare — Hoare Logic, Part I' },
    { slug: 'Hoare2', title: 'Hoare2 — Hoare Logic, Part II' },
    { slug: 'HoareAsLogic', title: 'HoareAsLogic — Hoare Logic as a Logic' },
    { slug: 'Smallstep', title: 'Smallstep — Small-step Operational Semantics' },
    { slug: 'Types', title: 'Types — Type Systems' },
    { slug: 'Stlc', title: 'Stlc — Simply Typed Lambda-Calculus' },
    { slug: 'StlcProp', title: 'StlcProp — Properties of STLC' },
    { slug: 'MoreStlc', title: 'MoreStlc — More on STLC' },
    { slug: 'Sub', title: 'Sub — Subtyping' },
    { slug: 'Typechecking', title: 'Typechecking — A Typechecker for STLC' },
    { slug: 'Records', title: 'Records — Adding Records to STLC' },
    { slug: 'References', title: 'References — Typing Mutable References' },
    { slug: 'RecordSub', title: 'RecordSub — Subtyping with Records' },
    { slug: 'Norm', title: 'Norm — Normalization of STLC' },
    { slug: 'PE', title: 'PE — Partial Evaluation' },
    { slug: 'Postscript', title: 'Postscript' },
    { slug: 'Bib', title: 'Bibliography' },
    { slug: 'LibTactics', title: 'LibTactics — General-Purpose Tactics' },
    { slug: 'UseTactics', title: 'UseTactics — Tactic Library Intro' },
    { slug: 'UseAuto', title: 'UseAuto — Automation in Coq Proofs' },
  ],
  vfa: [
    { slug: 'Preface', title: 'Preface' },
    { slug: 'Perm', title: 'Perm — Comparisons & Permutations' },
    { slug: 'Sort', title: 'Sort — Insertion Sort' },
    { slug: 'Multiset', title: 'Multiset — Insertion Sort with Multisets' },
    { slug: 'BagPerm', title: 'BagPerm — Insertion Sort with Bags' },
    { slug: 'Selection', title: 'Selection — Selection Sort' },
    { slug: 'Merge', title: 'Merge — Merge Sort' },
    { slug: 'Maps', title: 'Maps — Total and Partial Maps' },
    { slug: 'SearchTree', title: 'SearchTree — Binary Search Trees' },
    { slug: 'ADT', title: 'ADT — Abstract Data Types' },
    { slug: 'Extract', title: 'Extract — Running Coq in OCaml' },
    { slug: 'Redblack', title: 'Redblack — Red-Black Trees' },
    { slug: 'Trie', title: 'Trie — Number Reps & Lookup Tables' },
    { slug: 'Priqueue', title: 'Priqueue — Priority Queues' },
    { slug: 'Binom', title: 'Binom — Binomial Queues' },
    { slug: 'Decide', title: 'Decide — Decision Procedures' },
    { slug: 'Color', title: 'Color — Graph Coloring' },
  ],
  slf: [
    { slug: 'Preface', title: 'Preface' },
    { slug: 'Basic', title: 'Basic — Basic Proofs in Separation Logic' },
    { slug: 'Repr', title: 'Repr — Representation Predicates' },
    { slug: 'Hprop', title: 'Hprop — Heap Predicates' },
    { slug: 'Himpl', title: 'Himpl — Heap Entailment' },
    { slug: 'Rules', title: 'Rules — Reasoning Rules' },
    { slug: 'WPsem', title: 'WPsem — Semantics of WP' },
    { slug: 'WPgen', title: 'WPgen — WP Generator' },
    { slug: 'Wand', title: 'Wand — Magic Wand Operator' },
    { slug: 'Affine', title: 'Affine — Affine Separation Logic' },
    { slug: 'Struct', title: 'Struct — Arrays and Records' },
    { slug: 'Rich', title: 'Rich — Loops, N-ary Functions' },
    { slug: 'Nondet', title: 'Nondet — Nondeterministic Languages' },
    { slug: 'Partial', title: 'Partial — Triples for Partial Correctness' },
    { slug: 'Postscript', title: 'Postscript' },
    { slug: 'Bib', title: 'Bibliography' },
  ],
};

export function getChapter(volumeId: string, slug: string): ChapterEntry | undefined {
  return SF_CHAPTERS[volumeId]?.find(c => c.slug === slug);
}
