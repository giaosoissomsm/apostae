---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 01
current_phase_name: notifications-infrastructure
status: executing
stopped_at: Completed 01-02-PLAN.md
last_updated: "2026-07-14T12:25:52.634Z"
last_activity: 2026-07-14
last_activity_desc: Phase 01 execution started
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 4
  completed_plans: 2
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-13)

**Core value:** Money movement (wallet balance, wagers, cashouts, cancellations) must always be
correct and auditable — a user's balance must never diverge from the sum of their recorded
transactions, even under concurrent access.

**Current focus:** Phase 01 — notifications-infrastructure

## Current Position

Phase: 01 (notifications-infrastructure) — EXECUTING
Plan: 3 of 4
Status: Ready to execute
Last activity: 2026-07-14 — Phase 01 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 10min | 3 tasks | 10 files |
| Phase 01 P02 | 35min | 2 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Milestone-wide: Build order is Notifications → Partial Cashout → New Market Types →
  Cancellation v2 (mandated by requisitos.txt; each feature fully implemented, reviewed, and
  tested before the next starts — reflected as strict sequential phase dependencies).

- Phase 2: Cashout formula is stake-proportional (stake × odds_at_time × fraction, minus fee),
  not probability-weighted — confirmed by project owner (no live-odds feed exists to ground a
  "fair value" formula).

- Phase 1: Notifications are structure-only this milestone (DB + read/unread + paginated API);
  no WebSocket/SSE. Must be built so real-time delivery can be added later without a rewrite.

- Phase 1 P01: Jest devDependency install approved via blocking human-verify checkpoint (T-01-SC); devDependency only, no runtime deps added
- Phase 1 P01: tests/helpers/testDb.js lazy-requires migration 003 inside applyNotificationsMigration() rather than at module top-level, so the helper parses cleanly before the migration file exists
- Phase 1 P02: Extended tests/helpers/testDb.js with applyBaseSchema()/seedTestUser()/wait() (beyond plan's files_modified) — needed to satisfy notifications.user_id's FK to users(id) so the plan's real test assertions can insert valid rows.
- Phase 1 P02: notificationService.js runtime behavior (7 event listeners, idempotency, ownership scoping, markRead semantics) verified via a temporary mock-backed jest dry run, deleted before commit, since no live Postgres test database is reachable from this sandbox (pg_hba/proxy allows only the 'apostae' db).

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2: Research flags a pre-existing, undocumented-fix scheduler race (no lock coordinating
  scheduled market resolution with concurrent admin/user actions). Must be closed no later than
  Phase 2, since cashout is the first feature to introduce a second concurrent actor against
  resolution — deferring it multiplies risk in Phases 3 and 4.

- Repo has uncommitted pre-existing changes at project init (deleted
  `src/middleware/rateLimiter.js`, modified auth/config/controllers) predating this planning
  session — verify current file state before assuming contents when Phase 1 planning starts.

- No test framework is currently installed (package.json has none), despite requisitos.txt
  mandating concurrency/attack-vector testing — must be resolved before Phase 2's concurrency
  tests can be written.

- No live Postgres test database is reachable from this environment for any *test*-named DB (only 'apostae' — the dev/prod db — connects; pg_hba.conf/proxy on the DB host rejects even 'postgres' and a freshly-CREATE-DATABASE'd 'apostae_test'). tests/notifications.events.test.js and tests/notifications.idempotency.test.js (Plan 02) are written and correct per source/mock-backed review but could not be run against real Postgres. Must be resolved (DB host pg_hba/proxy allowlist, or a separate local test Postgres) before Plan 03/04's own integration tests — and this plan's own tests — can get a real pass/fail signal.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-14T12:25:52.622Z
Stopped at: Completed 01-02-PLAN.md
Resume file: None
</content>
