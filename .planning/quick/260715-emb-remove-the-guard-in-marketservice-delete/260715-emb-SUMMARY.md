---
phase: quick-260715-emb
plan: 01
subsystem: markets
tags: [express, postgresql, transactions, cascade-delete]

# Dependency graph
requires:
  - phase: 01-notifications-infrastructure
    provides: market.deleted domain event emission (unchanged by this task)
provides:
  - marketService.deleteMarket() hard-deletes resolved markets (guard removed)
affects: [markets, admin-panel, wagers]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/services/marketService.js

key-decisions:
  - "Resolved markets can now be hard-deleted via DELETE /api/markets/:id — explicit product-owner reversal of Phase 1 CR-01, confirmed aware that wagers.market_id is ON DELETE CASCADE so settled wager rows cascade-delete."

requirements-completed: [QUICK-DELMKT-01]

coverage:
  - id: D1
    description: "marketService.deleteMarket no longer throws ConflictError when market.status === 'resolved'"
    requirement: "QUICK-DELMKT-01"
    verification:
      - kind: unit
        ref: "mock-backed dry run (deleted before commit): deleteMarket(resolvedMarketId) resolves without throwing, emits market.deleted"
        status: pass
      - kind: other
        ref: "grep -c \"Não é possível deletar um mercado já resolvido\" src/services/marketService.js == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pending-wager refund logic in deleteMarket is byte-identical to before (refund loop, DELETE FROM wagers status='pending', marketRepository.delete, market.deleted emit all unchanged)"
    verification:
      - kind: other
        ref: "git diff src/services/marketService.js shows only the 3-line guard replaced by a 4-line comment; no other lines touched"
        status: pass
    human_judgment: false
  - id: D3
    description: "Admins can hard-delete a resolved market via DELETE /api/markets/:id, cascade-deleting settled wager rows"
    requirement: "QUICK-DELMKT-01"
    verification: []
    human_judgment: true
    rationale: "No live *test*-named Postgres reachable in this sandbox (documented, carried-forward blocker across all prior phases in STATE.md) — the ON DELETE CASCADE behavior itself is a schema-level guarantee (src/migrations/001_initial.js:74) unmodified by this change, but end-to-end cascade behavior against a real resolved market with settled wagers was not exercised against a live DB in this environment."

# Metrics
duration: 8min
completed: 2026-07-15
status: complete
---

# Quick Task 260715-emb: Remove resolved-market delete guard Summary

**Removed the resolved-market ConflictError guard in `marketService.deleteMarket`, restoring true hard-delete for resolved markets per explicit product-owner decision reversing Phase 1 CR-01.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-15T13:33:00Z (approx)
- **Completed:** 2026-07-15T13:37:32Z
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments
- Deleted the 3-line `if (market.status === 'resolved') { throw new ConflictError(...) }` block in `deleteMarket`
- Replaced it with a 4-line Portuguese comment documenting the deletion is intentional (references the CR-01 reversal and the `ON DELETE CASCADE` schema behavior) so a future reviewer doesn't reinstate the guard by mistake
- Left all other logic in `deleteMarket` byte-identical: pending-wager refund loop, `DELETE FROM wagers ... status='pending'`, `marketRepository.delete`, logger call, and `domainEvents.emit('market.deleted', ...)`
- Left the `ConflictError` import in place (still used by `resolveMarket` at line 246, unaffected by this change)

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove resolved-market guard in deleteMarket** - `b34bb9e` (fix)

**Plan metadata:** (docs commit handled by orchestrator, not this executor)

## Files Created/Modified
- `src/services/marketService.js` - Removed the resolved-market guard block in `deleteMarket`; added an intent-documenting comment at the removal site

## Decisions Made
- No new decisions beyond what the plan already specified. Applied the plan's proposed comment wording (paraphrased, not the literal removed error string) verbatim to intent.

## Deviations from Plan

None - plan executed exactly as written. The guard was removed, the comment was added in the exact location specified (immediately after the `if (!market) throw new NotFoundError(...)` line), and no other lines in `deleteMarket` were touched.

## Issues Encountered

- The plan's own `<verification>` section referenced `npx jest tests/cashout.delete-market-refund.test.js` as a check that pending-refund behavior is unchanged. Running it (and `tests/markets.resolution.test.js`) surfaced the same pre-existing, already-documented sandbox limitation carried across every prior phase in this milestone: `tests/helpers/testDb.js` refuses to run because `DB_NAME="apostae"` doesn't contain `"test"` (no live `*test*`-named Postgres is reachable in this sandbox — see STATE.md Blockers/Concerns, present since Phase 1). This is unrelated to this change (both test files fail identically on a clean checkout before this diff was applied) and is not a new blocker introduced by this task.
- To compensate, ran a temporary mock-backed dry run (faking only `src/config/database.js`, `wagerRepository`, `marketRepository`, and `domainEvents` via `require.cache` injection, deleted after use, never committed) driving the real unmodified `marketService.deleteMarket` against a resolved-market row. Confirmed: no `ConflictError` thrown, `market.deleted` emitted with the expected payload, and the refund/logger code path executed cleanly with zero pending wagers. This is consistent with the mock-backed-dry-run compensation pattern used in every phase of this milestone (see STATE.md decisions log, Phase 1 P02 through Phase 4 P03).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- This is a standalone quick task, not part of the phase sequence. No next-phase dependency.
- Carried-forward blocker (pre-existing, not introduced here): no live `*test*`-named Postgres reachable in this sandbox. `tests/cashout.delete-market-refund.test.js` and `tests/markets.resolution.test.js` remain unexecuted against real Postgres for this change, same as all prior phases in this milestone. Must be resolved (DB host pg_hba/proxy allowlist, or a separate local test Postgres) before a full test suite run can validate this change end-to-end.

---
*Phase: quick-260715-emb*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: src/services/marketService.js
- FOUND: .planning/quick/260715-emb-remove-the-guard-in-marketservice-delete/260715-emb-SUMMARY.md
- FOUND: b34bb9e (commit exists in git log)
