# Upstream-sync hardening gates

Context: building `main` in Docker (2026-06-22) revealed it had been
**non-compiling for ~2 weeks**. Weeks of automated syncs auto-merged botched
merges because the pipeline had **no typecheck/build gate before auto-merge**.
These gates close that hole. The auto-merge decision is now a function of EVERY
gate, and is **fail-closed**: anything not positively confirmed clean blocks the
merge and routes the sync to a draft PR for human review.

## Gates

Each gate writes a blocker file to `sync-output/`; `merge_gate` aggregates them.

| Gate | Module | Blocker file | Catches |
|------|--------|--------------|---------|
| **Build** (B1) | `build_gate.py` (Jenkins `Post-Merge Gates` stage) | `build_gate_failures.txt` | Any non-compiling merge — builds the final tree (`turbo run build`, incl. `tsc --noEmit`). The load-bearing gate. **Self-heals**: on failure it feeds per-file errors to the repair LLM, rebuilds, up to 2 rounds; if a round changes nothing or errors aren't attributable to a single file (cross-file reconciliation), it escalates to a human draft PR. |
| **Brand sweep** (B3) | `sweep.py` / `gates.py` | `branding_leaks.txt` | Brand symbols that reached main via a **clean** merge (e.g. an upstream file newly importing `DOCUMENSO_INTERNAL_EMAIL`). Rewrites the safe subset in place; flags the rest. |
| **Regression guard** (B4a) | `regression_guard.py` + `critical_markers.yaml` | `regression_violations.txt` | A sync **reverting** a Davinci customization (the proven `get-email-context.ts` case). |
| **Conflicts** (existing) | `resolver.py` | `unresolvable_files.txt` | Conflicts the resolver couldn't resolve. |
| **Decision** (B0) | `merge_gate.py` | — | Aggregates all of the above, fail-closed. Exit 0 = auto-merge; non-zero = draft PR. |

`merge_gate` treats `build_gate_failures.txt` as **required**: if it's absent
(the build gate never ran), the merge is blocked.

## Maintaining the regression manifest

When you add a durable Davinci customization to a file, add a marker for it in
`critical_markers.yaml` (`path -> [required substrings]`). Use a substring
**specific to the Davinci change** (a renamed symbol, a fork-only helper), not a
token upstream also uses.

## Run locally

```bash
PYTHONPATH=tools/upstream-sync python3 -m branding_resolver.gates --repo . \
    --changed-files sync-output/changed_files.txt
PYTHONPATH=tools/upstream-sync python3 -m branding_resolver.merge_gate --sync-output sync-output
```

Tests: `cd tools/upstream-sync && python -m pytest`.

## B7 — GitHub ruleset backstop (manual, do in GitHub settings)

The Jenkins gate decides whether to auto-merge; a GitHub **branch ruleset** on
`main` makes a non-passing PR *unmergeable* at the platform level even if the
Jenkins logic has a bug. Configure on `Davinci-Technology/documenso`:

- Require a status check (the build/typecheck job) to pass before merge.
- Enable **"Require branches to be up to date"** (strict) so checks run against
  the post-merge state.
- **Do not** add the sync bot/app as a bypass actor — otherwise auto-merge sails
  past the gate (the likely current hole).

## Self-heal vs. detect-only

- **Build gate** loops failures back to the agent (bounded, 2 rounds) before
  escalating — fixes cheap cases (a missed rename, a one-file type error)
  automatically. The in-resolver `tsc` self-heal is a fast pre-pass; anything it
  can't fix is recorded to `build_gate_failures.txt` so it can't silently pass.
- **Brand sweep** self-heals deterministically (no LLM).
- **Regression guard** is **detect-only by design** — re-applying a *lost*
  customization from just a marker name invites a plausible-but-wrong fabrication,
  so it flags for a human instead.

## Not yet implemented (follow-ups)

- **B2 Layer B** — a standalone `@babel/parser` pass for `.tsx/.jsx` to give
  fast per-file feedback before the full build. The mandatory build gate (B1)
  already catches this class (it's how the original `p.$url.tsx` corruption would
  now be caught); the babel pass is a cheaper early signal.
- **B4b** — `git rerere` with a persisted `rr-cache` to replay human conflict
  resolutions across syncs.
