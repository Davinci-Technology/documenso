"""Regression guard: assert Davinci customizations survive an upstream merge.

A recurring failure mode of the sync pipeline is *re-introduction*: a later
upstream merge silently reverts a file to upstream's version, clobbering a
previously-correct Davinci customization. This happened to
``packages/lib/server-only/email/get-email-context.ts`` — a sync reverted it to
upstream's shape (no ``resolveEmailTransport``, no ``DAVINCI_INTERNAL_EMAIL``),
which then failed to compile against the current schema.

This guard reads a manifest of ``path -> [required substrings]`` and asserts each
listed file still contains every required marker after the merge. A missing
marker means a Davinci customization was lost; the file is reported so the merge
gate can force the PR to draft instead of auto-merging.

Pure file I/O — no LLM, no git. Deterministic and fast.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_MANIFEST = "tools/upstream-sync/critical_markers.yaml"


def load_manifest(manifest_path: Path) -> dict[str, list[str]]:
    """Load the critical-markers manifest (``path -> [required substrings]``).

    Raises FileNotFoundError if the manifest is missing (fail-closed: a missing
    manifest is a configuration error, not "nothing to check").
    """
    import yaml  # noqa: PLC0415 — optional dependency, present in the sync venv

    raw = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    if not raw:
        return {}

    markers = raw.get("markers", raw) if isinstance(raw, dict) else {}
    result: dict[str, list[str]] = {}
    for path, required in markers.items():
        if isinstance(required, str):
            required = [required]
        result[str(path)] = [str(m) for m in (required or [])]
    return result


def assert_markers(repo_path: Path, manifest: dict[str, list[str]]) -> list[str]:
    """Check every manifest file still contains its required markers.

    Returns a list of human-readable violation strings. Empty means all
    customizations survived. A file that is *missing entirely* is also a
    violation (the customization can't survive in a deleted file).
    """
    violations: list[str] = []

    for rel_path, required_markers in manifest.items():
        full_path = repo_path / rel_path

        if not full_path.is_file():
            violations.append(f"{rel_path}: file is missing (customization lost)")
            continue

        try:
            content = full_path.read_text(encoding="utf-8")
        except OSError as exc:  # pragma: no cover - unexpected I/O failure
            violations.append(f"{rel_path}: could not read ({exc})")
            continue

        for marker in required_markers:
            if marker not in content:
                violations.append(
                    f"{rel_path}: missing required marker '{marker}' "
                    f"(a sync may have reverted a Davinci customization)"
                )

    return violations


def check_repo(repo_path: Path, manifest_path: Path | None = None) -> list[str]:
    """Convenience: load the manifest and assert markers against the repo."""
    manifest_path = manifest_path or (repo_path / DEFAULT_MANIFEST)
    manifest = load_manifest(manifest_path)
    if not manifest:
        logger.warning("Critical-markers manifest is empty: %s", manifest_path)
        return []
    return assert_markers(repo_path, manifest)
