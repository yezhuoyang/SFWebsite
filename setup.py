"""Setup script for SF Learning Platform.

Run this once to:
1. Check that Coq tools are installed
2. Compile .vo dependencies for all volumes
3. Seed the database with exercise metadata
"""

import asyncio
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# Paths
COQ_PLATFORM = Path("C:/Coq-Platform~8.20~2025.01")
COQC = COQ_PLATFORM / "bin" / "coqc.exe"
COQ_MAKEFILE = COQ_PLATFORM / "bin" / "coq_makefile.exe"
SERTOP = COQ_PLATFORM / "bin" / "sertop.exe"

VOLUMES = {
    "lf": {"namespace": "LF", "path": BASE_DIR / "lf"},
    "plf": {"namespace": "PLF", "path": BASE_DIR / "plf"},
    "vfa": {"namespace": "VFA", "path": BASE_DIR / "vfa"},
    "slf": {"namespace": "SLF", "path": BASE_DIR / "slf"},
    "secf": {"namespace": "SECF", "path": BASE_DIR / "secf"},
}


def check_tools():
    """Verify that required tools are installed."""
    print("Checking tools...")
    for name, path in [("coqc", COQC), ("coq_makefile", COQ_MAKEFILE), ("sertop", SERTOP)]:
        if path.exists():
            print(f"  [OK] {name}: {path}")
        else:
            print(f"  [MISSING] {name}: {path}")
            print("  Please install Coq Platform 8.20")
            sys.exit(1)

    # Check version
    result = subprocess.run([str(COQC), "--version"], capture_output=True, text=True)
    print(f"  Coq version: {result.stdout.strip().split(chr(10))[0]}")
    print()


def patch_stdlib_imports():
    """Replace 'From Stdlib' with 'From Coq' for Coq 8.20 compatibility.

    SF files target Rocq 9.0+ which uses 'Stdlib' prefix, but
    Coq 8.20 uses 'Coq' prefix for the standard library.
    """
    print("Patching Stdlib imports for Coq 8.20 compatibility...")
    for vol_id, vol_info in VOLUMES.items():
        vol_path = vol_info["path"]
        if not vol_path.exists():
            continue
        patched = 0
        for v_file in vol_path.glob("*.v"):
            content = v_file.read_text(encoding="utf-8", errors="replace")
            if "Stdlib" in content:
                content = content.replace("From Stdlib ", "From Coq ")
                content = content.replace("Stdlib.", "Coq.")
                v_file.write_text(content, encoding="utf-8")
                patched += 1
        if patched:
            print(f"  {vol_id}: patched {patched} files")
    print()


def compile_volume(vol_id: str, vol_info: dict):
    """Compile a volume's .v files to .vo."""
    vol_path = vol_info["path"]
    namespace = vol_info["namespace"]

    if not vol_path.exists():
        print(f"  [SKIP] {vol_id}: directory not found")
        return

    # Check if already compiled
    vo_count = len(list(vol_path.glob("*.vo")))
    v_count = len([f for f in vol_path.glob("*.v") if not f.name.endswith("Test.v")])
    if vo_count >= v_count:
        print(f"  [OK] {vol_id}: already compiled ({vo_count} .vo files)")
        return

    print(f"  [COMPILING] {vol_id} ({v_count} files)...")

    # Generate Makefile.coq
    v_files = sorted([f.name for f in vol_path.glob("*.v") if not f.name.endswith("Test.v")])
    cmd = [str(COQ_MAKEFILE), "-Q", ".", namespace, "-o", "Makefile.coq"] + v_files
    result = subprocess.run(cmd, cwd=str(vol_path), capture_output=True, text=True)
    if result.returncode != 0:
        print(f"    Error generating Makefile: {result.stderr}")
        return

    # Run make
    result = subprocess.run(
        ["make", "-f", "Makefile.coq", "-j4"],
        cwd=str(vol_path),
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode == 0:
        vo_count = len(list(vol_path.glob("*.vo")))
        print(f"    Done ({vo_count} .vo files)")
    else:
        print(f"    Compilation errors (some files may have failed):")
        # Show last few error lines
        for line in result.stderr.strip().split("\n")[-5:]:
            print(f"      {line}")


def main():
    print("=" * 60)
    print("SF Learning Platform - Setup")
    print("=" * 60)
    print()

    # Step 1: Check tools
    check_tools()

    # Step 2: Patch Stdlib imports
    patch_stdlib_imports()

    # Step 3: Compile volumes
    print("Compiling Coq volumes (this may take several minutes)...")
    for vol_id, vol_info in VOLUMES.items():
        compile_volume(vol_id, vol_info)
    print()

    # Step 3: Seed database
    print("Seeding database...")
    sys.path.insert(0, str(BASE_DIR))
    from server.seed_db import seed
    asyncio.run(seed())
    print()

    # Step 4: Install frontend deps
    client_dir = BASE_DIR / "client"
    if not (client_dir / "node_modules").exists():
        print("Installing frontend dependencies...")
        subprocess.run(["npm", "install"], cwd=str(client_dir))

    print()
    print("=" * 60)
    print("Setup complete!")
    print()
    print("To start the platform:")
    print("  1. Backend:  python -m uvicorn server.main:app --reload")
    print("  2. Frontend: cd client && npm run dev")
    print("  3. Open:     http://localhost:5173")
    print("=" * 60)


if __name__ == "__main__":
    main()
