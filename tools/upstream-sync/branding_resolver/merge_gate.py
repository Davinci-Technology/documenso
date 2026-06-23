"""Merge-gate decision: aggregate every blocker into one auto-merge verdict.

The pipeline auto-merges an upstream sync to main when nothing blocks it. The
ORIGINAL gate read a single file (``unresolvable_files.txt``) — so a
non-compiling merge, a brand leak in a clean file, or a reverted customization
all sailed through. This module makes the decision a function of EVERY blocker
file, and is **fail-closed**: anything it cannot positively confirm as clean
blocks the merge.

Each gate writes its findings to a file in ``sync-output/``; non-empty == blocked.
A gate listed as ``required`` whose file is *absent* means the gate did not run —
also blocked. Run it from the Jenkinsfile after all gates and branch on the exit
code (0 = clear to auto-merge, 1 = blocked -> draft PR + notify).

Adding a new gate is one line in ``BLOCKER_FILES`` — it then participates
automatically, so the gate can never be silently forgotten.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# filename in sync-output/ -> human-readable gate label
BLOCKER_FILES: dict[str, str] = {
    "unresolvable_files.txt": "Unresolvable merge conflicts",
    "build_gate_failures.txt": "Build/typecheck gate (tsc + turbo build)",
    "branding_leaks.txt": "Brand symbols leaked through a clean merge",
    "regression_violations.txt": "Reverted Davinci customization (marker manifest)",
    "syntax_failures.txt": "Syntax/parse validation",
}

# Gates whose output file MUST exist (their absence means the gate never ran).
# The build gate is the load-bearing one — if it didn't run, do not auto-merge.
REQUIRED_GATES: frozenset[str] = frozenset({"build_gate_failures.txt"})


def is_blocked(
    sync_output_dir: Path,
    required: frozenset[str] = REQUIRED_GATES,
) -> tuple[bool, list[str]]:
    """Return ``(blocked, reasons)`` by reading every blocker file.

    Fail-closed: a non-empty blocker file blocks; a required gate's missing file
    blocks; an unreadable file blocks.
    """
    reasons: list[str] = []

    for filename, label in BLOCKER_FILES.items():
        path = sync_output_dir / filename

        if not path.exists():
            if filename in required:
                reasons.append(f"{label}: gate did not run ({filename} missing)")
            continue

        try:
            content = path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            # Fail-closed: can't read it -> assume the worst.
            reasons.append(f"{label}: blocker file unreadable ({exc})")
            continue

        if content:
            count = len([ln for ln in content.splitlines() if ln.strip()])
            reasons.append(f"{label}: {count} issue(s)")

    return (len(reasons) > 0, reasons)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="branding_resolver.merge_gate",
        description="Decide whether an upstream sync may auto-merge (fail-closed).",
    )
    parser.add_argument(
        "--sync-output",
        default="sync-output",
        help="Path to the sync-output directory (default: sync-output)",
    )
    parser.add_argument(
        "--no-require-build-gate",
        action="store_true",
        help="Do not treat a missing build_gate_failures.txt as a blocker "
        "(for local/dry runs only — never in CI).",
    )
    args = parser.parse_args(argv)

    required = frozenset() if args.no_require_build_gate else REQUIRED_GATES
    blocked, reasons = is_blocked(Path(args.sync_output), required=required)

    if blocked:
        print("MERGE BLOCKED — auto-merge withheld; route to a draft PR for review:")
        for reason in reasons:
            print(f"  - {reason}")
        return 1

    print("MERGE CLEAR — all gates green; eligible for auto-merge.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
