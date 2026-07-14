---
phase: 01-notifications-infrastructure
plan: 01
subsystem: testing
tags: [jest, postgres, eventemitter, migrations, node]

requires: []
provides:
  - Jest test harness wired to `npm test` (serial, `--runInBand`)
  - Reusable Postgres test-DB fixture (`tests/helpers/testDb.js`) guarded to `*test*`-named databases
  - `notifications` table (migration 003) with idempotency UNIQUE constraint and keyset/unread indexes
  - Shared `domainEvents` EventEmitter singleton (crash-safe, generic event bus)
  - Five requirement-mapped pending test stubs for the notifications feature
affects: [01-notifications-infrastructure, notifications, testing]

tech-stack:
  added: [jest@^30]
  patterns:
    - "Postgres integration tests share one DB via jest --runInBand; tests/helpers/testDb.js enforces a DB_NAME-contains-'test' guard before any DDL/TRUNCATE"
    - "domainEvents is a generic Node EventEmitter singleton (require-cache backed) with a top-level 'error' listener so a bad handler can never crash the process"
    - "Migration files export { id, up: [sqlString...], down: [...] }, auto-discovered by filename sort order in scripts/migrate.js"

key-files:
  created:
    - jest.config.js
    - tests/helpers/testDb.js
    - src/migrations/003_notifications.js
    - src/events/domainEvents.js
    - tests/notifications.ownership.test.js
    - tests/notifications.idempotency.test.js
    - tests/notifications.pagination.test.js
    - tests/notifications.read-state.test.js
    - tests/notifications.events.test.js
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "tests/helpers/testDb.js lazy-requires src/migrations/003_notifications.js inside applyNotificationsMigration() (not at module top-level) so the helper module parses cleanly even before the migration file exists — required by Task 2's own acceptance criteria, which runs before Task 3 creates the migration."
  - "Jest devDependency install approved via blocking human-verify checkpoint (T-01-SC) before this run began; no runtime dependency added, no other new package introduced."

patterns-established:
  - "Pattern: integration-test DB safety guard — every destructive testDb helper function calls assertTestDatabase() first, which throws if env.DB_NAME lacks the substring 'test'."
  - "Pattern: domain event bus is name-agnostic infra (no fixed event-name switch, no domain-specific logic) — future emitters/subscribers (notifications, email, push) all share this one singleton."

requirements-completed: [NOTIF-09, NOTIF-10]

coverage:
  - id: D1
    description: "npm test runs Jest (not the echo stub) and exits 0 with all test files loading (5 suites, 5 pending todos)"
    requirement: "NOTIF-10"
    verification:
      - kind: other
        ref: "npm test (jest --runInBand) — Test Suites: 5 passed, 5 total; Tests: 5 todo, 5 total"
        status: pass
    human_judgment: false
  - id: D2
    description: "notifications table created by migration 003 with UNIQUE(user_id, type, related_entity, related_id) idempotency constraint and both required indexes (idx_notifications_user_created, idx_notifications_user_unread)"
    requirement: "NOTIF-09"
    verification:
      - kind: other
        ref: "node -e module-shape check (id/up array) — pass; grep -c UNIQUE(...) == 1; grep -c idx_notifications_user_unread == 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "domainEvents is a require-cache singleton EventEmitter with a top-level 'error' handler that prevents an unhandled 'error' emission from crashing the process, and contains no notification-domain coupling"
    requirement: "NOTIF-10"
    verification:
      - kind: other
        ref: "node -e singleton+error-safety probe script — printed 'singleton+error-safe OK'; grep -c \"on('error'\" == 1; grep -ci notification == 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "tests/helpers/testDb.js exports applyNotificationsMigration/truncateNotifications/closePool, all guarded to refuse operating on a non-test DB_NAME"
    verification:
      - kind: other
        ref: "node -e \"require('./tests/helpers/testDb.js')\" loads without throwing; source contains DB_NAME.includes('test') guard"
        status: pass
    human_judgment: false

duration: ~10min
completed: 2026-07-14
status: complete
---

# Phase 1 Plan 1: Notifications Infrastructure Foundation Summary

**Jest test harness (serial, Postgres-fixture-backed) wired to `npm test`, the `notifications` table migration with its idempotency constraint and indexes, and a crash-safe `domainEvents` EventEmitter singleton — the phase's shared foundation.**

## Performance

- **Started:** 2026-07-14 (resumed after Task 1 checkpoint approval)
- **Completed:** 2026-07-14
- **Tasks:** 4/4 (Task 1 was a pure approval gate, resolved by the user before this run; Tasks 2-4 executed and committed in this run)
- **Files modified:** 6 created, 2 modified (package.json, package-lock.json)

## Accomplishments

- `npm test` now runs Jest (`jest --runInBand`) instead of the `echo` stub; suite is green with 5 loaded stub files (5 `test.todo`, 0 failures)
- `tests/helpers/testDb.js` gives every later plan a reusable, safety-guarded Postgres fixture (`applyNotificationsMigration`, `truncateNotifications`, `closePool`) that refuses to run against any database whose name doesn't contain `test`
- `src/migrations/003_notifications.js` defines the `notifications` table with the `UNIQUE(user_id, type, related_entity, related_id)` idempotency constraint (T-01-02) and both required indexes (keyset-ready `idx_notifications_user_created`, fast-unread `idx_notifications_user_unread`)
- `src/events/domainEvents.js` establishes the single shared event-bus chokepoint (NOTIF-09) that later plans' emitters (`wagerService`, `marketService`) and subscribers (`notificationService`) will use, and the future realtime-delivery swap point (NOTIF-10)
- Five requirement-mapped pending test stubs give later plans a concrete home for real assertions: ownership (NOTIF-08), idempotency (NOTIF-09), pagination (NOTIF-06), read-state (NOTIF-07), events (NOTIF-01..05)

## Task Commits

Each task was committed atomically:

1. **Task 1: Approve test-framework dependency install (supply-chain gate)** - checkpoint, no commit (resolved by user approval prior to this run; see Checkpoint Resolution below)
2. **Task 2: Install Jest, wire npm test, and build the Postgres test-DB fixture** - `998f43c` (feat)
3. **Task 3: Create migration 003_notifications.js and the five failing test stubs** - `253e2a5` (feat)
4. **Task 4: Create the domainEvents EventEmitter singleton with crash-safety handler** - `92ff4fe` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `package.json` - `scripts.test` changed from `echo` stub to `jest --runInBand`; `jest` added to `devDependencies`
- `package-lock.json` - lockfile updated for the Jest devDependency tree
- `jest.config.js` - `testEnvironment: 'node'`, `testMatch: ['**/tests/**/*.test.js']`
- `tests/helpers/testDb.js` - Postgres test-DB fixture with `*test*`-DB safety guard
- `src/migrations/003_notifications.js` - `notifications` table migration (idempotency constraint + 2 indexes)
- `src/events/domainEvents.js` - generic `EventEmitter` singleton with crash-safe top-level `'error'` handler
- `tests/notifications.ownership.test.js` - NOTIF-08 stub
- `tests/notifications.idempotency.test.js` - NOTIF-09 stub
- `tests/notifications.pagination.test.js` - NOTIF-06 stub
- `tests/notifications.read-state.test.js` - NOTIF-07 stub
- `tests/notifications.events.test.js` - NOTIF-01..05 stub

## Decisions Made

- `tests/helpers/testDb.js` lazy-requires `src/migrations/003_notifications.js` inside `applyNotificationsMigration()` rather than at module top-level. Task 2's own acceptance criteria (`node -e "require('./tests/helpers/testDb.js')"` must load without throwing) runs before Task 3 creates the migration file; a top-level `require` would have thrown at that point. Deferred the require to call-time instead, which also matches normal Node lazy-loading style and has no behavioral downside.
- Jest devDependency install: pre-approved by the user via the blocking human-verify checkpoint (Task 1) before this run started — see Checkpoint Resolution.

## Checkpoint Resolution

Task 1 ("Approve test-framework dependency install (supply-chain gate)", `checkpoint:human-verify`, `gate="blocking-human"`) was resolved by the user prior to this run with an explicit "approved" response, confirming: (1) jest is the canonical JS test runner (OpenJS Foundation/Meta, tens of millions of weekly downloads), (2) the install is devDependency-only (`npm install --save-dev jest`, no runtime dependency added), and (3) no other new package is introduced this phase. This run proceeded directly to Task 2 without re-prompting.

## Deviations from Plan

None — plan executed exactly as written, aside from the lazy-require ordering fix documented above under Decisions Made (not a deviation from intended behavior, just an implementation-order necessity to satisfy Task 2's acceptance criteria as literally written).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Note: integration tests in later plans will require a dedicated Postgres database whose name contains `test` (e.g. `apostae_test`), pointed to via the standard `DB_*` env vars with `NODE_ENV=test` — this is documented in `tests/helpers/testDb.js`'s header comment but no test database currently exists in this environment; `tests/helpers/testDb.js`'s functions were verified via source/shape inspection and the safety-guard logic, not by connecting to a live test database (none of the five stub tests exercise the DB yet — they are `test.todo` placeholders).

## Next Phase Readiness

Plan 02+ can now: (1) write real assertions into the five stub test files against a live `*test*` Postgres DB using `tests/helpers/testDb.js`, (2) build `notificationRepository`/`notificationService`/`notificationsController`/routes against the `notifications` table, and (3) wire `domainEvents.emit(...)` calls into `wagerService`/`marketService` per `01-PATTERNS.md`. No blockers identified.

---
*Phase: 01-notifications-infrastructure*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 10 created files found on disk; all 3 task commits (`998f43c`, `253e2a5`, `92ff4fe`) found in git log.
