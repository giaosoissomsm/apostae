---
phase: 01-notifications-infrastructure
verified: 2026-07-14T14:05:33Z
status: human_needed
score: 1/5 must-haves fully verified (behavior-proven)
behavior_unverified: 4 # present + wired, but no live-Postgres test run could execute in this sandbox to prove the runtime behavior
overrides_applied: 0
behavior_unverified_items:
  - truth: "User receives a notification when a market they wagered in closes, resolves, or their wager wins/loses/is cancelled (NOTIF-01..05)"
    test: "Run `DB_NAME=<a *test*-named DB> NODE_ENV=test npm test` (or at minimum `npx jest tests/notifications.events.test.js tests/notifications.emission.test.js`) against a reachable Postgres test database."
    expected: "All 7 catalog-event tests in notifications.events.test.js and all 10 tests in notifications.emission.test.js pass — one correctly-scoped, correctly-worded row per event/recipient, and rollback paths produce zero rows."
    why_human: "No isolated Postgres test database is reachable from this sandbox (pg_hba.conf/proxy only allows the 'apostae' dev/prod DB); the safety guard in tests/helpers/testDb.js correctly refuses to run against it. Source code and test logic were read and confirmed correct (payload shapes, ordering, rollback assertions), but the actual SQL was never executed."
  - truth: "User can retrieve their own notifications as a paginated, newest-first list, each with a timestamp (NOTIF-06)"
    test: "Run `npx jest tests/notifications.pagination.test.js` against a reachable Postgres test database."
    expected: "Ordering (created_at DESC, id DESC), page/limit offsets, hard-cap-at-100, and unread_only filter all assert correctly against real rows."
    why_human: "Same DB-unreachability limitation as above; SQL (ORDER BY/LIMIT/OFFSET) was read and is correct, but not executed."
  - truth: "User can mark a notification as read, and the read/unread state persists across requests (NOTIF-07)"
    test: "Run `npx jest tests/notifications.read-state.test.js` against a reachable Postgres test database."
    expected: "mark-read persists on re-fetch, is idempotent, listing never mutates read_at, unread count reflects state."
    why_human: "Same DB-unreachability limitation; the state-transition (read_at UPDATE) was never exercised against real Postgres in this sandbox."
  - truth: "Every notification endpoint is ownership-scoped — a user can never read or mutate another user's notification, including by guessing IDs (NOTIF-08)"
    test: "Run `npx jest tests/notifications.ownership.test.js` against a reachable Postgres test database."
    expected: "Cross-user markRead/findById return 404/null, the foreign row's read_at stays untouched, listing never mixes users."
    why_human: "Same DB-unreachability limitation; the access-control state check was never exercised against real Postgres in this sandbox (though the query-level scoping is proven statically — every read/update method filters by user_id, confirmed by source read and grep)."
---

# Phase 1: Notifications Infrastructure Verification Report

**Phase Goal:** Users are notified of key wager and market status events, and can view/manage their notification inbox via a dedicated, ownership-scoped API — establishing the single chokepoint every later feature reuses to emit notifications.
**Verified:** 2026-07-14T14:05:33Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Environment Limitation (read before the findings below)

No isolated Postgres test database is reachable from this sandbox — only the real `apostae` dev/prod DB connects. `tests/helpers/testDb.js`'s `assertTestDatabase()` guard correctly refuses to run destructive/integration operations against it. Running `npm test` in this environment produces **33/33 failing assertions across all 6 notification test suites**, and every single failure is the identical guard error:

```
Recusando operar: DB_NAME="apostae" não contém "test". Os testes de integração exigem
um banco dedicado (ex.: apostae_test) configurado via variáveis DB_* com NODE_ENV=test.
```

This was independently re-confirmed in this verification pass (`npm test` run directly, full output grepped) — the failure is 100% the DB guard, not a mix of guard + real logic failures. This is a pre-existing, already-documented infrastructure gap (STATE.md Blockers/Concerns; called out identically in all 4 plan SUMMARYs), and the user has already been informed and chose to continue phase execution despite it.

Per explicit instruction for this verification pass: this is **not** treated as a hard verification failure. Instead, every truth whose full proof requires a live-DB test run is verified as far as static/source evidence allows (all four levels: exists, substantive, wired, and — via manual source reading — logically correct against the payload/behavior contract) and then routed to human verification for the final live-DB pass/fail signal. Test source code was read end-to-end (not merely assumed correct) — see Test Correctness Review below.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User receives a notification when a market they wagered in closes, resolves, or their wager wins, loses, or is cancelled (NOTIF-01..05) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | All 5 real call sites (`placeWager`, `cancelWager`, `closeMarket`, `resolveMarket`, `deleteMarket`) emit the correct `domainEvents` events strictly after commit (verified: 0 violations via brace-depth-counting script confirming no `domainEvents.emit` inside any `transaction(async (client) => {...})` block). `notificationService.register()` wires all 7 catalog events to `notify()`. Test files (`notifications.events.test.js`, `notifications.emission.test.js`) assert exact payloads and rollback-emits-nothing, and were read in full — logic is correct — but never executed against live Postgres in this sandbox. |
| 2 | User can retrieve their own notifications as a paginated, newest-first list, each with a timestamp (NOTIF-06, NOTIF-08) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `notificationRepository.findByUserId` builds `ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, hard-caps limit at 100 (`Math.min(Number(limit)\|\|20,100)`), returns `{data, pagination:{total,page,limit}}`; `created_at` present on every row (migration column). `GET /api/notifications` wired through controller→service→repository. `tests/notifications.pagination.test.js` asserts ordering/offset/cap/filter correctly but was not executed live. |
| 3 | User can mark a notification as read, and the read/unread state persists across requests (NOTIF-07) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `PATCH /api/notifications/:id/read` → `notificationService.markRead` → `notificationRepository.markRead` (`UPDATE ... SET read_at = CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2 AND read_at IS NULL`); idempotent already-read path returns existing row via `findById`. `listForUser`/`findByUserId` contain no UPDATE — listing is read-only, never mutates `read_at` (confirmed by source read). `tests/notifications.read-state.test.js` asserts persistence across independent re-fetch and side-effect-free listing but was not executed live. |
| 4 | Every notification endpoint (list, get-by-id via markRead, mark-read) is scoped to the requesting user — never another user's notification, including by guessing IDs | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Every repository read/update method includes `user_id` in its WHERE clause (`grep -c 'user_id = \$'` == 5, all 4 id-taking/scoped methods covered); `markRead`/`findById` return `NotFoundError`(404)/`null` on a non-owned id, never leaking existence (verified by source read of `notificationService.markRead`). Controller sources identity exclusively from `req.user.id` (`grep -c 'req.user.id'` == 3 handlers, 0 occurrences of `req.params.userId`/`req.body.userId`/`req.body.user_id`). `tests/notifications.ownership.test.js` asserts cross-user 404/null and untouched target row, but was not executed live. |
| 5 | All notification writes flow through a single shared chokepoint (domainEvents/notify()), not duplicated per call site, and no push transport is required this milestone (NOTIF-09, NOTIF-10) | ✓ VERIFIED | `grep -rl "require('../repositories/notificationRepository')" src --include=*.js` returns **only** `src/services/notificationService.js` — confirmed no other module in `src/` imports the repository. `notify()` catches Postgres `23505` locally (`err.code === '23505'` present, confirmed by source read) so duplicate delivery is a silent idempotent no-op, backed by the schema-level `UNIQUE(user_id,type,related_entity,related_id)` constraint in migration 003. `domainEvents.js` is a generic, name-agnostic `EventEmitter` singleton (require-cache backed, confirmed two `require()` calls return the same instance is asserted structurally; no notification-specific coupling in the bus itself — `grep -ci notification src/events/domainEvents.js` == 0) — no push/WebSocket/SSE transport implemented, and any future subscriber can attach via `domainEvents.on(...)` without touching existing code. This truth is structural/static (not a runtime state transition) and is fully provable without a live DB. |

**Score:** 1/5 truths fully VERIFIED; 4/5 present + wired but behavior-unverified (blocked on live-DB test execution, environment limitation, not a code defect).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `jest.config.js` | Jest test runner config | ✓ VERIFIED | `testEnvironment: 'node'`, `testMatch` covers `tests/**/*.test.js`; `npm test` runs `jest --runInBand` (not the old echo stub) |
| `tests/helpers/testDb.js` | Postgres test-DB fixture with safety guard | ✓ VERIFIED | `assertTestDatabase()` throws unless `DB_NAME` contains `test`; exports `applyNotificationsMigration`, `applyBaseSchema`, `applyWalletSchema`, `seedTestUser`, `seedWallet`, `truncateNotifications`, `wait`, `closePool` — all guarded |
| `src/migrations/003_notifications.js` | notifications table migration | ✓ VERIFIED | `{id:'003_notifications', up, down}` shape; `UNIQUE(user_id,type,related_entity,related_id)` present (1 match); both indexes present (`idx_notifications_user_created`, `idx_notifications_user_unread`); auto-discovered by `scripts/migrate.js`'s sorted `readdirSync` |
| `src/events/domainEvents.js` | Shared crash-safe EventEmitter singleton | ✓ VERIFIED | Generic `EventEmitter`, top-level `.on('error', ...)` handler present (1 match), no notification-domain coupling (0 matches for "notification") |
| `src/repositories/notificationRepository.js` | user_id-scoped CRUD | ✓ VERIFIED, WIRED | `create/findByUserId/markRead/findById/countUnread`, every read/update scoped by `user_id`, `cappedLimit = Math.min(...,100)`, parameterized throughout |
| `src/services/notificationService.js` | Sole chokepoint | ✓ VERIFIED, WIRED | Only importer of the repository (grep-confirmed); `register()`/`notify()`/`listForUser()`/`markRead()`/`getUnreadCount()` all present; 7 `domainEvents.on(` registrations |
| `src/controllers/notificationsController.js` | HTTP handlers | ✓ VERIFIED, WIRED | `listMyNotifications`/`getUnreadCount`/`markRead`, all `catchAsync`-wrapped, identity exclusively `req.user.id` |
| `src/routes/notifications.js` | Express router | ✓ VERIFIED, WIRED | `GET /`, `GET /unread-count`, `PATCH /:id/read`, each behind `requireAuth`; static route declared before param route |
| `tests/notifications.{ownership,idempotency,pagination,read-state,events}.test.js`, `tests/notifications.emission.test.js` | Real assertions per requirement | ✓ VERIFIED (source-level), ⚠️ UNEXECUTED (live DB) | All 6 files load (`npx jest --listTests` lists all 6); each contains real, non-stub assertions read end-to-end and confirmed logically correct against the plan's exact payload/behavior contract; none are `test.todo`/`.skip` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `server.js` | `src/routes/notifications.js` | `app.use('/api/notifications', notificationsRoutes)` | ✓ WIRED | 1 match; mounted alongside other `/api/*` routes, before static middleware |
| `server.js` bootstrap | `notificationService.register()` | called before `startScheduler()` | ✓ WIRED | 1 match at the correct bootstrap position (after migrations/defaults init, before scheduler start) |
| `wagerService.js`/`marketService.js` | `src/events/domainEvents.js` | `domainEvents.emit(...)` after `await transaction(...)` | ✓ WIRED | 5 emit call sites (wager.placed, wager.cancelled, market.closed, market.resolved+wager.won/lost, market.deleted); 0 violations found by a brace-depth-counting script checking no emit occurs textually inside any `transaction(async (client) => {...})` closure |
| `notificationService.register()` | `notificationRepository` (via `notify()`) | 7 `domainEvents.on(...)` listeners → `notify()` → `notificationRepository.create()` | ✓ WIRED | All 7 catalog events registered; `notify()` catches `23505` locally |
| `notificationsController` | `notificationService` | direct require + calls | ✓ WIRED | `listForUser`, `getUnreadCount`, `markRead` all called with `req.user.id` |

### Data-Flow Trace (Level 4)

Not applicable in the traditional (React component) sense — this is a backend API phase. The equivalent trace (event → row → API response) was performed above: emit call sites → `domainEvents` → `notificationService.register()` listeners → `notify()` → `notificationRepository.create()` → `notifications` table → `findByUserId`/`markRead`/`countUnread` → controller → JSON response. Every hop is wired with no dead-end, no static/hardcoded response found in the controller (data always flows from `notificationService`, never a literal `[]`/`{}` return).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Jest discovers all 6 notification test files | `npx jest --listTests` | Lists `notifications.{emission,events,read-state,ownership,pagination,idempotency}.test.js` | ✓ PASS |
| All changed/created JS files parse | `node -c <file>` on 10 core files | All exit 0 | ✓ PASS |
| `npm test` full run | `npm test` | 6 suites failed, 33/33 assertions failed, **100% identical DB_NAME guard error** (`Recusando operar: DB_NAME="apostae" não contém "test"`) — re-confirmed independently in this pass | ? SKIP (routed to human — environment limitation, not a code defect; see behavior_unverified_items) |
| Single chokepoint (no other module imports notificationRepository) | `grep -rl "require('../repositories/notificationRepository')" src --include=*.js` | `src/services/notificationService.js` only | ✓ PASS |
| No `domainEvents.emit` inside any `transaction()` closure | brace-depth-counting script over `wagerService.js`/`marketService.js` | 0 violations in both files | ✓ PASS |
| `public/` untouched by phase 01 (D-07 backend-only constraint) | `git diff --stat 998f43c^..48fddc2 -- public/` | Empty (no public/ files in phase 01's commit range) | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention or phase-declared probes found in this repo/phase. Step 7c: SKIPPED (no probe-based verification declared or conventional).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| NOTIF-01 | 01-02, 01-04 | Notified when a market they wagered in closes | ✓ SATISFIED (source-level; live-DB run pending) | `market.closed` emitted after `closeMarket`'s write; listener registered; recipients = distinct pending-wager user_ids |
| NOTIF-02 | 01-02, 01-04 | Notified when market resolves | ✓ SATISFIED (source-level; live-DB run pending) | `market.resolved` emitted after `resolveMarket` commit with recipients + outcome |
| NOTIF-03 | 01-02, 01-04 | Notified when wager wins | ✓ SATISFIED (source-level; live-DB run pending) | `wager.won` emitted per winning wager, with amount+payout |
| NOTIF-04 | 01-02, 01-04 | Notified when wager loses | ✓ SATISFIED (source-level; live-DB run pending) | `wager.lost` emitted per losing wager |
| NOTIF-05 | 01-02, 01-04 | Notified on other wager status change (cancelled) | ✓ SATISFIED (source-level; live-DB run pending) | `wager.cancelled` emitted after `cancelWager` commit; `market.deleted` emits per-refund notifications |
| NOTIF-06 | 01-03 | Paginated, newest-first list | ✓ SATISFIED (source-level; live-DB run pending) | `ORDER BY created_at DESC, id DESC`, `page`/`limit` honored, hard-capped at 100 |
| NOTIF-07 | 01-02, 01-03 | Mark as read; state persists | ✓ SATISFIED (source-level; live-DB run pending) | `markRead` UPDATE with `read_at IS NULL` guard; idempotent already-read path |
| NOTIF-08 | 01-02, 01-03 | Timestamp + owner-only retrieval, no IDOR | ✓ SATISFIED (source-level; live-DB run pending) | Every read/update scoped by `user_id`; 404 (not 403) on non-owned/nonexistent id; identity sourced only from `req.user.id` |
| NOTIF-09 | 01-01, 01-02 | Single chokepoint for notification writes | ✓ SATISFIED | Grep-confirmed sole importer; `23505` caught locally for idempotency |
| NOTIF-10 | 01-01 | No push transport required; extensible structure | ✓ SATISFIED | Generic, domain-agnostic `EventEmitter` singleton; no WebSocket/SSE code; future subscribers attach via `.on(...)` without rewrite |

No orphaned requirements: cross-referencing `.planning/REQUIREMENTS.md`'s Phase 1 mapping (NOTIF-01..10, all "Complete") against the union of every plan's `requirements:` frontmatter (01-01: NOTIF-09,10; 01-02: NOTIF-01..05,08,09; 01-03: NOTIF-06,07,08; 01-04: NOTIF-01..05) — the union covers NOTIF-01 through NOTIF-10 exactly, no gaps, no extras.

### Code Review Follow-Up (CR-01)

The phase's code review (`01-REVIEW.md`) found 1 Critical + 4 Warnings + 3 Info. **CR-01** (`deleteMarket` was destroying settled-wager audit-trail rows via an unconditional `DELETE FROM wagers WHERE market_id = $1`) was fixed by hand per `01-REVIEW-FIX.md`. Verified directly in `src/services/marketService.js`:
- A guard now throws `ConflictError` if `market.status === 'resolved'` before any deletion can occur (line 201-203).
- The DELETE statement is now scoped to `... AND status = 'pending'` (line 229), matching the method's actual intent (only refunded-just-now wagers are removed).

Fix confirmed landed and correct. The 4 Warnings (WR-01..04: negative limit/page reaching raw SQL, unvalidated `:id` param leaking a raw Postgres error, expected-duplicate inserts logged as errors, flaky fixed-`wait(50)` test pattern) and 3 Info items (falsy-coercion `|| null`, NULL-based UNIQUE constraint edge case, `unread_only` strict-string match) were explicitly deferred by user decision per `01-REVIEW-FIX.md` — these are pre-existing robustness/ergonomics gaps, not NOTIF-01..10 blockers, and are not treated as verification failures here. Noted as known follow-up debt.

### Anti-Patterns Found

None. Scanned all 17 phase-modified/created source and test files for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` and common stub patterns (empty returns, hardcoded `[]`/`{}` in production paths) — zero matches. No `public/` files were touched by this phase's commits (confirms the D-07 backend-only constraint).

## Human Verification Required

### 1. Run the notification test suites against a live, reachable Postgres test database

**Test:** Once a `*test*`-named Postgres database is reachable (resolve the `pg_hba.conf`/proxy allowlist gap, or provision a separate local test Postgres), run `DB_NAME=<test-db> NODE_ENV=test npm test`.
**Expected:** All 6 suites pass (`notifications.emission`, `notifications.events`, `notifications.read-state`, `notifications.ownership`, `notifications.pagination`, `notifications.idempotency`) — no failures beyond the currently-known, already-deferred WR-04 flakiness risk (fixed `wait(50)` sleep).
**Why human:** No isolated Postgres test database is reachable from this sandbox; the safety guard correctly refuses to run against the real `apostae` DB. This is the single blocking gap preventing NOTIF-01..08 from being marked fully behavior-VERIFIED rather than PRESENT_BEHAVIOR_UNVERIFIED. Source-level review found the test logic correct and matched to the plan's exact contracts — this item is about obtaining the final live pass/fail signal, not about suspected defects.

### 2. (Optional, lower priority) Confirm end-to-end behavior via manual HTTP smoke test

**Test:** With a running server and a real user session: place a wager, cancel a wager, and (as admin) close/resolve/delete a market; then `GET /api/notifications` as that user and confirm the expected rows appear with correct Portuguese copy, and `PATCH /api/notifications/:id/read` persists across a second `GET`.
**Expected:** Notifications appear with the right event type/text; a foreign user's id returns 404; read state persists.
**Why human:** Exercises the full HTTP stack (auth middleware, real timing of async listener execution) which is best confirmed interactively, complementary to the automated live-DB test run in item 1.

## Gaps Summary

No blocking gaps found. All required artifacts exist, are substantive, and are wired correctly, including the single-chokepoint constraint (NOTIF-09) and the crash-safe, push-transport-free event bus (NOTIF-10), both of which are provable statically and are fully VERIFIED. The sole Critical code-review finding (CR-01, an unrelated pre-existing data-loss bug in `deleteMarket` surfaced during this phase's review of `marketService.js`) was fixed by hand and the fix was independently confirmed in the current source. The 4 remaining truths (NOTIF-01..08, covering event-driven notification creation, pagination, read-state, and ownership scoping) are fully implemented and wired, with test suites whose logic was read and confirmed correct against the plan's exact contracts — but none could be executed against a live Postgres database in this sandbox due to a pre-existing, already-documented network/infrastructure limitation (only the `apostae` dev/prod DB is reachable). This is routed to human verification rather than treated as a phase failure, per the explicit environment constraint acknowledged for this verification pass.

---

_Verified: 2026-07-14T14:05:33Z_
_Verifier: Claude (gsd-verifier)_
