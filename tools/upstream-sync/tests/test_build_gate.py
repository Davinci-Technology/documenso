"""Tests for the build gate + bounded self-heal loop (B1)."""

from branding_resolver.build_gate import (
    group_repo_errors,
    is_lockfile_drift,
    is_tooling_failure,
    npm_ci_failure_lines,
    parse_error_lines,
    resolve_repo_path,
    self_heal_build,
)


# The exact npm ci failure text from the davinci-sign PR-70 CI run.
_REAL_NPM_CI_DRIFT = """\
npm error code EUSAGE
npm error
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error
npm error Missing: typescript@5.9.3 from lock file
npm error
npm error Clean install a project
"""


def test_is_lockfile_drift_on_real_ci_text():
    assert is_lockfile_drift(_REAL_NPM_CI_DRIFT) is True


def test_npm_ci_failure_lines_labels_drift():
    lines = npm_ci_failure_lines(_REAL_NPM_CI_DRIFT)
    assert "LOCKFILE/DEPENDENCY DRIFT" in lines[0]
    assert any("typescript@5.9.3" in ln for ln in lines)


def test_is_lockfile_drift_false_on_normal_output():
    assert is_lockfile_drift("added 2243 packages in 1s") is False


def test_npm_ci_failure_lines_handles_tooling_down():
    log = "error during connect: ... dockerDesktopLinuxEngine ... cannot find the file specified"
    lines = npm_ci_failure_lines(log)
    assert "BUILD TOOLING UNAVAILABLE" in lines[0]


def _mk(root, rel):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("x", encoding="utf-8")
    return p


def test_resolve_repo_path_remix_relative(tmp_path):
    _mk(tmp_path, "apps/remix/app/components/x.tsx")
    assert resolve_repo_path(tmp_path, "app/components/x.tsx") == "apps/remix/app/components/x.tsx"


def test_resolve_repo_path_dotdot(tmp_path):
    _mk(tmp_path, "packages/lib/y.ts")
    assert resolve_repo_path(tmp_path, "../../packages/lib/y.ts") == "packages/lib/y.ts"


def test_resolve_repo_path_missing_returns_none(tmp_path):
    assert resolve_repo_path(tmp_path, "app/nope.tsx") is None


def test_group_repo_errors_groups_by_resolved_file(tmp_path):
    _mk(tmp_path, "apps/remix/app/a.tsx")
    _mk(tmp_path, "packages/lib/b.ts")
    log = (
        "app/a.tsx(10,5): error TS2304: Cannot find name 'X'.\n"
        "app/a.tsx(12,1): error TS2345: bad arg\n"
        "../../packages/lib/b.ts(3,2): error TS2551: nope\n"
        "some unrelated line\n"
    )
    grouped = group_repo_errors(tmp_path, log)
    assert set(grouped) == {"apps/remix/app/a.tsx", "packages/lib/b.ts"}
    assert len(grouped["apps/remix/app/a.tsx"]) == 2


def test_parse_error_lines_prefers_ts_errors():
    log = "src/x.ts(1,1): error TS1005: ';' expected.\nblah"
    lines = parse_error_lines(log)
    assert any("TS1005" in ln for ln in lines)


def test_parse_error_lines_falls_back_to_build_failure():
    log = "step 1\nfailed to solve: process did not complete successfully\n"
    lines = parse_error_lines(log)
    assert any("failed to solve" in ln for ln in lines)


def test_tooling_failure_detected_from_real_docker_down_log():
    """The exact message from the live run when Docker Desktop was down."""
    log = ('error during connect: Get "http://.../dockerDesktopLinuxEngine/...": '
           "open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.")
    assert is_tooling_failure(log) is True
    lines = parse_error_lines(log)
    assert len(lines) == 1
    assert "BUILD TOOLING UNAVAILABLE" in lines[0]
    assert "does NOT mean" in lines[0]  # don't mislead the reviewer


def test_tooling_failure_not_triggered_by_real_ts_errors():
    log = "app/x.tsx(1,1): error TS2304: Cannot find name 'Y'."
    assert is_tooling_failure(log) is False
    lines = parse_error_lines(log)
    assert any("TS2304" in ln for ln in lines)


def test_rounds_run_reflects_actual_builds_on_pass(tmp_path):
    res = self_heal_build(tmp_path, build_fn=lambda r: (True, ""), fix_fn=None, max_rounds=2)
    assert res.rounds_run == 0  # passed on first build


def test_self_heal_passes_first_build(tmp_path):
    res = self_heal_build(tmp_path, build_fn=lambda r: (True, ""), fix_fn=None, max_rounds=2)
    assert res.ok is True
    assert res.rounds_run == 0
    assert res.files_fixed == []


def test_self_heal_fixes_then_passes(tmp_path):
    _mk(tmp_path, "apps/remix/app/a.tsx")
    builds = iter([
        (False, "app/a.tsx(1,1): error TS2304: Cannot find name 'X'."),
        (True, ""),
    ])
    fixed_calls = []

    def build_fn(_r):
        return next(builds)

    def fix_fn(path, content, errs):
        fixed_calls.append(path)
        return content + "\n// fixed"

    res = self_heal_build(tmp_path, build_fn=build_fn, fix_fn=fix_fn, max_rounds=2)
    assert res.ok is True
    assert res.files_fixed == ["apps/remix/app/a.tsx"]
    assert fixed_calls == ["apps/remix/app/a.tsx"]


def test_self_heal_escalates_when_fix_changes_nothing(tmp_path):
    _mk(tmp_path, "apps/remix/app/a.tsx")

    def build_fn(_r):
        return (False, "app/a.tsx(1,1): error TS2304: nope")

    def fix_fn(_path, content, _errs):
        return content  # no change -> can't self-heal

    res = self_heal_build(tmp_path, build_fn=build_fn, fix_fn=fix_fn, max_rounds=2)
    assert res.ok is False
    assert any("TS2304" in e for e in res.remaining_errors)


def test_self_heal_escalates_on_unattributable_errors(tmp_path):
    def build_fn(_r):
        return (False, "failed to solve: turbo build crashed")

    called = []
    res = self_heal_build(tmp_path, build_fn=build_fn,
                          fix_fn=lambda *a: called.append(a) or "x", max_rounds=2)
    assert res.ok is False
    assert called == []  # nothing to attribute -> no fix attempts
    assert any("failed to solve" in e for e in res.remaining_errors)


def test_self_heal_exhausts_rounds(tmp_path):
    _mk(tmp_path, "apps/remix/app/a.tsx")
    calls = {"n": 0}

    def build_fn(_r):
        calls["n"] += 1
        return (False, "app/a.tsx(1,1): error TS2304: still broken")

    def fix_fn(_path, content, _errs):
        return content + "\n// attempt"  # always "changes" but never fixes

    res = self_heal_build(tmp_path, build_fn=build_fn, fix_fn=fix_fn, max_rounds=2)
    assert res.ok is False
    # builds at rounds 0,1,2 = 3 attempts
    assert calls["n"] == 3
