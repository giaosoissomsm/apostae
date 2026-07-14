---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02
current_phase_name: partial-cashout
status: executing
stopped_at: Completed 02-01-PLAN.md
last_updated: "2026-07-14T17:35:09.664Z"
last_activity: 2026-07-14
last_activity_desc: Phase 02 execution started
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 11
  completed_plans: 6
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-13)

**Core value:** Money movement (wallet balance, wagers, cashouts, cancellations) must always be
correct and auditable — a user's balance must never diverge from the sum of their recorded
transactions, even under concurrent access.

**Current focus:** Phase 02 — partial-cashout

## Current Position

Phase: 02 (partial-cashout) — EXECUTING
Plan: 3 of 7
Status: Ready to execute
Last activity: 2026-07-14 — Phase 02 execution started

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
| Phase 01 P03 | 22min | 2 tasks | 6 files |
| Phase 01 P04 | 25min | 2 tasks | 4 files |
| Phase 02 P01 | 15min | 3 tasks | 5 files |
| Phase 02 P02 | 12min | 2 tasks | 3 files |

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

- Phase 2: Cashout fee is 0% (no fee) — confirmed by project owner. "Minus fee" in the formula
  above resolves to a no-op this milestone; keep the fee term in the formula/schema so a future
  milestone can introduce a nonzero fee without a payout-formula rewrite.

- Phase 2: No minimum cashout amount — confirmed by project owner. CASHOUT-04's "reject below
  minimum" requirement is satisfied by the existing positive-amount validation only (reject
  zero/negative); no additional floor is enforced.

- Phase 1: Notifications are structure-only this milestone (DB + read/unread + paginated API);
  no WebSocket/SSE. Must be built so real-time delivery can be added later without a rewrite.

- Phase 1 P01: Jest devDependency install approved via blocking human-verify checkpoint (T-01-SC); devDependency only, no runtime deps added
- Phase 1 P01: tests/helpers/testDb.js lazy-requires migration 003 inside applyNotificationsMigration() rather than at module top-level, so the helper parses cleanly before the migration file exists
- Phase 1 P02: Extended tests/helpers/testDb.js with applyBaseSchema()/seedTestUser()/wait() (beyond plan's files_modified) — needed to satisfy notifications.user_id's FK to users(id) so the plan's real test assertions can insert valid rows.
- Phase 1 P02: notificationService.js runtime behavior (7 event listeners, idempotency, ownership scoping, markRead semantics) verified via a temporary mock-backed jest dry run, deleted before commit, since no live Postgres test database is reachable from this sandbox (pg_hba/proxy allows only the 'apostae' db).
- Phase 1 P03: Verified controller/route/server.js wiring and the three filled test files via a temporary mock-backed jest dry run (in-memory SQL emulator matching notificationRepository's exact query shapes) driving the real, unmodified notificationRepository/notificationService — deleted before commit, not part of the deliverable — since no live Postgres test database is reachable in this sandbox (same limitation as Plan 01/02).
- [Phase ?]: Phase 1 P04: Extended tests/helpers/testDb.js with applyWalletSchema()/seedWallet() (beyond plan's files_modified) - wagerService/marketService's financial transactions read/write the wallets table, so the emission tests need funded test wallets to exercise real placeWager/cancelWager/resolveMarket/deleteMarket.
- [Phase ?]: Phase 1 P04: resolveMarket/deleteMarket destructure internal-only fields (wagerOutcomes/refunds/question) out of the transaction's return value, emit from that data, but the method's own return still yields the original external shape - verified with an explicit toBeUndefined() assertion so no internal field leaks into the controller's res.json(...) response.
- [Phase ?]: Phase 1 P04: Verified all 5 emission call sites via two temporary mock-backed jest dry runs (deleted before commit) driving the real wagerService.js/marketService.js against a fake Postgres client, since no live Postgres test database is reachable in this sandbox (same limitation as Plans 01-02/01-03).
- Phase 2 P01: money.js uses zero-dependency integer-cents arithmetic (not decimal.js), with a Number.EPSILON pre-rounding correction fixing a real IEEE-754 rounding bug in the RESEARCH.md-specified formula (1.005*100 rounds to 100 instead of 101 without the fix). Prevents CASHOUT-10's exact anti-drift guarantee from being violated by the naive spec; avoids a new production dependency.
- [Phase ?]: Phase 2 P02: cashoutRepository.create does not catch 23505 -- the service layer (Plan 02-03) owns idempotency-replay semantics, matching the existing notificationRepository/notificationService split.
- [Phase ?]: Phase 2 P02: wagerRepository.findByIdForUpdate bakes user_id and market_id ownership into the FOR UPDATE WHERE clause itself -- stronger IDOR mitigation than cancelWager's existing lock-then-check-afterward pattern.

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

- No live Postgres test database is reachable from this environment for any *test*-named DB (only 'apostae' — the dev/prod db — connects; pg_hba.conf/proxy on the DB host rejects even 'postgres' and a freshly-CREATE-DATABASE'd 'apostae_test'). tests/notifications.events.test.js and tests/notifications.idempotency.test.js (Plan 02) and tests/notifications.ownership.test.js, tests/notifications.pagination.test.js, tests/notifications.read-state.test.js (Plan 03) are written and correct per source/mock-backed review but could not be run against real Postgres. Must be resolved (DB host pg_hba/proxy allowlist, or a separate local test Postgres) before Plan 04's own integration tests — and all five existing notification test files — can get a real pass/fail signal.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-14T17:34:53.462Z
Stopped at: Completed 02-01-PLAN.md
Resume file: 
None
