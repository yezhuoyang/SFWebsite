"""Configuration for the SF Learning Platform.

All paths are auto-detected or overridable via environment variables,
so the same code works on both Windows (dev) and Linux (production).
"""

import os
import platform
import shutil
from pathlib import Path

# Base directory (SFWebsite/)
BASE_DIR = Path(__file__).resolve().parent.parent

# --- Coq binary paths (auto-detect or override via env) ---

def _find_binary(name: str, env_var: str, win_fallback: str = "") -> Path:
    """Find a binary: env var > PATH lookup > Windows fallback."""
    env = os.environ.get(env_var)
    if env:
        return Path(env)
    found = shutil.which(name)
    if found:
        return Path(found)
    if platform.system() == "Windows" and win_fallback:
        return Path(win_fallback)
    return Path(name)  # Will fail at runtime with a clear error

_WIN_COQ = "C:/Coq-Platform~8.20~2025.01"

COQC_PATH = _find_binary("coqc", "COQC_PATH", f"{_WIN_COQ}/bin/coqc.exe")
SERTOP_PATH = _find_binary("sertop", "SERTOP_PATH", f"{_WIN_COQ}/bin/sertop.exe")
VSCOQTOP_PATH = _find_binary("vscoqtop", "VSCOQTOP_PATH", f"{_WIN_COQ}/bin/vscoqtop.exe")
COQLIB_PATH = Path(os.environ.get("COQLIB_PATH", ""))
if not COQLIB_PATH.name and platform.system() == "Windows":
    COQLIB_PATH = Path(f"{_WIN_COQ}/lib/coq")

# --- Database ---
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite+aiosqlite:///{BASE_DIR / 'sf_learning.db'}",
)

# --- Session limits ---
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "5"))
SESSION_IDLE_TIMEOUT = int(os.environ.get("SESSION_IDLE_TIMEOUT", "600"))  # seconds

# --- Auth ---
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "72"))

# --- CORS ---
CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")

# --- Workspaces ---
WORKSPACES_DIR = Path(os.environ.get("WORKSPACES_DIR", str(BASE_DIR / "workspaces")))

# --- Volume definitions ---
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

# Chapter ordering per volume (content chapters only)
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

SKIP_CHAPTERS = {"Preface", "Postscript", "Bib"}
SKIP_PREFIXES = ("Lib",)
