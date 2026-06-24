"""Post-merge gate runner: sweep + regression guard over the merged tree.

Run by the Jenkinsfile AFTER the merge/resolve commit and BEFORE the build gate.
It produces the blocker files that ``merge_gate`` aggregates:

  - ``branding_leaks.txt``        — symbol-safe brand strings the sweep couldn't fix
  - ``regression_violations.txt`` — Davinci customizations a sync reverted

The deterministic brand SWEEP also rewrites unambiguous brand symbols in place
across every cleanly-merged file (so they get fixed, not just flagged); the
caller is expected to ``git add -A`` afterwards so those fixes join the commit.

Usage:
    python -m branding_resolver.gates --repo . \
        --changed-files sync-output/changed_files.txt
"""

from __future__ import annotations

import argparse
import logging
import subprocess
import sys
from pathlib import Path

from . import regression_guard
from .sweep import sweep_repo_files

logger = logging.getLogger("branding_resolver.gates")


def _changed_files_from_git(repo: Path, base: str, head: str) -> list[str]:
    """Files changed by the merge: ``git diff --name-only base...head``."""
    out = subprocess.run(
        ["git", "-C", str(repo), "diff", "--name-only", f"{base}...{head}"],
        capture_output=True,
        text=True,
        check=False,
    )
    return [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]


def _load_changed_files(args: argparse.Namespace, repo: Path) -> list[str]:
    if args.changed_files:
        p = Path(args.changed_files)
        if p.is_file():
            return [ln.strip() for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]
        logger.warning("changed-files list %s not found; falling back to git diff", p)
    return _changed_files_from_git(repo, args.base, args.head)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="branding_resolver.gates",
        description="Run post-merge brand sweep + regression guard, write blocker files.",
    )
    parser.add_argument("--repo", default=".", help="Repository root")
    parser.add_argument(
        "--changed-files",
        default="sync-output/changed_files.txt",
        help="File listing repo-relative changed paths (one per line)",
    )
    parser.add_argument("--base", default="origin/main", help="Merge base ref for git-diff fallback")
    parser.add_argument("--head", default="HEAD", help="Merge head ref for git-diff fallback")
    parser.add_argument(
        "--no-write",
        action="store_true",
        help="Classify only; do not rewrite swept files (dry run)",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    repo = Path(args.repo).resolve()
    output_dir = repo / "sync-output"
    output_dir.mkdir(parents=True, exist_ok=True)

    changed = _load_changed_files(args, repo)
    logger.info("Post-merge gates over %d changed file(s)", len(changed))

    # --- B3: deterministic brand sweep across ALL changed files ---
    sweep = sweep_repo_files(repo, changed, write=not args.no_write)
    if sweep.modified:
        logger.info("Sweep rewrote %d file(s) with symbol-safe branding", len(sweep.modified))
    (output_dir / "branding_leaks.txt").write_text("\n".join(sweep.leaks), encoding="utf-8")
    if sweep.leaks:
        logger.warning("Brand leaks the safe sweep could not fix: %d", len(sweep.leaks))
        for leak in sweep.leaks:
            logger.warning("  - %s", leak)

    # --- B4a: regression marker guard ---
    violations = regression_guard.check_repo(repo)
    (output_dir / "regression_violations.txt").write_text("\n".join(violations), encoding="utf-8")
    if violations:
        logger.warning("Reverted Davinci customizations: %d", len(violations))
        for v in violations:
            logger.warning("  - %s", v)

    # gates.py only PRODUCES blocker files; merge_gate makes the verdict.
    # Exit non-zero if it produced any blocker, as a convenience signal.
    return 1 if (sweep.leaks or violations) else 0


if __name__ == "__main__":
    sys.exit(main())
