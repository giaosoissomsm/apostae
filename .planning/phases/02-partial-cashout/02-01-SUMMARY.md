---
phase: 02-partial-cashout
plan: 01
subsystem: database
tags: [postgres, money-math, migrations, jest, decimal-safe]

# Dependency graph
requires:
  - phase: 01-notifications-infrastructure
    provides: testDb.js helper conventions (applyXMigration/seedX pattern), Jest test infra
provides:
  - src/utils/money.js — shared integer-cents money-math utility (toCents, fromCents, multiply, subtract, applyFeePercent)
  - src/migrations/004_cashout.js — wager_cashouts table + wagers.cashed_out_amount column
  - env.CASHOUT_FEE_PERCENT (defaults to 0)
  - tests/helpers/testDb.js: applyCashoutMigration(), seedOpenMarket(), seedWager()
affects: [02-02-cashout-repository-service, 02-03-cashout-endpoint-resolvemarket-edit, 02-04-cashout-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integer-cents money math with Number.EPSILON pre-rounding correction (fixes IEEE-754 borderline cases like 1.005*100 === 100.49999999999999)"
    - "Append-only child table + cumulative column on parent (wager_cashouts + wagers.cashed_out_amount) instead of mutating immutable wager fields"
    - "DB-level idempotency via UNIQUE(wager_id, idempotency_key), same shape as Phase 1 notifications UNIQUE constraint"

key-files:
  created:
    - src/utils/money.js
    - tests/money.test.js
    - src/migrations/004_cashout.js
  modified:
    - src/config/env.js
    - tests/helpers/testDb.js

key-decisions:
  - "money.js uses zero-dependency integer-cents arithmetic (not decimal.js) per RESEARCH.md recommendation — no new production dependency, no install checkpoint needed"
  - "Fixed a real float-rounding bug the RESEARCH.md spec's naive Math.round(amount*100) would have shipped with: 1.005*100 === 100.49999999999999 in IEEE-754, which rounds to 100 (wrong) instead of 101 (correct). Added a Number.EPSILON pre-rounding correction to toCents/multiply/applyFeePercent — the exact drift-prevention CASHOUT-10 exists to guarantee."
  - "wallet_transactions.type CHECK constraint left untouched; cashout will reuse type='credit' + related_entity='cashout' per RESEARCH.md Pitfall 4"
  - "No CASHOUT_MIN_AMOUNT env var added — BR-2 (confirmed by project owner) requires only the existing positive-amount validation, no floor"

patterns-established:
  - "Money math: always toCents()/fromCents() round-trip through integer-cents space; never raw Math.round(x*100)/100 inline"
  - "testDb.js helper convention: applyXMigration() lazy-requires the migration file and runs each `up` SQL string via query(), guarded by assertTestDatabase() first"

requirements-completed: [CASHOUT-10, CASHOUT-03, CASHOUT-07]

coverage:
  - id: D1
    description: "Shared decimal-safe money utility (toCents, fromCents, multiply, subtract, applyFeePercent) computes stake x odds and fee application with zero float drift across repeated operations"
    requirement: "CASHOUT-10"
    verification:
      - kind: unit
        ref: "tests/money.test.js — all 8 tests (including the 20-iteration drift-accumulation guard and the 1.005-rounding edge case)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Schema has a place to record each cashout row (wager_cashouts, append-only) and to track cumulative cashed-out stake per wager (wagers.cashed_out_amount, default 0 so resolveMarket's future edit reduces to current behavior when no cashout occurred)"
    requirement: "CASHOUT-03"
    verification:
      - kind: unit
        ref: "node -e structural grep gate (migration id, NUMERIC(15,2) precision, cashed_out_amount column, 2-step down) in Task 2 verify block"
        status: pass
    human_judgment: false
  - id: D3
    description: "A second cashout row with the same (wager_id, idempotency_key) is rejected by the database via a UNIQUE constraint — the idempotency backbone for CASHOUT-07"
    requirement: "CASHOUT-07"
    verification:
      - kind: unit
        ref: "node -e structural grep gate confirming UNIQUE(wager_id, idempotency_key) is present in migration 004's up array"
        status: pass
    human_judgment: true
    rationale: "The UNIQUE constraint is structurally verified to exist, but its actual DB-enforced rejection behavior (a second INSERT with the same key raising 23505) has not been exercised against a live Postgres instance in this sandbox — no *test*-named database is reachable here (same carried-forward blocker as Phase 1, see Issues Encountered). Needs a live-DB integration test in a later plan (02-04) before this can be considered fully proven."

# Metrics
duration: 15min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 01: Cashout Foundation Summary

**Zero-dependency integer-cents money.js utility (with a Number.EPSILON fix for a real IEEE-754 rounding bug), migration 004 (wager_cashouts + wagers.cashed_out_amount), CASHOUT_FEE_PERCENT env var, and extended test-DB seeders — the shared foundation every later cashout plan builds on.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-14T17:20:00Z (approx, git commit history)
- **Completed:** 2026-07-14T17:28:20Z
- **Tasks:** 3 completed
- **Files modified:** 5 (2 created new, 1 new migration, 2 extended)

## Accomplishments
- `src/utils/money.js` — the first shared money-math utility in the codebase (toCents, fromCents, multiply, subtract, applyFeePercent), integer-cents precision, zero new dependencies, replaces the scattered inline `Math.round(x*100)/100` pattern (`wagerService.js:38`)
- `tests/money.test.js` — 8 passing unit tests, run live in this sandbox (pure functions, no DB dependency), including the 20-iteration repeated-operation drift guard CASHOUT-10 requires
- `src/migrations/004_cashout.js` — `wager_cashouts` append-only table with `UNIQUE(wager_id, idempotency_key)` (the CASHOUT-07 idempotency backbone) + `wagers.cashed_out_amount NUMERIC(15,2) DEFAULT 0` cumulative column, mirrored 2-step down migration
- `env.CASHOUT_FEE_PERCENT` added (defaults to 0 per BR-1), no `CASHOUT_MIN_AMOUNT` added (per BR-2)
- `tests/helpers/testDb.js` extended with `applyCashoutMigration()`, `seedOpenMarket()`, `seedWager()` — all `assertTestDatabase()`-guarded, additive only, following the exact `applyWalletSchema()`/`seedWallet()` precedent from Phase 1

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/utils/money.js decimal-safe utility with unit tests** (TDD) —
   - RED: `1dead54` (test: failing tests, verified to fail with `money.js` temporarily absent)
   - GREEN: `a94d6f5` (feat: implementation, all 8 tests pass)
2. **Task 2: Create migration 004_cashout.js and add CASHOUT_FEE_PERCENT to env** - `fc782f1` (feat)
3. **Task 3: Extend tests/helpers/testDb.js with cashout migration + wager/market seeders** - `5421d5f` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/utils/money.js` - Integer-cents money math: toCents/fromCents/multiply/subtract/applyFeePercent
- `tests/money.test.js` - 8 unit tests covering CASHOUT-10's anti-drift guarantee
- `src/migrations/004_cashout.js` - wager_cashouts table + wagers.cashed_out_amount column, mirrored down
- `src/config/env.js` - Added CASHOUT_FEE_PERCENT (default 0)
- `tests/helpers/testDb.js` - Added applyCashoutMigration(), seedOpenMarket(), seedWager()

## Decisions Made
- Zero-dependency `src/utils/money.js` chosen over `decimal.js` per RESEARCH.md's primary recommendation — satisfies CASHOUT-10 with no new supply-chain surface, no install checkpoint needed.
- `applyFeePercent`/`toCents`/`multiply` all apply a `Number.EPSILON` correction before `Math.round` — a well-known JS technique for the IEEE-754 borderline-rounding problem (see Deviations below for why this was necessary, not optional).
- `wallet_transactions.type` CHECK constraint left untouched; cashout will reuse `type: 'credit'` + `related_entity: 'cashout'` in a later plan, per RESEARCH.md Pitfall 4.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a float-rounding bug in the RESEARCH.md-specified money.js formula**
- **Found during:** Task 1 (writing `tests/money.test.js` per the plan's `<behavior>` block, which explicitly requires `toCents(1.005)` to round to `101`)
- **Issue:** The verbatim `toCents`/`multiply`/`applyFeePercent` spec given in `02-RESEARCH.md`'s "Code Examples" section (`Math.round(Number(amount) * 100)`) fails this exact case: in IEEE-754 double precision, `1.005 * 100 === 100.49999999999999`, so `Math.round(...)` returns `100`, not the correct `101`. This is precisely the float-drift class CASHOUT-10 exists to eliminate — shipping the naive spec verbatim would have baked a real rounding bug into the one utility whose entire purpose is preventing rounding bugs.
- **Fix:** Added a `Number.EPSILON` pre-rounding correction — `Math.round((Number(amount) + Number.EPSILON) * 100)` — to `toCents`, and the equivalent correction inside `multiply`/`applyFeePercent`'s internal rounding steps. Verified against all of the plan's required behaviors (`toCents(1.005)===101`, `multiply(10,2.5)===25`, `multiply(33.33,3)===99.99`, `subtract(100,33.33)===66.67`, `applyFeePercent(100,0)`/`applyFeePercent(100,5)`, and a 20-iteration repeated multiply/subtract drift test) plus a manual reconciliation invariant (`remaining + totalCashedOut === original`).
- **Files modified:** `src/utils/money.js`, `tests/money.test.js`
- **Verification:** `npx jest tests/money.test.js` — 8/8 passing
- **Committed in:** `a94d6f5` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, Rule 1)
**Impact on plan:** Necessary correctness fix inside the exact function CASHOUT-10 mandates be drift-free. No scope creep — same five functions, same signatures, same module shape as specified.

## Issues Encountered
- Confirmed (again) that no live `*test*`-named Postgres database is reachable from this sandbox — same carried-forward blocker documented in STATE.md and every Phase 1 plan's SUMMARY. `applyCashoutMigration()`/`seedOpenMarket()`/`seedWager()` are written and structurally correct (syntax-checked, function-existence-checked per the plan's verification block) but have not been exercised against a live database in this session. This does not block this plan's own deliverables (money.js's real tests run with zero DB dependency and pass), but it does mean D3's idempotency-constraint *enforcement* is only structurally verified, not behaviorally verified — flagged in `coverage` above for a later plan's live-DB integration test.
- `.env.example` exists at repo root but this session's permission settings deny read/write access to it (directory-level restriction). Skipped the plan's optional "if `.env.example` exists, add a documented `CASHOUT_FEE_PERCENT=0` line" instruction — not a core deliverable (the plan's `must_haves.artifacts` list does not include `.env.example`), and `env.js`'s actual default (`0`) is unaffected either way.

## User Setup Required

None - no external service configuration required. (`CASHOUT_FEE_PERCENT` defaults to `0` with no env var needing to be set.)

## Next Phase Readiness
- `src/utils/money.js`, migration 004, and the extended `testDb.js` seeders are ready for Plan 02 (`cashoutRepository`/`cashoutService`) to build on directly.
- The live-DB test blocker (carried from Phase 1) still needs resolving before Plan 04's concurrency/idempotency integration tests can get a real pass/fail signal — same infra gap, not new to this plan.

---
*Phase: 02-partial-cashout*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: src/utils/money.js
- FOUND: tests/money.test.js
- FOUND: src/migrations/004_cashout.js
- FOUND: .planning/phases/02-partial-cashout/02-01-SUMMARY.md
- FOUND: 1dead54 (test commit)
- FOUND: a94d6f5 (feat commit)
- FOUND: fc782f1 (feat commit)
- FOUND: 5421d5f (feat commit)
- FOUND: e467ee3 (docs commit)
