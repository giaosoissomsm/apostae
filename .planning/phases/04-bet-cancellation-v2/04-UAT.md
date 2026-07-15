---
status: testing
phase: 04-bet-cancellation-v2
source: [04-VERIFICATION.md]
started: 2026-07-15T13:10:00Z
updated: 2026-07-15T13:10:00Z
---

## Current Test

number: 1
name: Live-DB run of the full phase-4 cancel test suite
expected: |
  With a reachable *test*-named PostgreSQL database (e.g. apostae_test) configured via
  DB_* env vars and NODE_ENV=test, run:
  npx jest tests/cancel.happy-path.test.js tests/cancel.fee-computation.test.js
           tests/cancel.audit.test.js tests/cancel.blocking.test.js
           tests/cancel.concurrency.test.js tests/cashout.cancel-refund.test.js
  plus the IDOR case in tests/cancel.tampering.test.js.
  All suites pass: 95%/5% split on a clean cancel, ConflictError + zero side effects
  on all three CANCEL-06 block conditions, no double-pay/no-deadlock on both
  cancel.concurrency.test.js races, exactly one reconciling wallet_transactions row
  per cancellation, and NotFoundError (404) — not AuthorizationError (403) — for a
  non-owner.
awaiting: user response

## Tests

### 1. Live-DB run of the full phase-4 cancel test suite
expected: |
  All suites pass: 95%/5% split on a clean cancel, ConflictError + zero side effects
  on all three CANCEL-06 block conditions, no double-pay/no-deadlock on both
  cancel.concurrency.test.js races, exactly one reconciling wallet_transactions row
  per cancellation, and NotFoundError (404) — not AuthorizationError (403) — for a
  non-owner.
result: [pending]

### 2. CANCEL-07 concurrency guarantee specifically
expected: |
  Run tests/cancel.concurrency.test.js's two Promise.allSettled races (cancel-vs-cashout,
  cancel-vs-resolveMarket) against real Postgres row locks, ideally repeated a handful
  of times to exercise both winner orderings. Never both operations commit on the same
  wager; never a raw deadlock (40P01) surfaces; exactly one of wallet_transactions'
  refund row or the competing operation's effect (cashout credit / resolution payout)
  exists, never both.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
