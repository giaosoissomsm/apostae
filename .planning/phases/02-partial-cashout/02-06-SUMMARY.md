---
phase: 02-partial-cashout
plan: 06
subsystem: api
tags: [express, jest, wagers, cashout, controllers, mass-assignment]

# Dependency graph
requires:
  - phase: 02-partial-cashout (Plan 04)
    provides: wagerService.cashoutWager(wagerId, userId, { amount, idempotencyKey }) — the core partial-cashout financial transaction
provides:
  - "POST /api/wagers/:id/cashout — authenticated HTTP endpoint exposing wagerService.cashoutWager"
  - "wagersController.cashoutWager handler (catchAsync-wrapped, whitelist-only body destructuring)"
  - "tests/cashout.controller.test.js — controller-boundary proof against mass-assignment/parameter-tampering"
affects: [02-07-concurrency-idempotency-integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Controller-level whitelist destructuring ({ amount, idempotency_key } only) as the last line of defense against mass-assignment/parameter-tampering, verified with jest.mock('../src/services/wagerService') isolating the HTTP boundary from the real transaction"

key-files:
  created:
    - tests/cashout.controller.test.js
  modified:
    - src/controllers/wagersController.js
    - src/routes/wagers.js

key-decisions:
  - "Single-endpoint compute-and-execute design (no separate quote step) per RESEARCH.md Assumption A3 — odds_at_time is immutable/pre-locked, so a two-step quote-then-confirm UX would double the API surface with no added safety."

requirements-completed: [CASHOUT-01, CASHOUT-02]

coverage:
  - id: D1
    description: "POST /api/wagers/:id/cashout requires auth (requireAuth) and reads userId only from req.user.id (JWT session), never from the request body"
    requirement: "CASHOUT-01"
    verification:
      - kind: unit
        ref: "tests/cashout.controller.test.js — 'ignora tentativa de mass-assignment (userId/wagerId/user_id falsos no corpo)'"
        status: pass
    human_judgment: false
  - id: D2
    description: "Controller destructures only { amount, idempotency_key } from req.body — no mass-assignment path for status/potential_payout/cashed_out_amount or any other field"
    requirement: "CASHOUT-02"
    verification:
      - kind: unit
        ref: "tests/cashout.controller.test.js — 'ignora tentativa de parameter-tampering (netValue/payout/value falsos no corpo)'"
        status: pass
    human_judgment: false
  - id: D3
    description: "wagerId always comes from req.params.id (coerced with Number(...)), never a client-submitted body field"
    requirement: "CASHOUT-01"
    verification:
      - kind: unit
        ref: "tests/cashout.controller.test.js — 'encaminha exatamente (wagerId, userId, { amount, idempotencyKey })'"
        status: pass
    human_judgment: false

# Metrics
duration: 9min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 06: Cashout Controller Route Summary

**`POST /api/wagers/:id/cashout` wired to `wagerService.cashoutWager`, with the controller destructuring only `{ amount, idempotency_key }` from the request body — wagerId from `req.params.id`, userId exclusively from `req.user.id` — proven at the HTTP boundary with a mocked-service controller test.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-14T18:00:00Z (approx)
- **Completed:** 2026-07-14T18:09:00Z
- **Tasks:** 2 completed
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments
- `wagersController.cashoutWager` — `catchAsync`-wrapped handler matching the exact shape of the existing `cancelWager` handler: destructures only `{ amount, idempotency_key }` from `req.body`, forwards `Number(req.params.id)` and `req.user.id` to `wagerService.cashoutWager`, and passes the result straight through to `res.json(...)`.
- `POST /api/wagers/:id/cashout` route registered in `src/routes/wagers.js` with `requireAuth`, below the existing `DELETE /:id` route, no additional middleware.
- `tests/cashout.controller.test.js` — 4 tests using `jest.mock('../src/services/wagerService')` to isolate the controller from the real transaction, proving: (1) valid params/user/body are forwarded exactly as `(wagerId, userId, { amount, idempotencyKey })`; (2) a body-supplied `userId`/`wagerId`/`user_id` never overrides `req.params.id`/`req.user.id`; (3) a body-supplied `netValue`/`payout`/`value` never reaches the service call (third argument is exactly `{ amount, idempotencyKey }`, verified via `Object.keys(...).sort()`); (4) `res.json` is a direct passthrough of the mocked service's resolved value.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add cashoutWager controller handler and POST /:id/cashout route** - `d9ab618` (feat)
2. **Task 2: Write cashout.controller.test.js — mass-assignment and parameter-tampering attack vectors** - `c6affec` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/controllers/wagersController.js` - Added `cashoutWager` handler; exported alongside `placeWager`/`cancelWager`/`getUserWagers`
- `src/routes/wagers.js` - Added `router.post('/:id/cashout', requireAuth, wagersController.cashoutWager)`
- `tests/cashout.controller.test.js` - 4 tests proving the mass-assignment/parameter-tampering boundary (CASHOUT-01/02)

## Decisions Made
- No new decisions beyond what Plan 02-04's RESEARCH.md already established (single-endpoint compute-and-execute design, no separate quote step).

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` and `<done>` criteria were met without needing any Rule 1-4 auto-fixes.

## Issues Encountered
- `src/controllers/wagersController.js` and `src/routes/wagers.js` existed on disk with their pre-existing `placeWager`/`cancelWager`/`getUserWagers` handlers but had never been committed to git (confirmed via `git log --all -- <path>` returning nothing, and the project's initial git status snapshot showing both as untracked `??`) — consistent with PROJECT.md's noted "in-progress work predating this planning session" for several core files. Task 1's commit therefore necessarily includes the full pre-existing content of both files alongside this plan's additions; this is expected given the files' git history (or lack thereof) and not a scope deviation — no code beyond the plan's specified `cashoutWager` handler/route was authored.
- Same carried-forward blocker as every prior Phase 1/Phase 2 plan: no live `*test*`-named Postgres database is reachable from this sandbox. Not relevant to this plan's own test file, since `tests/cashout.controller.test.js` uses `jest.mock('../src/services/wagerService')` and requires no database connection — it ran and passed directly (`npx jest tests/cashout.controller.test.js` — 4/4 passed).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `POST /api/wagers/:id/cashout` is live and ready for Plan 02-07's concurrency/idempotency integration tests, which will exercise the full HTTP-to-database path (real Postgres required, same carried-forward blocker as Plans 02-01 through 02-05).
- The live-DB test blocker does not affect this plan's own deliverable (controller-boundary test only), but still needs resolving before `tests/cashout.computation.test.js`, `tests/cashout.validation.test.js`, and Plan 02-07's planned `tests/cashout.concurrency.test.js` can get a real pass/fail signal in this environment.

---
*Phase: 02-partial-cashout*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: src/controllers/wagersController.js (cashoutWager present)
- FOUND: src/routes/wagers.js (POST /:id/cashout present)
- FOUND: tests/cashout.controller.test.js
- FOUND: d9ab618 (feat commit, Task 1)
- FOUND: c6affec (test commit, Task 2)
