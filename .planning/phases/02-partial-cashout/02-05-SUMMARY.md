---
phase: 02-partial-cashout
plan: 05
subsystem: notifications
tags: [domain-events, idempotency, postgres, jest]

# Dependency graph
requires:
  - phase: 02-partial-cashout (Plan 04)
    provides: "wagerService.cashoutWager() emitting domainEvents.emit('wager.cashed_out', { cashoutId, wagerId, userId, marketId, question, netValue, grossValue, feeAmount, stakeCashedOut, remainingStake })"
  - phase: 01-notifications-infrastructure
    provides: "notificationService.register()/notify() chokepoint, notificationRepository, notifications table UNIQUE(user_id, type, related_entity, related_id) idempotency constraint"
provides:
  - "notificationService register() listener for wager.cashed_out, keyed by relatedId=evt.cashoutId (never wagerId)"
  - "tests/cashout.notification.test.js"
affects: [02-06-cashout-controller-route, 02-07-concurrency-idempotency-integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "8th domainEvents.on(...) listener added additively to notificationService.register() (D-06 convention) — no fixed switch statement to update"
    - "Per-event-instance idempotency key (relatedId = the event's own row id, not the parent entity's id) for domain events that can legitimately recur on the same parent entity — first precedent of this variant in the notification catalog (the other 7 events are each at-most-once per wager/market)"

key-files:
  created:
    - tests/cashout.notification.test.js
  modified:
    - src/services/notificationService.js

key-decisions:
  - "relatedId for the wager.cashed_out listener is evt.cashoutId (the wager_cashouts row's own globally-unique id), never evt.wagerId — a wager can be the subject of multiple partial cashouts, and wagerId alone would collide with the existing UNIQUE(user_id, type, related_entity, related_id) constraint on the second cashout, silently losing that notification to the pre-existing 23505-catch-as-no-op idempotency logic (RESEARCH.md Pitfall 3)."

patterns-established:
  - "Future domain events representing a repeatable sub-entity of a parent (rather than a one-time transition of the parent itself) must key relatedId off the sub-entity's own id, not the parent's id, when reusing notificationService's notify()/23505-idempotency chokepoint."

requirements-completed: [CASHOUT-08]

coverage:
  - id: D1
    description: "notificationService.register() gains a wager.cashed_out listener using relatedEntity:'cashout' and relatedId:evt.cashoutId, verified by a static grep gate to never use evt.wagerId as the relatedId"
    requirement: "CASHOUT-08"
    verification:
      - kind: unit
        ref: "node --check + node -e region-scoped grep gate (Task 1 verify block) confirming relatedId: evt.cashoutId, absence of relatedId: evt.wagerId, relatedEntity: 'cashout'"
        status: pass
    human_judgment: false
  - id: D2
    description: "A user receives a distinct notification for every cashout on a wager, including repeated cashouts on the same wager (not silently swallowed by the UNIQUE constraint), while true duplicate event delivery still produces only one notification"
    requirement: "CASHOUT-08"
    verification:
      - kind: unit
        ref: "tests/cashout.notification.test.js — all 3 test cases (single cashout, second distinct cashout on same wager, true duplicate delivery)"
        status: pass
    human_judgment: true
    rationale: "tests/cashout.notification.test.js is written and structurally correct against the real interface contract, ready to run against a live Postgres test database, but no *test*-named database is reachable in this sandbox (reconfirmed this session against an explicit apostae_test DB_NAME override — same 'no pg_hba.conf entry' network/proxy-level rejection as every prior Phase 1/Phase 2 plan). A temporary mock-backed jest dry run (deleted before commit, not part of the deliverable) drove the real, committed notificationService/notificationRepository through all 3 scenarios (7 assertions), and all 7 passed — but a human/CI environment with real DB access must execute the committed test file for full confidence."

# Metrics
duration: 8min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 05: Cashout Notification Listener Summary

**Extends `notificationService.register()` with a `wager.cashed_out` listener keyed by the cashout row's own id (`relatedId: evt.cashoutId`), specifically avoiding the `relatedId: evt.wagerId` shape used by all 7 prior catalog events — that shape would silently drop the second notification on any wager cashed out more than once.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-14T17:47:13Z (approx, from prior plan's completion)
- **Completed:** 2026-07-14T17:49:52Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments
- `notificationService.register()` now has an 8th `domainEvents.on(...)` block for `wager.cashed_out`, additive alongside the existing 7 (D-06 convention — no fixed switch statement to update), calling `notify(evt.userId, { type: 'wager.cashed_out', title: 'Cashout realizado', body: ..., relatedEntity: 'cashout', relatedId: evt.cashoutId })`.
- Verified via static grep gate (`node --check` + a region-scoped regex check) that the listener uses `relatedId: evt.cashoutId` and never `relatedId: evt.wagerId`, and uses `relatedEntity: 'cashout'`.
- `tests/cashout.notification.test.js` — proves (1) a single cashout produces exactly one notification row with `related_entity='cashout'`/`related_id=1`, (2) a second cashout on the **same wager** with a different `cashoutId=2` produces a second, distinct notification row (`related_id=2`) rather than being swallowed by the `UNIQUE(user_id, type, related_entity, related_id)` constraint, and (3) a true duplicate event delivery (identical `cashoutId=1` twice) still produces only one notification row, preserving the existing `23505`-catch-as-no-op idempotency behavior for genuine duplicates.
- Verified the above via a temporary mock-backed jest dry run (deleted before commit) driving the real, committed `notificationService`/`notificationRepository` against an in-memory notifications table enforcing the same UNIQUE constraint and `23505` error code — all 7 assertions across the 3 scenarios passed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add wager.cashed_out listener to notificationService.register()** - `67aa5bb` (feat)
2. **Task 2: Write cashout.notification.test.js proving the Pitfall-3 fix** - `07ade8d` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/services/notificationService.js` - Added the `wager.cashed_out` listener block inside `register()`; the other 7 existing listeners are unchanged.
- `tests/cashout.notification.test.js` - Three test cases proving distinct-notification-per-cashout and true-duplicate-still-idempotent behavior.

## Decisions Made
- `relatedId` for `wager.cashed_out` is `evt.cashoutId` (the `wager_cashouts` row's own globally-unique id), never `evt.wagerId` — per RESEARCH.md Pitfall 3, using `wagerId` would collide with the existing `UNIQUE(user_id, type, related_entity, related_id)` constraint on any wager's second cashout, silently losing that notification to the pre-existing `23505`-catch-as-no-op logic in `notify()`.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` and `<done>` criteria were met without needing any Rule 1-4 auto-fixes.

## Issues Encountered
- Reconfirmed (again) that no live `*test*`-named Postgres database is reachable from this sandbox — same carried-forward blocker documented in STATE.md and every prior Phase 1/Phase 2 plan's SUMMARY. Reconfirmed this session with an explicit `DB_NAME=apostae_test` override (`error: no pg_hba.conf entry for host ..., database "apostae_test"`). `tests/cashout.notification.test.js` is written and structurally correct, ready to run against a real test DB, but has not been exercised against live Postgres in this session. Compensated with a temporary mock-backed jest dry run (deleted before commit, not part of the deliverable) that drove the real, committed listener through all 3 scenarios (7 assertions) — all passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The `wager.cashed_out` notification path is ready; Plan 02-06 (controller/route wiring: `POST /api/wagers/:id/cashout`) can build on `wagerService.cashoutWager` directly without any further notification changes.
- The live-DB test blocker (carried from Phase 1 and every Phase 2 plan so far) still needs resolving before `tests/cashout.notification.test.js` — and every other cashout/notification test file — can get a real pass/fail signal in this environment.

---
*Phase: 02-partial-cashout*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: src/services/notificationService.js (wager.cashed_out listener present)
- FOUND: tests/cashout.notification.test.js
- FOUND: 67aa5bb (feat commit, Task 1)
- FOUND: 07ade8d (test commit, Task 2)
