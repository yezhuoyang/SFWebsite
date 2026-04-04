"""Configuration for the SF Learning Platform."""

import os
from pathlib import Path

# Base directory (SFWebsite/)
BASE_DIR = Path(__file__).resolve().parent.parent

# Coq Platform paths
COQ_PLATFORM = Path("C:/Coq-Platform~8.20~2025.01")
COQC_PATH = COQ_PLATFORM / "bin" / "coqc.exe"
SERTOP_PATH = COQ_PLATFORM / "bin" / "sertop.exe"
COQLIB_PATH = COQ_PLATFORM / "lib" / "coq"

# Database
DATABASE_URL = f"sqlite+aiosqlite:///{BASE_DIR / 'sf_learning.db'}"

# Volume definitions
VOLUMES = {
    "lf": {
        "name": "Logical Foundations",
        "short": "LF",
        "namespace": "LF",
        "coq_flags": ["-Q", ".", "LF"],
        "path": BASE_DIR / "lf",
        "has_test_files": True,
    },
    "plf": {
        "name": "Programming Language Foundations",
        "short": "PLF",
        "namespace": "PLF",
        "coq_flags": ["-Q", ".", "PLF"],
        "path": BASE_DIR / "plf",
        "has_test_files": True,
    },
    "vfa": {
        "name": "Verified Functional Algorithms",
        "short": "VFA",
        "namespace": "VFA",
        "coq_flags": [
            "-Q", ".", "VFA",
            "-w", "-omega-is-deprecated,-implicit-core-hint-db",
        ],
        "path": BASE_DIR / "vfa",
        "has_test_files": True,
    },
    "slf": {
        "name": "Separation Logic Foundations",
        "short": "SLF",
        "namespace": "SLF",
        "coq_flags": [
            "-Q", ".", "SLF",
            "-w", "-implicit-core-hint-db,-ambiguous-paths,-notation-incompatible-prefix,-automatic-prop-lowering",
        ],
        "path": BASE_DIR / "slf",
        "has_test_files": False,
    },
    "secf": {
        "name": "Security Foundations",
        "short": "SecF",
        "namespace": "SECF",
        "coq_flags": ["-Q", ".", "SECF"],
        "path": BASE_DIR / "secf",
        "has_test_files": True,
    },
}

# Chapter ordering per volume (from Makefiles, content chapters only)
CHAPTER_ORDER = {
    "lf": [
        "Basics", "Induction", "Lists", "Poly", "Tactics", "Logic",
        "IndProp", "Maps", "ProofObjects", "IndPrinciples", "Rel",
        "Imp", "ImpParser", "ImpCEvalFun", "Extraction", "Auto", "AltAuto",
    ],
    "plf": [
        "Maps", "Imp", "Equiv", "Hoare", "Hoare2", "HoareAsLogic",
        "Smallstep", "Types", "Stlc", "StlcProp", "MoreStlc",
        "Sub", "Typechecking", "Records", "References", "RecordSub",
        "Norm", "PE", "LibTactics", "UseTactics", "UseAuto",
    ],
    "vfa": [
        "Perm", "Sort", "Multiset", "BagPerm", "Selection", "Merge",
        "Maps", "SearchTree", "ADT", "Extract", "Redblack", "Trie",
        "Priqueue", "Binom", "Decide", "Color",
    ],
    "slf": [
        "Basic", "Repr", "Hprop", "Himpl", "Triples", "Rules",
        "Wand", "WPsem", "WPgen", "WPsound", "Affine", "Arrays", "Records",
    ],
    "secf": [
        "Maps", "Imp", "Equiv", "Hoare", "Hoare2",
        "Noninterference", "StaticIFC", "SpecCT",
    ],
}

# Chapters to skip for exercise parsing (no exercises, or library files)
SKIP_CHAPTERS = {"Preface", "Postscript", "Bib"}
SKIP_PREFIXES = ("Lib",)  # LibTactics, LibSepSimpl, etc. in SLF
