---
phase: 03-new-market-types
fixed_at: 2026-07-15T04:17:53Z
review_path: .planning/phases/03-new-market-types/03-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-07-15T04:17:53Z
**Source review:** .planning/phases/03-new-market-types/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (critical: 1, warning: 3; info findings IN-01/IN-02 excluded, out of `critical+warning` fix_scope)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: `seedMarketOptions()` test helper uses invalid PostgreSQL syntax

**Files modified:** `tests/helpers/testDb.js`
**Commit:** `46e90ab`
**Applied fix:** Rewrote the multi-row option insert to use the standard PostgreSQL "ordered RETURNING" pattern — the `INSERT ... RETURNING id, sort_order` is now wrapped in a `WITH ins AS (...)` CTE, with `ORDER BY sort_order` moved to the outer `SELECT id, sort_order FROM ins`, exactly as specified in the review. The prior code appended `ORDER BY` directly after `RETURNING` inside the `INSERT` statement, which is not valid PostgreSQL `INSERT` grammar and would fail with SQLSTATE `42601` on any real execution.

**Verification status — IMPORTANT:** This fix is verified **structurally only** (valid `node -c` syntax check on the containing JS file, and the SQL text is a well-known, syntactically valid PostgreSQL CTE pattern). I attempted to execute the corrected query against a real PostgreSQL instance in this environment and could **not**: there is no `psql`, `pg_ctl`, or `docker` binary available, no Postgres listener is reachable on `localhost:5432` (connection refused / no listener found via `ss`/`netstat`), and the configured `DB_NAME` in this environment (`apostae`) is not a test database in any case (the helper's own `assertTestDatabase()` guard would refuse to run against it even if it were reachable). **This finding therefore remains open per 03-07's phase-gate requirement** — the corrected SQL must still be executed against a real, dedicated test PostgreSQL database (name containing `test`, per the helper's own safety guard) before `markets.idor.test.js` / `markets.resolution.test.js` results seeded through this helper can be considered verified. Do not treat this fix as closing that phase gate; only as removing the syntax defect that was blocking it.

### WR-01: No CSS rule for `.odd-btn.option.selected`

**Files modified:** `public/css/style.css`
**Commit:** `23647fa`
**Applied fix:** Added `.odd-btn.option.selected { border-color: var(--sim); background: rgba(198,255,61,0.08); }` immediately after the existing `.odd-btn.option .value` rule (line 444–445 of the additive Phase 3 CSS block), matching the UI-SPEC's uniform `--sim`-accent selection treatment used for binary options. Purely additive — no existing rule was touched. Re-read confirmed the rule is present and the surrounding rules (`.odds-row.multi`, `.option-row`) are intact. No dedicated CSS syntax checker was available in this environment (Tier 3 fallback per verification strategy); Tier 1 re-read confirmed correctness.

### WR-02 + WR-03: Over/Under threshold precision mismatch and missing upper bound

**Files modified:** `src/services/marketService.js`
**Commit:** `587f1a9`
**Applied fix:** These two findings were committed together because they modify the exact same statement in `createMarket`'s `over_under` branch and cannot be meaningfully separated (the upper-bound check in WR-03 must apply to the already-rounded value from WR-02, otherwise a value that rounds into range but was originally out of range, or vice versa, would be checked against the wrong number):
- WR-02: `thresholdNum = Number(threshold)` was changed to `thresholdNum = Math.round(Number(threshold) * 100) / 100`, rounding to 2 decimals *before* it is used to build the auto-generated `Over ${thresholdNum}` / `Under ${thresholdNum}` option labels and before it is passed to `marketRepository.create` as the persisted `threshold` value. Since both the label text and the persisted `NUMERIC(10,2)` column now derive from the same rounded number, they can no longer diverge.
- WR-03: The validation condition was extended from `!Number.isFinite(thresholdNum) || thresholdNum <= 0` to `!Number.isFinite(thresholdNum) || thresholdNum <= 0 || thresholdNum > 999999.99`, throwing the project's existing `ValidationError` class (already imported and used throughout this file) with an updated message. Out-of-range thresholds are now rejected with a clean 400 before reaching the database, instead of surfacing as a raw, untranslated Postgres `numeric field overflow` (SQLSTATE `22003`) 500 error.

`node -c src/services/marketService.js` passed after the edit. Re-read confirmed both the rounding line and the extended bounds check are present, `odds_over`/`odds_under` validation and the rest of the `over_under` branch are untouched, and the rounded `thresholdNum` correctly flows into both the option labels (lines 168–171) and the `marketRepository.create` call (line 181, unchanged, already referencing `thresholdNum`).

## Skipped Issues

None — all 4 in-scope findings (CR-01, WR-01, WR-02, WR-03) were fixed. IN-01 and IN-02 were Info-level and out of the `critical+warning` fix_scope for this run; they were not evaluated or touched.

---

_Fixed: 2026-07-15T04:17:53Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
