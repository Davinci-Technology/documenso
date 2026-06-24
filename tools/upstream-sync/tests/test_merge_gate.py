"""Tests for the fail-closed merge-gate decision (B0)."""

from branding_resolver.merge_gate import is_blocked


def _seed(dirpath, **files):
    """Write blocker files; value is the file content (str)."""
    dirpath.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (dirpath / name).write_text(content, encoding="utf-8")


def test_all_clear_when_build_gate_ran_empty(tmp_path):
    # Build gate ran and found nothing; no other blocker files present.
    _seed(tmp_path, **{"build_gate_failures.txt": ""})
    blocked, reasons = is_blocked(tmp_path)
    assert blocked is False
    assert reasons == []


def test_missing_required_build_gate_blocks(tmp_path):
    """Fail-closed: if the build gate never ran, do not auto-merge."""
    tmp_path.mkdir(parents=True, exist_ok=True)  # empty sync-output
    blocked, reasons = is_blocked(tmp_path)
    assert blocked is True
    assert any("did not run" in r for r in reasons)


def test_nonempty_blocker_blocks(tmp_path):
    _seed(
        tmp_path,
        **{
            "build_gate_failures.txt": "",
            "regression_violations.txt": "get-email-context.ts: missing 'resolveEmailTransport'",
        },
    )
    blocked, reasons = is_blocked(tmp_path)
    assert blocked is True
    assert any("Reverted Davinci customization" in r for r in reasons)


def test_build_failure_blocks_and_counts(tmp_path):
    _seed(tmp_path, **{"build_gate_failures.txt": "err1\nerr2\nerr3\n"})
    blocked, reasons = is_blocked(tmp_path)
    assert blocked is True
    assert any("3 issue(s)" in r for r in reasons)


def test_multiple_gates_aggregate(tmp_path):
    _seed(
        tmp_path,
        **{
            "build_gate_failures.txt": "type error",
            "branding_leaks.txt": "x.ts: 'DOCUMENSO_INTERNAL_EMAIL' at line 1",
            "unresolvable_files.txt": "foo.ts",
        },
    )
    blocked, reasons = is_blocked(tmp_path)
    assert blocked is True
    assert len(reasons) == 3


def test_whitespace_only_blocker_is_clear(tmp_path):
    _seed(tmp_path, **{"build_gate_failures.txt": "   \n  \n"})
    blocked, reasons = is_blocked(tmp_path)
    assert blocked is False


def test_no_require_build_gate_allows_absent(tmp_path):
    tmp_path.mkdir(parents=True, exist_ok=True)
    blocked, reasons = is_blocked(tmp_path, required=frozenset())
    assert blocked is False
