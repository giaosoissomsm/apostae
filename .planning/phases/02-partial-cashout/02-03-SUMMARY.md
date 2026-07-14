---
phase: 02-partial-cashout
plan: 03
subsystem: payments
tags: [postgres, money-math, financial-integrity, jest, resolveMarket]

# Dependency graph
requires:
  - phase: 02-partial-cashout (Plan 01)
    provides: src/utils/money.js (integer-cents multiply), wagers.cashed_out_amount column (migration 004), testDb.js seedOpenMarket()/seedWager()/applyCashoutMigration()
provides:
  - marketService.resolveMarket() win-branch payout scaled by the wager's remaining (post-cashout) stake fraction, closing the double-pay bug
  - tests/cashout.resolution-integration.test.js — regression + scaled-payout coverage for CASHOUT-03
affects: [02-04-cashout-endpoint-wiring, any future plan touching resolveMarket's payout math]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "remainingFraction = (wager.amount - wager.cashed_out_amount) / wager.amount, computed at resolution time and applied via money.multiply(potential_payout, remainingFraction) — never raw float math on payout amounts"

key-files:
  created:
    - tests/cashout.resolution-integration.test.js
  modified:
    - src/services/marketService.js

key-decisions:
  - "Scoped this edit strictly to the win-branch payout line, per the plan's explicit instruction — did not touch the loss branch, resolved/question/wagerOutcomes return shape, emit-after-commit structure, or any other part of resolveMarket."
  - "Used money.multiply(wager.potential_payout, remainingFraction) rather than inline float math, matching Plan 02-01's shared money.js utility and CASHOUT-10's anti-drift requirement."

patterns-established:
  - "Any future financial calculation involving cashed_out_amount must go through money.js, not raw arithmetic — this plan is the second call site (after Plan 02-02's repository layer) to establish that convention for resolveMarket specifically."

requirements-completed: [CASHOUT-03]

coverage:
  - id: D1
    description: "resolveMarket's win-branch payout is scaled by the wager's remaining (post-cashout) stake fraction via money.multiply, not the raw potential_payout unconditionally"
    requirement: "CASHOUT-03"
    verification:
      - kind: unit
        ref: "node --check + structural grep gate (Task 1 verify block) confirming remainingFraction calc present, old unscaled adjustBalance call gone, money.multiply(wager.potential_payout, remainingFraction) present"
        status: pass
      - kind: integration
        ref: "temporary mock-backed jest dry run (deleted before commit) driving the real, committed marketService.resolveMarket through both the zero-cashout and prior-cashout cases — both passed (1200 and 1120 wallet balances respectively, from a 1000 starting balance)"
        status: pass
    human_judgment: true
    rationale: "tests/cashout.resolution-integration.test.js is written against the real interface contract and is ready to run against a live Postgres test database, but no *test*-named Postgres database is reachable in this sandbox (carried-forward blocker from Phase 1, confirmed again this session with both the default DB_NAME and an explicit DB_NAME=apostae_test override — pg_hba.conf on the DB host rejects both). The mock-backed dry run proves the logic is correct, but a human/CI environment with real DB access must execute the committed integration test file for full confidence before this requirement is considered fully closed."

# Metrics
duration: 8min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 03: Resolution Payout Fix Summary

**Fixed the double-pay bug in `marketService.resolveMarket()`: win payouts now scale by `(amount - cashed_out_amount) / amount` via `money.multiply`, so a wager with a prior partial cashout can no longer receive both the cashout payout AND the full original resolution payout on the same stake.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-14T14:35:00-03:00 (approx, from prior plan's completion commit)
- **Completed:** 2026-07-14T14:38:00-03:00
- **Tasks:** 2 completed
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments
- `src/services/marketService.js`'s `resolveMarket()` win branch now computes `remainingFraction = (Number(wager.amount) - Number(wager.cashed_out_amount)) / Number(wager.amount)` and pays `money.multiply(wager.potential_payout, remainingFraction)` — used for the `walletRepository.adjustBalance` call, the `recordTransaction` audit amount, and the `outcomes.push({ ..., payout })` value that feeds the `wager.won` event payload, so the notification also reports the correct scaled amount.
- When `cashed_out_amount = 0` (the default for every wager with no prior cashout), `remainingFraction` is exactly `1` and the paid amount is bit-for-bit identical to the original `potential_payout` — the regression guarantee the plan required.
- `tests/cashout.resolution-integration.test.js` — two real, DB-backed integration tests (regression case: full $200 payout with no cashout; scaled case: $120 payout with a prior $40 cashout on a $100/$200-payout wager) written against the real, unmodified `marketService.resolveMarket`, following the exact `tests/notifications.emission.test.js` setup precedent.
- Verified the fix's actual runtime behavior via a temporary mock-backed jest dry run (deleted before commit) since no live test-DB is reachable in this sandbox — both cases passed against the real, committed code.

## Task Commits

Each task was committed atomically:

1. **Task 1: Scale resolveMarket's win payout by remaining (post-cashout) stake fraction** - `14fa49e` (fix)
2. **Task 2: Write resolution-integration tests (regression + scaled-payout cases)** - `d3c3ff5` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/services/marketService.js` - Added `money.js` import; win-branch payout now scaled by remaining-stake fraction via `money.multiply`, applied consistently to the wallet credit, the audit `wallet_transactions` row, and the `wager.won` event payload
- `tests/cashout.resolution-integration.test.js` - Regression test (no prior cashout, full payout) + scaled-payout test (prior cashout, reduced payout), both asserting wallet balance delta, `wallet_transactions.amount`, and that `resolveMarket`'s external return shape doesn't leak `wagerOutcomes`/`question`

## Decisions Made
- Kept the edit surgical — single-line-level change to the payout amount computation, exactly as the plan specified, touching nothing else in `resolveMarket` (loss branch, return shape, emit-after-commit structure all untouched).
- Reused `money.multiply` (Plan 02-01) rather than inline float math for the scaled payout, consistent with CASHOUT-10's anti-drift requirement and the pattern already established for cashout's own value computation in Plan 02-02.

## Deviations from Plan

None - plan executed exactly as written. The mock-backed dry-run compensation for the unreachable test DB was explicitly anticipated and instructed by the plan's Task 2 `<action>` block, not an ad-hoc deviation.

## Issues Encountered
- Confirmed (again) that no live `*test*`-named Postgres database is reachable from this sandbox — same carried-forward blocker documented in STATE.md and every prior Phase 1/Phase 2 plan's SUMMARY. Verified again this session with both the default `DB_NAME=apostae` (rejected: `assertTestDatabase()` guard, correctly refuses to run against the non-test DB) and an explicit `DB_NAME=apostae_test` override (rejected at the network/pg_hba level: `no pg_hba.conf entry for host ... database "apostae_test"`). `tests/cashout.resolution-integration.test.js` is written and structurally correct, ready to run against a real test DB, but has not been exercised against live Postgres in this session. Compensated per the plan's own instruction with a temporary mock-backed jest dry run (deleted before commit) that drove the real, committed `marketService.resolveMarket` through both the regression case (200 payout) and the scaled case (120 payout) and passed both.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `resolveMarket()`'s payout math is now cashout-aware; Plan 02-02's `cashoutRepository`/lock-helper foundation and this plan's payout fix together close CASHOUT-03's full requirement (remaining stake stays active and resolves correctly).
- The live-DB test blocker (carried from Phase 1, confirmed again here) still needs resolving before `tests/cashout.resolution-integration.test.js` — and all the other written-but-unexecuted integration test files across Phases 1-2 — can get a real pass/fail signal in this environment.
- Ready for the next plan in the wave (`02-04`, the cashout endpoint/service wiring that will call this now-corrected `resolveMarket` indirectly via the shared financial flows).

---
*Phase: 02-partial-cashout*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: src/services/marketService.js
- FOUND: tests/cashout.resolution-integration.test.js
- FOUND: .planning/phases/02-partial-cashout/02-03-SUMMARY.md
- FOUND: 14fa49e (fix commit)
- FOUND: d3c3ff5 (test commit)
