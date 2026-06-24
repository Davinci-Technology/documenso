"""Tests for the post-merge all-files brand sweep (B3)."""

from branding_resolver.sweep import (
    find_residual_leaks,
    sweep_content,
    sweep_repo_files,
)


def test_clean_merged_handler_gets_symbol_substitution():
    """The incident: an upstream file importing DOCUMENSO_INTERNAL_EMAIL that
    merged cleanly and so was never branded."""
    src = "import { DOCUMENSO_INTERNAL_EMAIL } from '../../../constants/email';"
    out = sweep_content(src)
    assert "DAVINCI_INTERNAL_EMAIL" in out
    assert "DOCUMENSO_INTERNAL_EMAIL" not in out


def test_sweep_preserves_documenso_package_imports():
    src = "import { mailer } from '@documenso/email/mailer';"
    assert sweep_content(src) == src


def test_sweep_does_not_rewrite_bare_documenso_prose():
    """The bare-word rule is excluded from the safe subset — functional code and
    prose mentioning 'Documenso' must be left for the conflict resolver."""
    src = "// Ported from the Documenso upstream implementation."
    assert sweep_content(src) == src
    assert "Documenso" in sweep_content(src)


def test_sweep_rewrites_domain_and_docker_and_hex():
    assert "davincisolutions.ai" in sweep_content("noreply@documenso.com")
    assert "davinci/davinci-sign" in sweep_content("FROM documenso/documenso:latest")
    assert "#1A98CF" in sweep_content("color: #7AC455;")


def test_residual_leak_detection_flags_unpreserved_symbol():
    # A symbol that the safe subset targets but (hypothetically) survived.
    leaks = find_residual_leaks("x = DOCUMENSO_INTERNAL_EMAIL")
    assert len(leaks) == 1
    assert "DOCUMENSO_INTERNAL_EMAIL" in leaks[0]


def test_residual_leak_ignores_preserved_context():
    leaks = find_residual_leaks("import x from '@documenso/lib';")
    assert leaks == []


def test_sweep_repo_files_rewrites_and_reports(tmp_path):
    (tmp_path / "pkg").mkdir()
    handler = tmp_path / "pkg" / "handler.ts"
    handler.write_text(
        "import { DOCUMENSO_INTERNAL_EMAIL } from '@documenso/lib/constants/email';\n",
        encoding="utf-8",
    )
    result = sweep_repo_files(tmp_path, ["pkg/handler.ts"])
    assert "pkg/handler.ts" in result.modified
    assert result.leaks == []  # the @documenso/ import is preserved, symbol fixed
    after = handler.read_text(encoding="utf-8")
    assert "DAVINCI_INTERNAL_EMAIL" in after
    assert "@documenso/lib/constants/email" in after  # import preserved


def test_sweep_repo_files_skips_binary_and_missing(tmp_path):
    (tmp_path / "logo.png").write_bytes(b"\x89PNG\r\n")
    result = sweep_repo_files(tmp_path, ["logo.png", "does-not-exist.ts"])
    assert result.modified == []
    assert result.leaks == []


def test_sweep_no_write_leaves_file_untouched(tmp_path):
    f = tmp_path / "a.ts"
    f.write_text("x = DOCUMENSO_INTERNAL_EMAIL;\n", encoding="utf-8")
    result = sweep_repo_files(tmp_path, ["a.ts"], write=False)
    assert "a.ts" in result.modified  # reported as would-change
    assert f.read_text(encoding="utf-8") == "x = DOCUMENSO_INTERNAL_EMAIL;\n"
