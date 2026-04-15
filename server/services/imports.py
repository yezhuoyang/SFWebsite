"""Resolve `From X Require Import Y` declarations into a list of identifiers
the user can reference in this chapter.

Two sources:
  1. Same-volume sibling chapters (e.g. LF/Maps when working in LF/Imp).
     Auto-extracted by parsing the imported .v file's top-level vernaculars.
  2. Coq standard library modules. Curated catalog of identifiers we
     hand-picked for the modules SF chapters actually use. Not exhaustive
     — focused on what students commonly need to recall.

Returns a flat list keyed by source module so the UI can group / attribute.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from server.config import VOLUMES


@dataclass
class ImportedEntry:
    kind: str           # "Definition" | "Theorem" | "Lemma" | "Inductive" | "Notation" | ...
    name: str
    signature: str      # First line / type signature for hover detail
    module: str         # Source module, e.g. "PLF.Maps" or "Coq.Bool.Bool"
    chapter_name: str | None = None  # Set if it came from a SF chapter (so UI can link)
    import_line: int = 0  # 0-indexed line in this chapter's source where the
                          # `From X Require Import Y` appears. Used by the
                          # client to gate visibility on what's been executed.


# Regex set mirrors ContextPanel's parser, tuned for *.v source files.
# Each line below extracts (kind, name, signature_first_line).
_VERNAC_RE = re.compile(
    r'^\s*(Theorem|Lemma|Fact|Remark|Corollary|Proposition|'
    r'Definition|Fixpoint|CoFixpoint|Function|Let|'
    r'Inductive|CoInductive|Variant|Record|Structure|Class|Instance|'
    r'Example|Notation|Module|Axiom|Hypothesis)\b'
)
_NAME_RE = re.compile(
    r'^\s*\w+(?:\s+(?:Local|Global|Polymorphic))?\s+([A-Za-z_][\w\']*)'
)
_NOTATION_NAME_RE = re.compile(r'^\s*Notation\s+"([^"]+)"')


def _extract_v_definitions(v_file: Path, module: str, chapter_name: str | None, import_line: int) -> list[ImportedEntry]:
    """Best-effort scan of a .v file for top-level vernacular declarations."""
    if not v_file.exists():
        return []
    try:
        text = v_file.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []

    # Strip block comments (* ... *) — handle nesting roughly so we don't get
    # tripped by exercise headers that contain colon-equals etc.
    text = _strip_comments(text)

    out: list[ImportedEntry] = []
    seen = set()
    for line in text.split("\n"):
        kind_match = _VERNAC_RE.match(line)
        if not kind_match:
            continue
        kind = kind_match.group(1)
        if kind == "Notation":
            m = _NOTATION_NAME_RE.match(line)
            name = m.group(1) if m else None
        else:
            m = _NAME_RE.match(line)
            name = m.group(1) if m else None
        if not name:
            continue
        key = (kind, name)
        if key in seen:
            continue
        seen.add(key)
        sig = line.strip()
        if len(sig) > 200:
            sig = sig[:197] + "…"
        out.append(ImportedEntry(
            kind=kind, name=name, signature=sig, module=module,
            chapter_name=chapter_name, import_line=import_line,
        ))
    return out


def _strip_comments(text: str) -> str:
    """Drop `(* ... *)` blocks (with simple nesting) so vernac regexes don't match
    things mentioned in the docstrings."""
    out: list[str] = []
    depth = 0
    i = 0
    n = len(text)
    while i < n:
        if depth == 0 and text[i] == '(' and i + 1 < n and text[i + 1] == '*':
            depth = 1
            i += 2
            continue
        if depth > 0:
            if text[i] == '(' and i + 1 < n and text[i + 1] == '*':
                depth += 1
                i += 2
                continue
            if text[i] == '*' and i + 1 < n and text[i + 1] == ')':
                depth -= 1
                i += 2
                continue
            i += 1
            continue
        out.append(text[i])
        i += 1
    return ''.join(out)


# ---------------------------------------------------------------------------
# Curated Coq stdlib catalog (the modules SF actually uses)
# ---------------------------------------------------------------------------

_STDLIB: dict[str, list[tuple[str, str, str]]] = {
    "Coq.Bool.Bool": [
        ("Inductive", "bool", "Inductive bool : Set := true | false"),
        ("Definition", "andb", "andb (b1 b2 : bool) : bool"),
        ("Definition", "orb", "orb (b1 b2 : bool) : bool"),
        ("Definition", "negb", "negb (b : bool) : bool"),
        ("Definition", "xorb", "xorb (b1 b2 : bool) : bool"),
        ("Definition", "implb", "implb (b1 b2 : bool) : bool"),
        ("Definition", "eqb", "eqb (b1 b2 : bool) : bool"),
        ("Notation", "&&", "b1 && b2 := andb b1 b2"),
        ("Notation", "||", "b1 || b2 := orb b1 b2"),
        ("Theorem", "andb_true_iff", "forall b1 b2, b1 && b2 = true <-> b1 = true /\\ b2 = true"),
        ("Theorem", "orb_true_iff",  "forall b1 b2, b1 || b2 = true <-> b1 = true \\/ b2 = true"),
        ("Theorem", "negb_involutive", "forall b, negb (negb b) = b"),
    ],
    "Coq.Init.Nat": [
        ("Inductive", "nat", "Inductive nat : Set := O | S (n : nat)"),
        ("Definition", "Nat.add", "Nat.add (n m : nat) : nat"),
        ("Definition", "Nat.sub", "Nat.sub (n m : nat) : nat"),
        ("Definition", "Nat.mul", "Nat.mul (n m : nat) : nat"),
        ("Definition", "Nat.eqb", "Nat.eqb (n m : nat) : bool"),
        ("Definition", "Nat.leb", "Nat.leb (n m : nat) : bool"),
        ("Definition", "Nat.ltb", "Nat.ltb (n m : nat) : bool"),
        ("Definition", "Nat.min", "Nat.min (n m : nat) : nat"),
        ("Definition", "Nat.max", "Nat.max (n m : nat) : nat"),
        ("Definition", "Nat.pred", "Nat.pred (n : nat) : nat"),
        ("Notation", "+", "n + m := Nat.add n m"),
        ("Notation", "-", "n - m := Nat.sub n m"),
        ("Notation", "*", "n * m := Nat.mul n m"),
        ("Notation", "=?", "n =? m := Nat.eqb n m"),
        ("Notation", "<=?", "n <=? m := Nat.leb n m"),
    ],
    "Coq.Arith.PeanoNat": [
        ("Theorem", "Nat.add_0_r",   "forall n, n + 0 = n"),
        ("Theorem", "Nat.add_comm",  "forall n m, n + m = m + n"),
        ("Theorem", "Nat.add_assoc", "forall n m p, n + (m + p) = (n + m) + p"),
        ("Theorem", "Nat.mul_comm",  "forall n m, n * m = m * n"),
        ("Theorem", "Nat.mul_assoc", "forall n m p, n * (m * p) = (n * m) * p"),
        ("Theorem", "Nat.eqb_refl",  "forall n, (n =? n) = true"),
        ("Theorem", "Nat.eqb_eq",    "forall n m, (n =? m) = true <-> n = m"),
        ("Theorem", "Nat.leb_le",    "forall n m, (n <=? m) = true <-> n <= m"),
        ("Theorem", "Nat.lt_irrefl", "forall n, ~ n < n"),
    ],
    "Coq.Arith.EqNat": [
        ("Theorem", "beq_nat_true",  "forall n m, beq_nat n m = true -> n = m"),
        ("Theorem", "beq_nat_refl",  "forall n, beq_nat n n = true"),
    ],
    "Coq.Arith.Lia": [
        ("Tactic",  "lia",  "lia                    -- linear integer arithmetic"),
        ("Tactic",  "nia",  "nia                    -- nonlinear integer arithmetic"),
    ],
    "Coq.Arith.Arith": [
        ("Tactic",  "ring", "ring                   -- normalize commutative ring expressions"),
    ],
    "Coq.Lists.List": [
        ("Inductive", "list", "Inductive list (A : Type) := nil | cons (x : A) (l : list A)"),
        ("Notation",  "::", "x :: l := cons x l"),
        ("Notation",  "++", "l ++ l' := app l l'"),
        ("Notation",  "[]", "[] := nil"),
        ("Definition","app",      "app (l m : list A) : list A"),
        ("Definition","length",   "length (l : list A) : nat"),
        ("Definition","rev",      "rev (l : list A) : list A"),
        ("Definition","map",      "map (f : A -> B) (l : list A) : list B"),
        ("Definition","fold_left",  "fold_left (f : B -> A -> B) (l : list A) (b : B) : B"),
        ("Definition","fold_right", "fold_right (f : A -> B -> B) (b : B) (l : list A) : B"),
        ("Definition","filter",   "filter (p : A -> bool) (l : list A) : list A"),
        ("Definition","In",       "In (a : A) (l : list A) : Prop"),
        ("Theorem", "app_nil_r",   "forall l, l ++ [] = l"),
        ("Theorem", "app_assoc",   "forall l m n, (l ++ m) ++ n = l ++ (m ++ n)"),
        ("Theorem", "rev_app_distr", "forall l l', rev (l ++ l') = rev l' ++ rev l"),
        ("Theorem", "rev_involutive", "forall l, rev (rev l) = l"),
        ("Theorem", "map_app",     "forall (f : A -> B) l1 l2, map f (l1 ++ l2) = map f l1 ++ map f l2"),
        ("Theorem", "in_app_iff",  "forall l1 l2 a, In a (l1 ++ l2) <-> In a l1 \\/ In a l2"),
    ],
    "Coq.Logic.FunctionalExtensionality": [
        ("Axiom", "functional_extensionality",
                 "forall (A B : Type) (f g : A -> B), (forall x, f x = g x) -> f = g"),
        ("Axiom", "functional_extensionality_dep",
                 "forall (A : Type) (B : A -> Type) (f g : forall x, B x), (forall x, f x = g x) -> f = g"),
    ],
    "Coq.Strings.String": [
        ("Inductive","string", "Inductive string := EmptyString | String (a : ascii) (s : string)"),
        ("Definition","String.eqb", "String.eqb (s1 s2 : string) : bool"),
    ],
    "Coq.Init.Logic": [
        ("Inductive", "True",  "Inductive True : Prop := I"),
        ("Inductive", "False", "Inductive False : Prop := (no constructors)"),
        ("Inductive", "and",   "Inductive and (A B : Prop) : Prop := conj : A -> B -> A /\\ B"),
        ("Inductive", "or",    "Inductive or  (A B : Prop) : Prop := or_introl | or_intror"),
        ("Inductive", "ex",    "Inductive ex (A : Type) (P : A -> Prop) : Prop := ex_intro"),
        ("Inductive", "eq",    "Inductive eq (A : Type) (x : A) : A -> Prop := eq_refl : x = x"),
        ("Definition","not",   "not (A : Prop) := A -> False    (notation: ~A)"),
        ("Definition","iff",   "iff (A B : Prop) := (A -> B) /\\ (B -> A)    (notation: A <-> B)"),
    ],
}


def _stdlib_for(module: str, import_line: int) -> list[ImportedEntry]:
    """Return curated entries for a Coq stdlib module. Returns [] if we have no
    catalog for that module (just leaves it as an unknown import)."""
    items = _STDLIB.get(module)
    if not items:
        return []
    return [
        ImportedEntry(
            kind=kind, name=name, signature=sig, module=module,
            import_line=import_line,
        )
        for (kind, name, sig) in items
    ]


# Some imports name a *parent* module (e.g. `Coq.Init.Nat`); also accept
# the bare last-segment alias many SF files use (e.g. `Nat`).
_STDLIB_ALIASES: dict[str, str] = {
    "Bool":                       "Coq.Bool.Bool",
    "Arith":                      "Coq.Arith.Arith",
    "Init.Nat":                   "Coq.Init.Nat",
    "Nat":                        "Coq.Init.Nat",
    "PeanoNat":                   "Coq.Arith.PeanoNat",
    "EqNat":                      "Coq.Arith.EqNat",
    "Lia":                        "Coq.Arith.Lia",
    "List":                       "Coq.Lists.List",
    "ListNotations":              "Coq.Lists.List",
    "FunctionalExtensionality":   "Coq.Logic.FunctionalExtensionality",
    "String":                     "Coq.Strings.String",
    "Logic":                      "Coq.Init.Logic",
}


# ---------------------------------------------------------------------------
# Top-level: parse a chapter's import lines and resolve each one
# ---------------------------------------------------------------------------

# Match `From X Require [Import|Export] Y[. ...]`.
# Captures the library (X) and dotted module name (Y), explicitly excluding
# the sentence-terminator `.` so we don't get "Maps." with a trailing dot.
_IMPORT_RE = re.compile(
    r'^\s*From\s+(\w+)\s+Require\s+(?:Import|Export)\s+(\w+(?:\.\w+)*)',
    re.MULTILINE,
)


def parse_imports(text: str) -> list[tuple[str, str, int]]:
    """Return list of (library, module, line_0idx) triples from
    `From X Require Import Y`. `library` is e.g. "PLF" or "Coq"; `module` is
    e.g. "Maps" or "Init.Nat"; line_0idx is the 0-indexed line number where
    the import appears."""
    out: list[tuple[str, str, int]] = []
    for m in _IMPORT_RE.finditer(text):
        # Convert byte offset -> 0-indexed line by counting newlines before it
        line0 = text.count('\n', 0, m.start())
        out.append((m.group(1), m.group(2), line0))
    return out


def get_imported_entries(volume_id: str, chapter_name: str) -> list[ImportedEntry]:
    """Resolve every `From X Require Import Y` in this chapter into a flat
    list of ImportedEntry items (with module attribution)."""
    if volume_id not in VOLUMES:
        return []
    vol = VOLUMES[volume_id]
    v_file = Path(vol["path"]) / f"{chapter_name}.v"
    if not v_file.exists():
        return []
    try:
        text = v_file.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []

    imports = parse_imports(text)
    out: list[ImportedEntry] = []
    seen_modules: set[str] = set()

    lib_to_vol = {v["short"]: vid for vid, v in VOLUMES.items()}
    lib_to_vol.update({v["namespace"]: vid for vid, v in VOLUMES.items()})

    for (library, module, line0) in imports:
        # Same-volume chapter import (e.g. PLF Require Import Maps)
        target_vol = lib_to_vol.get(library) or lib_to_vol.get(library.upper())
        if target_vol is not None:
            sib_v = Path(VOLUMES[target_vol]["path"]) / f"{module}.v"
            mod_name = f"{VOLUMES[target_vol]['short']}.{module}"
            if mod_name in seen_modules:
                continue
            seen_modules.add(mod_name)
            out.extend(_extract_v_definitions(
                sib_v, module=mod_name, chapter_name=module, import_line=line0,
            ))
            continue

        # Coq stdlib path (e.g. Coq.Init.Nat or just Nat)
        canonical = _STDLIB_ALIASES.get(module, f"Coq.{module}" if not module.startswith("Coq.") else module)
        if canonical in seen_modules:
            continue
        seen_modules.add(canonical)
        entries = _stdlib_for(canonical, import_line=line0)
        if entries:
            out.extend(entries)

    return out
