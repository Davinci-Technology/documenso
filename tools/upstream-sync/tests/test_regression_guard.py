"""Tests for the regression marker guard (B4a)."""

from branding_resolver import regression_guard


def _write(root, rel, content):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


def test_present_markers_pass(tmp_path):
    _write(tmp_path, "a/file.ts", "uses resolveEmailTransport and DAVINCI_INTERNAL_EMAIL")
    manifest = {"a/file.ts": ["resolveEmailTransport", "DAVINCI_INTERNAL_EMAIL"]}
    assert regression_guard.assert_markers(tmp_path, manifest) == []


def test_missing_marker_flagged(tmp_path):
    """The reversion case: a sync reverted the file to upstream's shape, so the
    Davinci marker is gone."""
    _write(tmp_path, "a/file.ts", "upstream version without the fork helper")
    manifest = {"a/file.ts": ["resolveEmailTransport"]}
    violations = regression_guard.assert_markers(tmp_path, manifest)
    assert len(violations) == 1
    assert "resolveEmailTransport" in violations[0]


def test_missing_file_is_a_violation(tmp_path):
    manifest = {"gone.ts": ["anything"]}
    violations = regression_guard.assert_markers(tmp_path, manifest)
    assert len(violations) == 1
    assert "missing" in violations[0].lower()


def test_multiple_markers_partial_miss(tmp_path):
    _write(tmp_path, "f.ts", "has DAVINCI_INTERNAL_EMAIL only")
    manifest = {"f.ts": ["DAVINCI_INTERNAL_EMAIL", "resolveEmailTransport"]}
    violations = regression_guard.assert_markers(tmp_path, manifest)
    assert len(violations) == 1
    assert "resolveEmailTransport" in violations[0]


def test_load_manifest_parses_markers_key(tmp_path):
    manifest_file = _write(
        tmp_path,
        "critical_markers.yaml",
        "markers:\n  a/b.ts:\n    - Foo\n    - Bar\n  c.ts: Baz\n",
    )
    loaded = regression_guard.load_manifest(manifest_file)
    assert loaded == {"a/b.ts": ["Foo", "Bar"], "c.ts": ["Baz"]}


def test_check_repo_uses_default_manifest_path(tmp_path):
    _write(tmp_path, "tools/upstream-sync/critical_markers.yaml",
           "markers:\n  src/x.ts:\n    - KeepMe\n")
    _write(tmp_path, "src/x.ts", "this file KeepMe present")
    assert regression_guard.check_repo(tmp_path) == []

    _write(tmp_path, "src/x.ts", "reverted, marker gone")
    violations = regression_guard.check_repo(tmp_path)
    assert len(violations) == 1
