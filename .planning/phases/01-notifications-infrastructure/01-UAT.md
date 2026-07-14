---
status: testing
phase: 01-notifications-infrastructure
source: [01-VERIFICATION.md]
started: 2026-07-14T14:08:13Z
updated: 2026-07-14T14:08:13Z
---

## Current Test

number: 1
name: Run the notification test suites against a live, reachable Postgres test database
expected: |
  All 6 suites pass (notifications.emission, notifications.events, notifications.read-state,
  notifications.ownership, notifications.pagination, notifications.idempotency) — no failures
  beyond the currently-known, already-deferred WR-04 flakiness risk (fixed wait(50) sleep).
awaiting: user response

## Tests

### 1. Run the notification test suites against a live, reachable Postgres test database
expected: |
  Once a *test*-named Postgres database is reachable (resolve the pg_hba.conf/proxy allowlist
  gap, or provision a separate local test Postgres), run `DB_NAME=<test-db> NODE_ENV=test npm test`.
  All 6 suites pass — no failures beyond the already-deferred WR-04 flakiness risk.
result: [pending]

### 2. (Optional, lower priority) Confirm end-to-end behavior via manual HTTP smoke test
expected: |
  With a running server and a real user session: place a wager, cancel a wager, and (as admin)
  close/resolve/delete a market; then GET /api/notifications as that user and confirm the expected
  rows appear with correct Portuguese copy, and PATCH /api/notifications/:id/read persists across
  a second GET. Notifications appear with the right event type/text; a foreign user's id returns
  404; read state persists.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
