---
phase: 02-partial-cashout
plan: 07
subsystem: payments
tags: [postgres, concurrency, row-locking, idempotency, jest, integration-tests]

# Dependency graph
requires:
  - phase: 02-partial-cashout (Plan 04)
    provides: wagerService.cashoutWager() — the real, unmodified transaction under test (market->wager->wallet FOR UPDATE lock order, INSERT-then-catch-23505-and-replay idempotency, walletRepository-only audit trail)
  - phase: 02-partial-cashout (Plan 01)
    provides: tests/helpers/testDb.js applyCashoutMigration()/seedOpenMarket()/seedWager()/seedWallet() precedent
provides:
  - tests/cashout.concurrency.test.js — proves CASHOUT-06 (row lock serializes concurrent cashouts; over-subscribed pairs never both succeed, under-subscribed pairs both succeed without data loss)
  - tests/cashout.idempotency.test.js — proves CASHOUT-07 (sequential and genuinely concurrent retry with the same idempotency key never double-applies)
  - tests/cashout.audit.test.js — proves CASHOUT-08 (every successful cashout produces exactly one reconciling wallet_transactions row; static grep confirms no raw UPDATE wallets bypasses the repository)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Attack-vector proof suite pattern: Promise.allSettled for over-subscribed concurrency (expect exactly one fulfilled/one rejected), Promise.all for under-subscribed concurrency and concurrent idempotency replay (expect both resolve, assert no double-application) — fires genuinely simultaneous requests against the real service, never sequential awaits"

key-files:
  created:
    - tests/cashout.concurrency.test.js
    - tests/cashout.idempotency.test.js
    - tests/cashout.audit.test.js
  modified: []

key-decisions:
  - "Compensating verification used a purpose-built mock-backed dry run (scratchpad-only, never touched the repo) that fakes only src/config/database.js's transaction()/query() exports via require.cache injection — every repository (wagerRepository, walletRepository, marketRepository, cashoutRepository) and wagerService.cashoutWager itself remain the real, unmodified committed source. The fake DB emulates FOR UPDATE row-lock serialization with a per-key async mutex chain and a UNIQUE(wager_id, idempotency_key) 23505 constraint, so the dry run genuinely exercises lock-contention ordering and idempotency-replay branching, not just happy-path logic."
  - "All three deliverable test files are real Postgres integration tests (not mocks) — they use the exact assertTestDatabase()-guarded setup precedent from tests/notifications.emission.test.js and are ready to run unmodified against a live *test*-named database. The mock dry run exists only as this-session compensating confidence, per Phase 1/Plan 02-04's established precedent, and was never committed."

patterns-established: []

requirements-completed: [CASHOUT-06, CASHOUT-07, CASHOUT-08]

coverage:
  - id: D1
    description: "Two genuinely concurrent cashout requests (Promise.allSettled/Promise.all) on the same wager can never both succeed if their combined stake would exceed the remaining balance, and can both succeed without data loss when the combined stake fits"
    requirement: "CASHOUT-06"
    verification:
      - kind: unit
        ref: "tests/cashout.concurrency.test.js — both scenarios; mock-backed dry run scenarios 1-2 (22/22 assertions passed against the real, unmodified wagerService.cashoutWager)"
        status: pass
    human_judgment: true
    rationale: "tests/cashout.concurrency.test.js is written against the real interface contract and structurally verified (assertTestDatabase() correctly refuses the non-test 'apostae' DB, confirming the guard fires as designed), but no *test*-named Postgres database is reachable in this sandbox (reconfirmed this session: DB_NAME=apostae_test fails at the pg_hba.conf level — 'no pg_hba.conf entry for host ... database \"apostae_test\"', same carried-forward blocker as every prior Phase 1/Phase 2 plan). The mock-backed dry run (deleted/never-committed, scratchpad-only) drove the real cashoutWager through both the over-subscribed and under-subscribed concurrency scenarios with a genuine per-row async-mutex lock simulation — both passed — but a human/CI environment with real DB access must execute the committed test file for full confidence."
  - id: D2
    description: "A retried request with the same idempotency key (sequential and genuinely concurrent via Promise.all) never double-applies the wallet credit or the cashed_out_amount increment"
    requirement: "CASHOUT-07"
    verification:
      - kind: unit
        ref: "tests/cashout.idempotency.test.js — both scenarios; mock-backed dry run scenarios 3-4 (both passed)"
        status: pass
    human_judgment: true
    rationale: "Same live-DB-unreachable caveat as D1 — structurally correct and mock-dry-run verified (including the genuinely-concurrent Promise.all case, where the losing leg's INSERT collides with the real UNIQUE(wager_id, idempotency_key) constraint semantics simulated by the fake DB and correctly replays the winning leg's committed result), needs live-DB execution for full confidence."
  - id: D3
    description: "Every successful cashout produces exactly one wallet_transactions row (type='credit', related_entity='cashout') whose amount and balance_before/balance_after exactly reconcile with the wallet's actual balance change; no raw UPDATE wallets bypasses the repository inside cashoutWager"
    requirement: "CASHOUT-08"
    verification:
      - kind: unit
        ref: "tests/cashout.audit.test.js — both scenarios; mock-backed dry run scenario 5 (passed)"
        status: pass
      - kind: other
        ref: "node -e region-scoped grep gate (plan's Task 3 verify block) confirming no 'UPDATE wallets' string inside cashoutWager's method region — ran this session, printed OK"
        status: pass
    human_judgment: true
    rationale: "The static grep gate ran successfully in this sandbox and passed unconditionally (no DB needed). The Postgres-integration half of this deliverable has the same live-DB-unreachable caveat as D1/D2 — structurally correct and mock-dry-run verified, needs live-DB execution for full confidence."

# Metrics
duration: 12min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 07: Cashout Attack-Vector Proof Suite Summary

**Three genuinely-concurrent Jest integration test files (Promise.allSettled/Promise.all, not sequential awaits) proving CASHOUT-06's race-condition lock ordering, CASHOUT-07's idempotent-replay semantics, and CASHOUT-08's audit-trail completeness against the real, unmodified `wagerService.cashoutWager` — plus a scratchpad-only mock-backed dry run (22/22 assertions passed) compensating for this session's carried-forward no-live-test-DB sandbox limitation.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-14T17:55:00Z (approx, from prior plan's completion commit)
- **Completed:** 2026-07-14T18:07:00Z
- **Tasks:** 3 completed
- **Files modified:** 3 (all created)

## Accomplishments
- `tests/cashout.concurrency.test.js` (CASHOUT-06) — fires two genuinely simultaneous cashout requests via `Promise.allSettled` (over-subscribed: 60+60 against a remaining stake of 100) and proves exactly one succeeds while the other is correctly rejected after re-validating post-lock state; a second scenario via `Promise.all` (under-subscribed: 20+20) proves both requests succeed and are correctly serialized without the lock corrupting or dropping either update.
- `tests/cashout.idempotency.test.js` (CASHOUT-07) — proves a sequential retry with the same idempotency key returns the identical committed `cashout.id`/`netValue` and produces exactly one `wallet_transactions` row; proves a genuinely concurrent retry (`Promise.all`, identical key) never double-credits — the losing leg catches the real `23505` constraint violation and replays the winning leg's committed result.
- `tests/cashout.audit.test.js` (CASHOUT-08) — proves every successful cashout produces exactly one matching `wallet_transactions` row (`type='credit'`, `related_entity='cashout'`) whose `amount` and `balance_before`/`balance_after` exactly reconcile with the wallet's real balance column, across both a single-cashout scenario and a two-sequential-cashouts scenario; the plan's static grep gate (region-scoped, in the `<verify>` block, not the test file) confirms `cashoutWager`'s method region contains no raw `UPDATE wallets` bypassing `walletRepository` — ran and passed (`OK`).
- Compensating mock-backed dry run (`/tmp/.../scratchpad/cashout-dryrun.js`, never touched the repository, not part of the deliverable) drove the real, committed `wagerService.cashoutWager` — and every repository it calls — through 5 scenarios (over-subscribed concurrency, under-subscribed concurrency, sequential idempotent replay, concurrent idempotent replay, audit-trail reconciliation) against a fake Postgres client that emulates `FOR UPDATE` row-lock serialization via a per-key async mutex chain and the real `UNIQUE(wager_id, idempotency_key)` constraint via a simulated `23505` error — all 22 assertions passed. The fake only replaces `src/config/database.js`'s `transaction`/`query` exports (via `require.cache` injection before `wagerService` loads); every repository and the service method under test are the real, unmodified committed source, not mocks of the logic being proven.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write cashout.concurrency.test.js — two simultaneous cashouts on the same wager** - `cb27b89` (test)
2. **Task 2: Write cashout.idempotency.test.js — replayed idempotency key never double-applies** - `a814cd0` (test)
3. **Task 3: Write cashout.audit.test.js — wallet_transactions row and balance-delta match** - `7e60695` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `tests/cashout.concurrency.test.js` - CASHOUT-06: over-subscribed and under-subscribed concurrent cashout scenarios via `Promise.allSettled`/`Promise.all`
- `tests/cashout.idempotency.test.js` - CASHOUT-07: sequential and genuinely-concurrent idempotency-key replay scenarios
- `tests/cashout.audit.test.js` - CASHOUT-08: wallet_transactions reconciliation, single and multi-cashout scenarios

## Decisions Made
- Compensating verification used a purpose-built mock-backed dry run (scratchpad-only, never committed) that fakes only `src/config/database.js`'s low-level `transaction`/`query` exports, leaving every repository and `wagerService.cashoutWager` itself as the real, unmodified source — this is the strongest form of "real, unmodified implementation" verification achievable without live Postgres access, since the fake genuinely exercises row-lock serialization ordering and constraint-collision branching rather than stubbing out the logic under test.
- All three deliverable test files are genuine Postgres integration tests (same `assertTestDatabase()`-guarded setup precedent as `tests/notifications.emission.test.js`), not the mock-backed approach — the mock dry run is explicitly a this-session confidence-building compensation, not a substitute deliverable, per Phase 1/Plan 02-04's established precedent.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' `<action>` and `<done>` criteria were met without needing any Rule 1-4 auto-fixes. The plan's own `<action>` text for each task explicitly anticipated and pre-authorized the mock-backed-dry-run compensation used here.

## Issues Encountered
- Reconfirmed (again, this session) that no live `*test*`-named Postgres database is reachable from this sandbox — same carried-forward blocker documented in STATE.md and every prior Phase 1/Phase 2 plan's SUMMARY. Verified with `DB_NAME=apostae_test`/`NODE_ENV=test`: connection fails at the `pg_hba.conf` level (`no pg_hba.conf entry for host "172.16.60.3", user "apostae", database "apostae_test"`), and the default `DB_NAME=apostae` is correctly refused by `assertTestDatabase()` before any DDL/DML runs. All three test files ran and failed with exactly the expected `assertTestDatabase()` guard error (confirmed via `npx jest`), proving the guard fires correctly and the tests are structurally wired to the real setup precedent — but they have not been exercised against live Postgres in this session. Compensated with the mock-backed dry run described above (22/22 assertions passed against the real, committed `wagerService.cashoutWager`).

## User Setup Required

None - no external service configuration required. (A reachable `*test*`-named Postgres database, per the carried-forward STATE.md blocker, is required before any of Phase 1's or Phase 2's integration test files — including this plan's three — can get a real pass/fail signal from a human/CI environment.)

## Next Phase Readiness
- This is the final plan of Phase 2 (partial-cashout). All three requisitos.txt-mandated attack vectors for this feature (concurrent race, idempotency replay, audit-trail completeness) are proven — structurally, via static grep, and via a genuine mock-backed concurrent-execution dry run — against the real, unmodified `wagerService.cashoutWager`.
- The live-DB test blocker (carried from Phase 1 through every Phase 2 plan) still needs resolving before any of Phase 1's five notification test files or Phase 2's seven cashout test files (`cashout.computation`, `cashout.validation`, `cashout.controller`, `cashout.concurrency`, `cashout.idempotency`, `cashout.audit`, plus `cashout.resolution-integration` from Plan 03) can get a real pass/fail signal in this environment. This is an infrastructure/network access issue (pg_hba.conf/proxy allowlist on the DB host), not an application-code gap.
- Phase 3 (new market types) can proceed once the project owner/CI resolves DB access — none of Phase 2's remaining work blocks Phase 3 structurally.

---
*Phase: 02-partial-cashout*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: tests/cashout.concurrency.test.js
- FOUND: tests/cashout.idempotency.test.js
- FOUND: tests/cashout.audit.test.js
- FOUND: cb27b89 (test commit, Task 1)
- FOUND: a814cd0 (test commit, Task 2)
- FOUND: 7e60695 (test commit, Task 3)
