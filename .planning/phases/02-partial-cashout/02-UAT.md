---
status: testing
phase: 02-partial-cashout
source: [02-VERIFICATION.md]
started: 2026-07-14T19:30:00Z
updated: 2026-07-14T19:30:00Z
---

## Current Test

number: 1
name: resolveMarket remaining-fraction payout scaling (CASHOUT-03)
expected: |
  Run `DB_NAME=<a *test*-named DB> NODE_ENV=test npx jest tests/cashout.resolution-integration.test.js` against a reachable Postgres test database.
  Regression case (cashed_out_amount=0) pays the full original potential_payout (200); scaled case (cashed_out_amount=40) pays exactly 120 (200 * 60/100), not 200.
awaiting: user response

## Tests

### 1. resolveMarket remaining-fraction payout scaling (CASHOUT-03)
expected: Run `npx jest tests/cashout.resolution-integration.test.js` against a reachable Postgres test database. Regression case (cashed_out_amount=0) pays full potential_payout (200); scaled case (cashed_out_amount=40) pays exactly 120, never 200.
result: [pending]

### 2. Minimum-amount / closed-market / resolved-wager rejection paths (CASHOUT-04, CASHOUT-05)
expected: Run `npx jest tests/cashout.validation.test.js` against a reachable Postgres test database. amount<=0 throws ValidationError pre-lock; closed-market and non-pending-wager throw ConflictError after lock+re-validation; requesting the exact remaining stake throws ValidationError; rejected paths never emit wager.cashed_out. (Note: CASHOUT-04's "minimum amount" is satisfied by the locked business decision — no fee, no minimum floor beyond the positive-amount check, confirmed by project owner in STATE.md — this is scope, not a code gap.)
result: [pending]

### 3. Concurrent cashout race + idempotency-key replay under real Postgres semantics (CASHOUT-06, CASHOUT-07)
expected: Run `npx jest tests/cashout.concurrency.test.js tests/cashout.idempotency.test.js tests/cashout.savepoint-replay.test.js` against a reachable Postgres test database. Over-subscribed concurrent requests: exactly one fulfilled, one rejected; under-subscribed: both succeed without data loss. Idempotency: sequential and concurrent retries with the same key never double-credit the wallet or double-increment cashed_out_amount. This is the highest-risk item — CR-01 (idempotency broken by real Postgres transaction-abort semantics) was found here by code review after every mock-backed test reported green; the SAVEPOINT/ROLLBACK TO SAVEPOINT fix is confirmed present and correctly ordered in source, but has never been exercised against real Postgres row-lock contention or a real 23505 collision.
result: [pending]

### 4. Audit-trail reconciliation (CASHOUT-08)
expected: Run `npx jest tests/cashout.audit.test.js` against a reachable Postgres test database. Exactly one wallet_transactions row per successful cashout (type='credit', related_entity='cashout'); amount/balance_before/balance_after reconcile exactly with the wallet's real balance column.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
