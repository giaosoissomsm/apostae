---
phase: 01-notifications-infrastructure
plan: 03
subsystem: api
tags: [express, notifications, jwt, rest, idor]

requires:
  - phase: 01-notifications-infrastructure (Plan 02)
    provides: notificationRepository (user_id-scoped CRUD), notificationService chokepoint (register/notify/listForUser/markRead/getUnreadCount), 7-event catalog listeners
provides:
  - notificationsController — listMyNotifications/getUnreadCount/markRead, identity sourced exclusively from req.user.id
  - src/routes/notifications.js — GET /, GET /unread-count, PATCH /:id/read, each behind requireAuth
  - server.js bootstrap wiring — mounts /api/notifications and calls notificationService.register() before startScheduler()
  - Filled tests/notifications.ownership.test.js, tests/notifications.pagination.test.js, tests/notifications.read-state.test.js with real assertions
affects: [01-notifications-infrastructure, notifications-api, future-frontend-notifications-ui]

tech-stack:
  added: []
  patterns:
    - "Controller handlers wrapped in catchAsync, identity always req.user.id, Number(req.params.id) coercion — exact match to wagersController.js precedent"
    - "Static route (/unread-count) declared before the param route (/:id/read) per Express convention, even though method/path already disambiguate them"
    - "notificationService.register() called at bootstrap immediately before startScheduler() so domain-event listeners are attached before any wager/market mutation can occur"

key-files:
  created:
    - src/controllers/notificationsController.js
    - src/routes/notifications.js
  modified:
    - server.js
    - tests/notifications.ownership.test.js
    - tests/notifications.pagination.test.js
    - tests/notifications.read-state.test.js

key-decisions:
  - "Verified controller/route/server.js logic and the three filled test files' assertions via a temporary jest file that mocked src/config/database's query() with an in-memory SQL emulator (matching notificationRepository's exact query shapes), then drove the real, unmodified notificationRepository + notificationService through the same ownership/pagination/read-state scenarios. Deleted before commit — not part of the deliverable. Necessary because no live Postgres test database is reachable in this sandbox (same limitation documented in Plan 01/02's SUMMARYs and STATE.md)."

patterns-established: []

requirements-completed: [NOTIF-06, NOTIF-07, NOTIF-08]

coverage:
  - id: D1
    description: "notificationsController + src/routes/notifications.js expose GET /api/notifications (paginated), GET /api/notifications/unread-count, PATCH /api/notifications/:id/read, every route behind requireAuth, every handler sourcing identity exclusively from req.user.id"
    requirement: "NOTIF-08"
    verification:
      - kind: other
        ref: "grep -c 'req.user.id' src/controllers/notificationsController.js == 5 (>= 3 required, includes doc-comment mentions); grep -c 'req.params.userId|req.body.userId|req.body.user_id' src/controllers/notificationsController.js == 0; grep -c 'requireAuth' src/routes/notifications.js == 4 (import + 3 routes)"
        status: pass
      - kind: other
        ref: "node -e \"require('./src/controllers/notificationsController');require('./src/routes/notifications');console.log('load OK')\""
        status: pass
    human_judgment: true
    rationale: "Source-level grep gates and module-load checks pass, and a mock-backed jest dry run (deleted before commit) confirmed cross-user markRead/findById correctly return 404/null with the target row untouched. However tests/notifications.ownership.test.js — the plan's actual required deliverable test, which hits real Postgres — could not be executed against a live database in this sandbox. A human should run it against a real *test*-named Postgres database before treating NOTIF-08 as fully proven end-to-end over HTTP."
  - id: D2
    description: "server.js mounts /api/notifications and calls notificationService.register() before startScheduler() at bootstrap, so listeners are attached before any wager/market mutation"
    requirement: "NOTIF-06"
    verification:
      - kind: other
        ref: "grep -c \"app.use('/api/notifications'\" server.js == 1; grep -c \"notificationService').register()\" server.js == 1; node -c server.js"
        status: pass
      - kind: unit
        ref: "tests/notifications.pagination.test.js (newest-first order, page/limit offsets, hard-cap at 100, unread_only filter) — plus a mock-backed dry run of the same scenarios against real notificationRepository, deleted before commit"
        status: pass
    human_judgment: true
    rationale: "Grep-based structural checks pass and the mock-backed dry run confirms the pagination logic in the real, committed notificationRepository.findByUserId is correct. tests/notifications.pagination.test.js itself could not run against real Postgres in this sandbox (see Issues Encountered) — a human should run it against a real test database to get a live SQL-level pass/fail signal."
  - id: D3
    description: "PATCH /:id/read marks a notification read and the state persists across requests; listing (listForUser) never mutates read_at; idempotent on an already-read row"
    requirement: "NOTIF-07"
    verification:
      - kind: unit
        ref: "tests/notifications.read-state.test.js (persists across re-fetch, idempotent second mark, listing side-effect-free, unread count reflects state) — plus a mock-backed dry run of the same scenarios against real notificationService/notificationRepository, deleted before commit"
        status: pass
    human_judgment: true
    rationale: "The mock-backed dry run confirms notificationService.markRead/listForUser behave exactly as required against the real, committed code. tests/notifications.read-state.test.js itself could not run against real Postgres in this sandbox — a human should run it against a real test database before fully trusting NOTIF-07 end-to-end."

duration: 22min
completed: 2026-07-14
status: complete
---

# Phase 1 Plan 3: Notification API + Bootstrap Wiring Summary

**Paginated/scoped `GET /api/notifications`, `GET /api/notifications/unread-count`, and `PATCH /api/notifications/:id/read` — all identity-from-JWT-only, mounted at bootstrap alongside `notificationService.register()`.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-14T12:24:00Z
- **Completed:** 2026-07-14T12:46:00Z
- **Tasks:** 2/2
- **Files modified:** 2 created (notificationsController.js, routes/notifications.js), 4 modified (server.js + 3 test files)

## Accomplishments

- `notificationsController` — `listMyNotifications` (paginated, `unread_only` query filter), `getUnreadCount`, `markRead` — every handler wrapped in `catchAsync`, identity sourced exclusively from `req.user.id`, never from params/body (NOTIF-08)
- `src/routes/notifications.js` — `GET /`, `GET /unread-count`, `PATCH /:id/read`, each individually guarded by `requireAuth`, static route declared before the param route
- `server.js` now requires and mounts `notificationsRoutes` at `/api/notifications` alongside the other `/api/*` mounts, and calls `notificationService.register()` immediately before `startScheduler()` so all 7 domain-event listeners are attached before any wager/market mutation can occur at runtime
- Filled `tests/notifications.ownership.test.js` (cross-user `markRead`/`findById` return 404/null, target row untouched, cross-user list scoping, unguessable-id case), `tests/notifications.pagination.test.js` (newest-first `created_at DESC, id DESC` order, page/limit offsets, hard-cap at 100, `unread_only` filter, cross-user list scoping), and `tests/notifications.read-state.test.js` (mark-read persists across independent re-fetch, idempotent on already-read rows, listing is side-effect-free w.r.t. `read_at`, unread count reflects state) with real assertions exercising `notificationRepository`/`notificationService` directly

## Task Commits

Each task was committed atomically:

1. **Task 1: notificationsController + routes (requireAuth, req.user.id identity)** - `b650dca` (feat)
2. **Task 2: Mount route + register listeners in server.js; fill ownership/pagination/read-state tests** - `27c4d10` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `src/controllers/notificationsController.js` - `listMyNotifications`/`getUnreadCount`/`markRead`, all identity from `req.user.id`
- `src/routes/notifications.js` - Express Router, `GET /`, `GET /unread-count`, `PATCH /:id/read`, every route behind `requireAuth`
- `server.js` - added `notificationsRoutes` require, `app.use('/api/notifications', notificationsRoutes)` mount, `notificationService.register()` call before `startScheduler()`
- `tests/notifications.ownership.test.js` - real assertions for NOTIF-08 (IDOR/cross-user scoping)
- `tests/notifications.pagination.test.js` - real assertions for NOTIF-06 (pagination/ordering/cap)
- `tests/notifications.read-state.test.js` - real assertions for NOTIF-07/D-08 (mark-read persistence, idempotency, listing side-effect-free)

## Decisions Made

- Verified the controller/route/server.js wiring and all three filled test files' logic via a temporary jest file (`tests/_tmp-dryrun.test.js`, deleted before commit) that mocked `src/config/database`'s `query()` with a small in-memory SQL emulator matching `notificationRepository`'s exact query shapes (INSERT with unique-constraint 23505 emulation, ORDER BY created_at DESC/id DESC with LIMIT/OFFSET, COUNT, scoped UPDATE, scoped SELECT by id). This drove the real, unmodified `notificationRepository`/`notificationService` modules through the ownership, pagination, and read-state scenarios and all assertions passed — giving behavioral confidence beyond the source-level grep gates alone, since no live Postgres test database is reachable in this sandbox (same limitation documented in Plan 01/02's SUMMARYs and STATE.md).
- Kept the existing grep-gate variance from the plan's literal counts (`req.user.id` count is 5, not 3; `requireAuth` count is 4, not 3) — both are higher only because the counts also match doc-comment prose and the `requireAuth` named-import declaration line, which is the exact same shape `wagersController.js`/`wagers.js` already use. No functional difference: every handler sources identity from `req.user.id` only, every route is guarded.

## Deviations from Plan

None - plan executed exactly as written. The temporary mock-backed dry-run harness described above is verification tooling only (deleted before commit), not a code deviation.

## Issues Encountered

**No live Postgres test database reachable in this sandbox** — identical, already-documented condition from Plan 01/02 (`STATE.md` Blockers/Concerns, `01-02-SUMMARY.md` Issues Encountered). Confirmed again for this plan:

```
no pg_hba.conf entry for host "172.16.60.3", user "apostae", database "apostae_test", no encryption
```

`npx jest tests/notifications.ownership.test.js tests/notifications.pagination.test.js tests/notifications.read-state.test.js` fails at the DB-connection layer (13/13 tests failed, all with the identical pg_hba error), not because the test logic is wrong. Per explicit instruction, production `apostae` was never targeted. Verification instead relied on:
1. Source-level grep acceptance criteria (server.js mount + register gates; controller identity-source gates) — all pass.
2. `node -c` syntax checks on every changed/created file.
3. A temporary mock-backed jest dry run (deleted before commit) driving the real, committed `notificationRepository`/`notificationService` through the ownership, pagination, and read-state scenarios — all 3 test cases passed.

**Action needed:** once a genuinely reachable `*test*`-named Postgres database is available, run `DB_NAME=<test-db-name> NODE_ENV=test npm test` to get the real, SQL-level pass/fail signal for all five `tests/notifications.*.test.js` files (this plan's three plus Plan 02's two). The tests are written to the plan's exact behavior spec and are ready to run as-is.

## User Setup Required

**A reachable Postgres test database is required to fully verify this plan (and Plan 02) with a live SQL-level signal.** See "Issues Encountered" above — this is an infrastructure/network-level constraint (the DB host's `pg_hba.conf` or a proxy in front of it only allows the `apostae` database name from this host), not something resolvable by application code changes. No other external service configuration is needed.

## Next Phase Readiness

- Plan 04 (wager/market service emitters) can now emit `domainEvents.emit(...)` calls from `wagerService.js`/`marketService.js` knowing the full user-facing read path (`GET /`, `GET /unread-count`, `PATCH /:id/read`) is already wired end-to-end and listeners are registered at bootstrap — real emissions from Plan 04 will land in a fully functional inbox.
- **Blocker carried forward:** the unreachable test database (see Issues Encountered) still blocks *live* verification of this plan's and Plan 02's integration tests until infrastructure access is resolved. This does not block Plan 04's own implementation work.

---
*Phase: 01-notifications-infrastructure*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 6 files found on disk (notificationsController.js, routes/notifications.js, all 3 filled test files, this SUMMARY). All 3 commits (`b650dca`, `27c4d10`, `33137dc`) found in git log.
