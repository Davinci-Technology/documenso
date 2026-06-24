"""Mandatory build gate with a bounded agent self-heal loop.

Builds the final merged tree; if it doesn't compile, feeds the per-file errors
back to the LLM repair primitive, rebuilds, and repeats up to ``max_rounds``
times before giving up and writing ``build_gate_failures.txt`` (which blocks the
merge -> draft PR).

Design:
- The orchestration (``self_heal_build``) is pure and takes injected ``build_fn``
  and ``fix_fn`` callables, so the loop/decision logic is unit-tested without
  Docker or an LLM.
- ``main()`` wires the real Docker build and the real LLM fix and is what the
  Jenkinsfile invokes.

A self-heal loop fixes the cheap cases (a missed rename, a one-file type error)
automatically. Cross-file reconciliation (the kind the 2026-06 incident needed)
exceeds a per-file fix, so when no file's content changes in a round the loop
stops early and escalates to a human draft PR rather than spinning.
"""

from __future__ import annotations

import argparse
import logging
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .tsc_validator import _parse_tsc_output

logger = logging.getLogger("branding_resolver.build_gate")

# (ok, log) — ok True means the build compiled.
BuildFn = Callable[[Path], "tuple[bool, str]"]
# (rel_path, content, error_messages) -> fixed_content | None
FixFn = Callable[[str, str, "list[str]"], "str | None"]


@dataclass
class BuildGateResult:
    ok: bool
    rounds_run: int
    remaining_errors: list[str] = field(default_factory=list)
    files_fixed: list[str] = field(default_factory=list)


def resolve_repo_path(repo_path: Path, tsc_file_path: str) -> str | None:
    """Map a compiler-reported path to a repo-relative path that exists.

    The remix build runs ``tsc`` from ``apps/remix``, so errors look like
    ``app/components/x.tsx`` (relative to apps/remix) or ``../../packages/lib/y.ts``.
    Try the likely candidates and return the first that exists on disk.
    """
    p = tsc_file_path.strip().replace("\\", "/")
    candidates = [p]
    if p.startswith("../../"):
        candidates.append(p[len("../../"):])
    if not p.startswith(("apps/", "packages/", "../")):
        candidates.append(f"apps/remix/{p}")
    for cand in candidates:
        cand = cand.lstrip("./")
        if (repo_path / cand).is_file():
            return cand
    return None


def group_repo_errors(repo_path: Path, log: str) -> dict[str, list[str]]:
    """Parse compiler errors from a build log, grouped by repo-relative file.

    Only files that resolve to an existing path are returned (those are the ones
    a per-file fix can act on). Unattributable errors are ignored here but still
    surface via ``parse_error_lines`` for the blocker file.
    """
    grouped: dict[str, list[str]] = {}
    for err in _parse_tsc_output(log):
        rel = resolve_repo_path(repo_path, err.file_path)
        if rel is None:
            continue
        msg = f"line {err.line}: {err.code} {err.message}"
        grouped.setdefault(rel, []).append(msg)
    return grouped


# Signs that the build could not RUN (tooling/infra), as opposed to the code
# failing to compile. Still fail-closed (blocks), but labelled so a human
# reviewer isn't misled into thinking the merged code is broken.
_TOOLING_FAILURE_MARKERS = (
    "error during connect",
    "Cannot connect to the Docker daemon",
    "dockerDesktopLinuxEngine",
    "Cannot load builder",
    "The system cannot find the file specified",
    "Is the docker daemon running",
)


def is_tooling_failure(log: str) -> bool:
    """True if the log indicates the build never ran (Docker/infra down)."""
    return any(m in log for m in _TOOLING_FAILURE_MARKERS)


def parse_error_lines(log: str) -> list[str]:
    """Blocker-file lines describing why the build failed.

    Distinguishes three cases: real TS errors, a tooling/infra failure (build
    couldn't run), and any other build failure.
    """
    errs = _parse_tsc_output(log)
    if errs:
        return [f"{e.file_path}({e.line}): {e.code} {e.message}" for e in errs]
    if is_tooling_failure(log):
        return [
            "BUILD TOOLING UNAVAILABLE — the build gate could not run (Docker/infra). "
            "Blocked fail-closed; this does NOT mean the merged code is broken. "
            "See build_gate.log."
        ]
    # Non-tsc build failure — surface the most telling lines.
    tail = [
        ln.strip()
        for ln in log.splitlines()
        if any(k in ln for k in ("failed to solve", "Lifecycle script", "ERROR", "error during build"))
    ]
    return tail[-20:] or ["Build failed; see build_gate.log"]


def self_heal_build(
    repo_path: Path,
    *,
    build_fn: BuildFn,
    fix_fn: FixFn | None,
    max_rounds: int = 2,
    write: bool = True,
    on_fix: Callable[[], None] | None = None,
) -> BuildGateResult:
    """Build, and on failure self-heal per-file up to ``max_rounds`` times.

    Returns a BuildGateResult; ``ok`` False means the merge must be blocked and
    ``remaining_errors`` describes why.
    """
    files_fixed: list[str] = []
    last_log = ""
    builds_run = 0

    for round_idx in range(max_rounds + 1):
        ok, last_log = build_fn(repo_path)
        builds_run += 1
        if ok:
            return BuildGateResult(ok=True, rounds_run=round_idx, files_fixed=files_fixed)

        if round_idx == max_rounds or fix_fn is None:
            break  # out of repair budget — escalate

        grouped = group_repo_errors(repo_path, last_log)
        if not grouped:
            logger.info("No per-file-attributable errors — escalating to human")
            break

        any_fixed = False
        for rel_path, errs in grouped.items():
            full = repo_path / rel_path
            try:
                content = full.read_text(encoding="utf-8")
            except OSError:
                continue
            fixed = fix_fn(rel_path, content, errs)
            if fixed and fixed != content:
                if write:
                    full.write_text(fixed, encoding="utf-8")
                files_fixed.append(rel_path)
                any_fixed = True
                logger.info("Self-heal round %d edited %s", round_idx + 1, rel_path)

        if not any_fixed:
            logger.info("Round %d changed nothing — escalating to human", round_idx + 1)
            break
        if on_fix:
            on_fix()  # e.g. git add so the rebuild sees the edits

    return BuildGateResult(
        ok=False,
        rounds_run=builds_run,
        remaining_errors=parse_error_lines(last_log),
        files_fixed=files_fixed,
    )


# ---------------------------------------------------------------------------
# Full-repo npm ci lockfile-drift gate
# ---------------------------------------------------------------------------
#
# The Docker build below builds the PRUNED remix app (turbo prune
# --scope=@documenso/remix), so it never runs a full-workspace `npm ci` and
# would MISS lockfile/dependency drift in a non-remix workspace. That blind spot
# shipped real breakage: apps/docs pinned typescript ^5.9.3 while the root used
# 5.6.2, so a full `npm ci` failed ("Missing: typescript@5.9.3 from lock file")
# even though the remix build was green. This gate runs a full-repo `npm ci`
# (with the npm version the repo's engines require) to catch that class.

# npm version the repo's package.json engines require (>=11.11.0). node:22-alpine
# ships npm 10.x, which mis-resolves cross-workspace version overlaps.
_REQUIRED_NPM = "11.11.0"

_LOCKFILE_DRIFT_MARKERS = (
    "can only install packages when your package.json and package-lock.json",
    "Missing:",
    "npm error code EUSAGE",
    "Invalid: lock file",
    "in sync. Please update your lock file",
)


def is_lockfile_drift(log: str) -> bool:
    """True if the log indicates package.json / package-lock.json are out of sync."""
    return any(m in log for m in _LOCKFILE_DRIFT_MARKERS)


def _npm_ci_check(repo_path: Path) -> tuple[bool, str]:
    """Run a full-repo `npm ci` (validate lockfile) in a node container.

    Uses the engines-required npm so a CI npm older than the repo's requirement
    can't produce a false drift signal. ``--ignore-scripts`` keeps it fast and
    side-effect-free — we only care that the lockfile resolves.
    """
    log_path = repo_path / "sync-output" / "npm_ci_gate.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "docker", "run", "--rm",
            "-v", f"{repo_path}:/app", "-w", "/app",
            "node:22-alpine", "sh", "-c",
            f"npm install -g npm@{_REQUIRED_NPM} >/dev/null 2>&1 && "
            "npm ci --ignore-scripts --no-audit --no-fund 2>&1",
        ],
        cwd=repo_path,
        capture_output=True,
        text=True,
        timeout=900,
    )
    log = (proc.stdout or "") + (proc.stderr or "")
    log_path.write_text(log, encoding="utf-8")
    return proc.returncode == 0, log


def npm_ci_failure_lines(log: str) -> list[str]:
    """Blocker lines describing an npm ci failure (drift vs tooling vs other)."""
    if is_lockfile_drift(log):
        drift = [ln.strip() for ln in log.splitlines()
                 if any(m in ln for m in ("Missing:", "in sync", "EUSAGE"))]
        return ["LOCKFILE/DEPENDENCY DRIFT — full-repo `npm ci` failed (package.json "
                "and package-lock.json are out of sync). A workspace likely changed a "
                "dependency without regenerating the lockfile."] + drift[:10]
    if is_tooling_failure(log):
        return ["BUILD TOOLING UNAVAILABLE — npm ci gate could not run (Docker/infra). "
                "Blocked fail-closed."]
    tail = [ln.strip() for ln in log.splitlines() if "npm error" in ln]
    return tail[-12:] or ["npm ci failed; see npm_ci_gate.log"]


# ---------------------------------------------------------------------------
# Real Docker build + LLM fix wiring (used by the Jenkinsfile)
# ---------------------------------------------------------------------------

def _docker_build(repo_path: Path) -> tuple[bool, str]:
    """Build the testing image (runs `turbo run build`, incl. tsc --noEmit)."""
    log_path = repo_path / "sync-output" / "build_gate.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["docker", "compose", "-f", "docker/testing/compose.yml", "build", "davinci-sign"],
        cwd=repo_path,
        capture_output=True,
        text=True,
        timeout=1800,
    )
    log = (proc.stdout or "") + (proc.stderr or "")
    log_path.write_text(log, encoding="utf-8")
    return proc.returncode == 0, log


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="branding_resolver.build_gate",
        description="Mandatory build gate with bounded agent self-heal.",
    )
    parser.add_argument("--repo", default=".", help="Repository root")
    parser.add_argument("--max-rounds", type=int, default=2, help="Self-heal rounds (default 2)")
    parser.add_argument("--no-self-heal", action="store_true", help="Build only; do not attempt repair")
    parser.add_argument("--no-npm-ci", action="store_true",
                        help="Skip the full-repo npm ci lockfile-drift pre-check")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    repo = Path(args.repo).resolve()
    output_dir = repo / "sync-output"
    output_dir.mkdir(parents=True, exist_ok=True)
    blocker = output_dir / "build_gate_failures.txt"

    # Pre-check: full-repo npm ci (lockfile drift). Cheaper than the build and
    # catches workspace install drift the pruned remix build would miss. A drift
    # here is unlikely to be auto-fixable (needs a lockfile regen), so block.
    if not args.no_npm_ci:
        ok, log = _npm_ci_check(repo)
        if not ok:
            blocker.write_text("\n".join(npm_ci_failure_lines(log)), encoding="utf-8")
            logger.warning("npm ci gate FAILED — auto-merge blocked (lockfile/dep drift).")
            return 1
        logger.info("npm ci gate passed (lockfile in sync).")

    fix_fn: FixFn | None = None
    git_add: Callable[[], None] | None = None
    if not args.no_self_heal:
        from .config import BrandingConfig  # noqa: PLC0415
        from .model_client import ModelTier, create_client  # noqa: PLC0415
        from .repair_loop import _llm_fix  # noqa: PLC0415
        import os  # noqa: PLC0415

        config = BrandingConfig()
        api_key = config.openrouter_api_key or os.environ.get("OPENROUTER_API_KEY", "")
        model = os.environ.get("BUILD_GATE_MODEL", "anthropic/claude-sonnet-4")
        client = create_client(ModelTier(name="build-gate", provider="openrouter", model=model, api_key=api_key))

        def fix_fn(rel_path: str, content: str, errs: list[str]) -> str | None:  # noqa: F811
            fixed, _cost = _llm_fix(rel_path, content, errs, config, client, round_num=1)
            return fixed

        def git_add() -> None:  # noqa: F811
            subprocess.run(["git", "-C", str(repo), "add", "-A", "--", ".", ":!.venv", ":!sync-output"], check=False)

    result = self_heal_build(
        repo,
        build_fn=_docker_build,
        fix_fn=fix_fn,
        max_rounds=args.max_rounds,
        on_fix=git_add,
    )

    if result.ok:
        blocker.write_text("", encoding="utf-8")  # required gate ran & passed
        if result.files_fixed:
            logger.info("Build gate passed after self-heal fixed: %s", result.files_fixed)
        else:
            logger.info("Build gate passed.")
        return 0

    blocker.write_text("\n".join(result.remaining_errors), encoding="utf-8")
    logger.warning("Build gate FAILED after %d round(s); %d error(s) remain.",
                   result.rounds_run, len(result.remaining_errors))
    return 1


if __name__ == "__main__":
    sys.exit(main())
