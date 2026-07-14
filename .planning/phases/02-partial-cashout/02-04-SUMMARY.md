---
phase: 02-partial-cashout
plan: 04
subsystem: payments
tags: [postgres, transactions, row-locking, idempotency, money-math, jest]

# Dependency graph
requires:
  - phase: 02-partial-cashout (Plan 01)
    provides: src/utils/money.js (multiply/applyFeePercent), migration 004 (wager_cashouts + wagers.cashed_out_amount), env.CASHOUT_FEE_PERCENT, testDb.js seedOpenMarket()/seedWager()/applyCashoutMigration()
  - phase: 02-partial-cashout (Plan 02)
    provides: cashoutRepository.create()/findByIdempotencyKey(), wagerRepository.findByIdForUpdate() (IDOR-safe), marketRepository.findByIdForUpdate()
  - phase: 02-partial-cashout (Plan 03)
    provides: marketService.resolveMarket() remaining-fraction payout scaling (keeps cashoutWager's cashed_out_amount writes consistent with resolution)
provides:
  - wagerService.cashoutWager(wagerId, userId, { amount, idempotencyKey }) — the core partial-cashout financial transaction
  - wagerRepository.incrementCashedOutAmount(id, stake, client)
  - tests/cashout.computation.test.js, tests/cashout.validation.test.js
affects: [02-05-notification-listener-and-cashout-endpoint, 02-06-cashout-controller-route, 02-07-concurrency-idempotency-integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fourth financial state-machine transition (alongside placeWager/cancelWager/resolveMarket) reusing the exact transaction()+FOR UPDATE+emit-after-commit shape"
    - "Fixed market->wager->wallet lock ordering (matches placeWager/resolveMarket/deleteMarket, deliberately NOT cancelWager's opposite order)"
    - "INSERT-then-catch-23505-and-replay for idempotent financial writes that must return the original committed result to the caller (distinct from notificationService's silent-no-op idempotency variant)"

key-files:
  created:
    - tests/cashout.computation.test.js
    - tests/cashout.validation.test.js
  modified:
    - src/services/wagerService.js
    - src/repositories/wagerRepository.js

key-decisions:
  - "On an idempotent-replay path, the response shape (netValue/grossValue/feeAmount/stakeCashedOut) is read back from the already-committed wager_cashouts row (cashout.net_value etc.), not recomputed from the current request — guarantees a retried request gets byte-identical values to the original, even if float/env inputs somehow differed on the retry."
  - "domainEvents.emit('wager.cashed_out', ...) fires unconditionally after transaction() resolves, including on the idempotent-replay path — matches this codebase's existing 'emit is best-effort, consumer owns dedup' convention (Plan 02-05's listener will be the one responsible for not double-notifying, per the plan's own explicit instruction)."

patterns-established:
  - "Any future financial write needing 'return the same result on retry' (not just 'no-op on retry') should use the INSERT-then-catch-23505-then-findByIdempotencyKey-and-replay shape established here, not the simpler notificationService no-op pattern."

requirements-completed: [CASHOUT-01, CASHOUT-02, CASHOUT-04, CASHOUT-05, CASHOUT-06, CASHOUT-07, CASHOUT-09, CASHOUT-10]

coverage:
  - id: D1
    description: "cashoutWager computes gross/fee/net entirely server-side via money.js (stake x odds_at_time, minus fee) and returns that value regardless of any client-submitted monetary field in the request"
    requirement: "CASHOUT-01"
    verification:
      - kind: unit
        ref: "tests/cashout.computation.test.js — 'cashout de 30 numa aposta de 100/odds=2 devolve net=60, gross=60 (fee=0)' and 'valores monetários extras enviados pelo chamador ... são ignorados'"
        status: pass
    human_judgment: true
    rationale: "Both test files are written against the real interface contract and are ready to run against a live Postgres test database, but no *test*-named database is reachable in this sandbox (confirmed again this session against both the default 'apostae' DB_NAME, which assertTestDatabase() correctly refuses, and an explicit apostae_test override, which fails at the pg_hba.conf/network level — same carried-forward blocker as every prior Phase 1/Phase 2 plan). A temporary mock-backed jest dry run (deleted before commit, not part of the deliverable) drove the real, committed cashoutWager through all 15 scenarios across both test files plus the idempotency-replay and rollback-emits-nothing guarantees, and all 15 passed — but a human/CI environment with real DB access must execute the committed test files for full confidence."
  - id: D2
    description: "Client-submitted monetary fields (fake netValue/payout/grossValue alongside amount/idempotencyKey) are never read — the method destructures only { amount, idempotencyKey }"
    requirement: "CASHOUT-02"
    verification:
      - kind: unit
        ref: "tests/cashout.computation.test.js — attacker-controlled-fields-ignored test; region-scoped grep gate in Task 1 verify block"
        status: pass
    human_judgment: true
    rationale: "Same live-DB-unreachable caveat as D1 — structurally and dry-run verified, needs live-DB execution for full confidence."
  - id: D3
    description: "Requests with amount<=0 are rejected with ValidationError before any lock is acquired; requests against a closed market or a non-pending wager are rejected with ConflictError after locks are held (re-validated, not trusted from a pre-lock read)"
    requirement: "CASHOUT-04, CASHOUT-05"
    verification:
      - kind: unit
        ref: "tests/cashout.validation.test.js — all 5 rejection-path tests"
        status: pass
    human_judgment: true
    rationale: "Same live-DB-unreachable caveat as D1 — structurally and dry-run verified (all 5 rejection scenarios plus the rollback-emits-nothing assertion passed against the real committed code), needs live-DB execution for full confidence."
  - id: D4
    description: "Concurrent cashouts on the same wager cannot both succeed — enforced via the fixed market->wager->wallet FOR UPDATE lock order, matching placeWager/resolveMarket/deleteMarket"
    requirement: "CASHOUT-06"
    verification:
      - kind: unit
        ref: "node -e structural grep gate (Task 1 verify block) confirming findByIdForUpdate usage in lock-acquisition order; source read-back confirms market lock precedes wager lock precedes wallet lock"
        status: pass
    human_judgment: true
    rationale: "The lock ordering is structurally guaranteed by the code as written (verified by reading the committed method back), but genuine concurrent-request contention (two simultaneous cashouts actually blocking on the same row) requires a live Postgres instance and Promise.all-driven concurrency test — deferred to Plan 02-07 per the phase's own test map (tests/cashout.concurrency.test.js), consistent with RESEARCH.md's Wave 0 gap list."
  - id: D5
    description: "A retried request with the same idempotency key returns the identical committed result without re-applying the wallet credit or the cashed_out_amount increment"
    requirement: "CASHOUT-07"
    verification:
      - kind: unit
        ref: "temporary mock-backed jest dry run (deleted before commit) — 'idempotent replay returns identical netValue' / 'does not double-increment cashed_out_amount' / 'does not re-credit wallet', all passed"
        status: pass
    human_judgment: true
    rationale: "The 23505-catch-and-replay code path is structurally present (grep-gated) and was exercised end-to-end in the mock dry run with a real duplicate-key collision simulated, but the actual Postgres-enforced UNIQUE(wager_id, idempotency_key) constraint (migration 004) has not been exercised against a live database in this sandbox — same carried-forward blocker as D1/D2/D3."
  - id: D6
    description: "cashoutWager never reads, filters, or branches on the wager's binary yes/no selection field (choice) anywhere in its logic — market-type-agnostic ahead of Phase 3"
    requirement: "CASHOUT-09"
    verification:
      - kind: unit
        ref: "node -e region-scoped grep gate (Task 1 verify block) confirming zero '.choice' references inside cashoutWager's method body; tests/cashout.computation.test.js proves identical behavior for choice='yes' and choice='no'"
        status: pass
    human_judgment: false
  - id: D7
    description: "All money math (gross = stake * odds_at_time, fee/net via applyFeePercent) goes through the shared src/utils/money.js utility — no raw float arithmetic inline in cashoutWager"
    requirement: "CASHOUT-10"
    verification:
      - kind: unit
        ref: "source read-back confirms money.multiply/money.applyFeePercent calls, no inline Math.round(x*100)/100; tests/money.test.js (Plan 01) already covers the utility's own anti-drift guarantee"
        status: pass
    human_judgment: false

# Metrics
duration: 10min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 04: Cashout Transaction Summary

**`wagerService.cashoutWager()` — the phase's core money-moving transaction: locks market→wager→wallet in that fixed order, revalidates every business invariant post-lock, computes the stake-proportional payout server-side via `money.js`, persists idempotently with 23505-catch-and-replay, credits the wallet with a matching audit record, and emits `wager.cashed_out` strictly after commit.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-14T17:40:00Z (approx, from prior plan's completion commit)
- **Completed:** 2026-07-14T17:44:56Z
- **Tasks:** 2 completed
- **Files modified:** 4 (2 modified, 2 created)

## Accomplishments
- `wagerService.cashoutWager(wagerId, userId, { amount, idempotencyKey })` — validates input pre-lock (positive amount, non-empty idempotency key), then inside a single `transaction()`: locks `markets` → `wagers` → `wallets` in that fixed order (matching `placeWager`/`resolveMarket`/`deleteMarket`, never `cancelWager`'s opposite order), re-validates `market.status === 'open'` and `wager.status === 'pending'` post-lock, rejects any request that would leave the remaining stake at or below zero, computes `gross`/`fee`/`net` via `money.js`, persists the cashout row idempotently (23505-catch-and-replay-existing), increments `wagers.cashed_out_amount`, credits the wallet via `walletRepository.adjustBalance` + `recordTransaction` (`type: 'credit'`, `relatedEntity: 'cashout'`), and emits `wager.cashed_out` strictly after the transaction promise resolves.
- `wagerRepository.incrementCashedOutAmount(id, stake, client)` — additive-only cumulative update, matching `updateStatus`'s existing client-param shape.
- `tests/cashout.computation.test.js` — proves the formula (net=60 on stake=30/odds=2/fee=0), proves client-submitted monetary fields alongside `amount`/`idempotencyKey` are never read, and proves identical behavior for `choice='yes'` and `choice='no'` (CASHOUT-09's market-type-agnostic guarantee).
- `tests/cashout.validation.test.js` — proves every rejection path (`amount<=0`, closed market, non-pending wager, exact-remaining-stake) throws the correct error class, and that the two `ConflictError` rejection paths never leak a `wager.cashed_out` event (D-01's rollback-emits-nothing guarantee).
- Verified all of the above (plus idempotency-replay behavior not required by the plan's tests but directly relevant to CASHOUT-07) via a temporary mock-backed jest dry run (deleted before commit) since no live test-DB is reachable in this sandbox — all 15 assertions passed against the real, committed `cashoutWager`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement wagerService.cashoutWager and wagerRepository.incrementCashedOutAmount** - `b9cfec5` (feat)
2. **Task 2: Write cashout.computation.test.js and cashout.validation.test.js** - `825b89c` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/services/wagerService.js` - Added `cashoutWager()` method plus `marketRepository`/`cashoutRepository`/`money`/`env` imports
- `src/repositories/wagerRepository.js` - Added `incrementCashedOutAmount(id, stake, client)`, additive only
- `tests/cashout.computation.test.js` - Formula-correctness, client-value-ignored, and market-agnostic tests (CASHOUT-01/02/09)
- `tests/cashout.validation.test.js` - Every rejection path plus rollback-emits-nothing guarantee (CASHOUT-04/05, D-01)

## Decisions Made
- On an idempotent-replay path, the returned `netValue`/`grossValue`/`feeAmount`/`stakeCashedOut` are read back from the already-committed `wager_cashouts` row (via the fields on the `cashout` object returned by `findByIdempotencyKey`), not recomputed from the current request's inputs — guarantees byte-identical values on retry regardless of any incidental difference in the retried request.
- `domainEvents.emit('wager.cashed_out', ...)` fires unconditionally after `transaction()` resolves, including on the idempotent-replay branch, per the plan's explicit instruction — matches this codebase's "emit is best-effort, consumer owns dedup" convention; Plan 02-05's listener is responsible for not double-notifying on a replayed emit.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` and `<done>` criteria were met without needing any Rule 1-4 auto-fixes.

## Issues Encountered
- Confirmed (again) that no live `*test*`-named Postgres database is reachable from this sandbox — same carried-forward blocker documented in STATE.md and every prior Phase 1/Phase 2 plan's SUMMARY. Reconfirmed this session with both the default `DB_NAME=apostae` (correctly rejected by `assertTestDatabase()`) and an explicit `DB_NAME=apostae_test` override (rejected at the network/`pg_hba.conf` level: `no pg_hba.conf entry for host ... database "apostae_test"`). Both `tests/cashout.computation.test.js` and `tests/cashout.validation.test.js` are written and structurally correct, ready to run against a real test DB, but have not been exercised against live Postgres in this session. Compensated with a temporary mock-backed jest dry run (deleted before commit, not part of the deliverable) that drove the real, committed `wagerService.cashoutWager` through all 15 scenarios across both files plus idempotency-replay and rollback-emits-nothing checks — all 15 passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `wagerService.cashoutWager` is ready for Plan 02-05 (notification listener: `wager.cashed_out` → `notificationService`, using `relatedEntity: 'cashout'`/`relatedId: cashoutId`, never `relatedId: wagerId`) and Plan 02-06 (controller/route wiring: `POST /api/wagers/:id/cashout`) to build on directly.
- The live-DB test blocker (carried from Phase 1 and every Phase 2 plan so far) still needs resolving before `tests/cashout.computation.test.js`/`tests/cashout.validation.test.js` — and the concurrency/idempotency integration tests planned for 02-07 — can get a real pass/fail signal in this environment.
- CASHOUT-06's concurrency guarantee is structurally established here (fixed lock order) but its live-contention proof (`Promise.all`-driven simultaneous requests) is explicitly deferred to Plan 02-07 per the phase's test map — not a gap introduced by this plan, a planned later verification step.

---
*Phase: 02-partial-cashout*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: src/services/wagerService.js (cashoutWager present)
- FOUND: src/repositories/wagerRepository.js (incrementCashedOutAmount present)
- FOUND: tests/cashout.computation.test.js
- FOUND: tests/cashout.validation.test.js
- FOUND: b9cfec5 (feat commit, Task 1)
- FOUND: 825b89c (test commit, Task 2)
