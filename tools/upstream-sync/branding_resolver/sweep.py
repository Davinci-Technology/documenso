"""Post-merge brand sweep across ALL files the merge touched.

The conflict resolver only ever sees *conflicted* files. An upstream file that
merges cleanly but newly introduces a brand symbol (e.g. a handler that imports
``DOCUMENSO_INTERNAL_EMAIL``) never goes through branding substitution, so the
symbol lands on main unbranded. This happened to three job handlers.

This sweep runs the high-precision ``SYMBOL_SAFE_SUBSTITUTIONS`` over every text
file in the merge's changed set (clean or conflicted), rewriting unambiguous
brand symbols in place. Anything the safe subset can't fix is reported as a
residual leak so the merge gate can block auto-merge.

The broad bare-word rule ("Documenso" -> "Davinci Sign") is intentionally NOT in
the swept subset — applying it blindly to functional code/tests/prose is unsafe.
Bare-word branding stays the job of the conflict resolver on flagged files.

Pure string work — reuses ``apply_substitutions``'s preservation handling.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from .config import BRANDING_PRESERVATIONS, SYMBOL_SAFE_SUBSTITUTIONS
from .deterministic import _preserved_ranges, apply_substitutions

logger = logging.getLogger(__name__)

# Extensions never swept as text.
_BINARY_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".pdf", ".p12", ".lock",
})


@dataclass
class SweepResult:
    modified: list[str] = field(default_factory=list)
    leaks: list[str] = field(default_factory=list)


def find_residual_leaks(content: str) -> list[str]:
    """Return symbol-safe source strings still present outside a preserved range.

    After a sweep these should all be gone; any that remain sit inside a
    preservation window (e.g. ``@documenso/`` import, ``github.com/documenso``)
    and so are legitimate — those are NOT reported. Anything else is a leak.
    """
    leaks: list[str] = []
    ranges = _preserved_ranges(content, BRANDING_PRESERVATIONS)
    for src, _dst in SYMBOL_SAFE_SUBSTITUTIONS:
        start = 0
        while True:
            idx = content.find(src, start)
            if idx == -1:
                break
            end = idx + len(src)
            if not any(rs <= idx and end <= re_ for rs, re_ in ranges):
                line_no = content.count("\n", 0, idx) + 1
                leaks.append(f"'{src}' at line {line_no}")
            start = end
    return leaks


def sweep_content(content: str) -> str:
    """Apply the symbol-safe substitutions (preservation-aware) to content."""
    return apply_substitutions(
        content,
        substitutions=SYMBOL_SAFE_SUBSTITUTIONS,
        preservations=BRANDING_PRESERVATIONS,
    )


def _is_binary_path(rel_path: str) -> bool:
    return Path(rel_path).suffix.lower() in _BINARY_EXTENSIONS


def sweep_repo_files(
    repo_path: Path,
    rel_paths: list[str],
    *,
    write: bool = True,
) -> SweepResult:
    """Sweep the given files; rewrite symbol-safe brand strings in place.

    Args:
        repo_path: repository root.
        rel_paths: repo-relative paths from the merge's changed set.
        write: if False, classify only (used for dry runs / tests).

    Returns a SweepResult with the files modified and any residual leaks
    (``"path: 'src' at line N"``) the safe subset could not resolve.
    """
    result = SweepResult()

    for rel_path in rel_paths:
        if _is_binary_path(rel_path):
            continue
        full_path = repo_path / rel_path
        if not full_path.is_file():
            continue

        try:
            original = full_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue  # binary-in-disguise or unreadable — skip

        swept = sweep_content(original)
        if swept != original:
            if write:
                full_path.write_text(swept, encoding="utf-8")
            result.modified.append(rel_path)

        for leak in find_residual_leaks(swept):
            result.leaks.append(f"{rel_path}: {leak}")

    return result
