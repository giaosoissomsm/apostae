---
phase: 02-partial-cashout
plan: 02
subsystem: database
tags: [postgres, repository-layer, idempotency, row-locking, idor]

# Dependency graph
requires:
  - phase: 02-partial-cashout (Plan 01)
    provides: src/migrations/004_cashout.js (wager_cashouts table + wagers.cashed_out_amount column), src/utils/money.js
provides:
  - src/repositories/cashoutRepository.js — create() (idempotent insert, RETURNING *, lets 23505 bubble) + findByIdempotencyKey() (replay read-back), both client-scoped
  - wagerRepository.findByIdForUpdate(id, marketId, userId, client) — IDOR-safe lock (ownership baked into WHERE)
  - marketRepository.findByIdForUpdate(id, client) — reusable market lock, DRYs 4 existing inline call sites
affects: [02-03-cashout-endpoint-resolvemarket-edit, 02-04-cashout-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Repository-owned INSERT lets 23505 bubble uncaught; service layer owns idempotency-replay semantics (matches notificationRepository/notificationService split)"
    - "Ownership scoping baked directly into the FOR UPDATE lock query's WHERE clause, not a separate post-lock check — closes the IDOR gap that cancelWager's existing (weaker) post-lock check leaves open"

key-files:
  created:
    - src/repositories/cashoutRepository.js
  modified:
    - src/repositories/wagerRepository.js
    - src/repositories/marketRepository.js

key-decisions:
  - "cashoutRepository.create does not catch err.code === '23505' — the service (Plan 02-03's cashoutWager) owns the catch-and-replay decision, exactly mirroring where notificationService (not notificationRepository) handles the same class of conflict"
  - "wagerRepository.findByIdForUpdate takes (id, marketId, userId) and bakes both into the WHERE clause alongside FOR UPDATE — stronger than cancelWager's existing pattern of locking first and checking wager.user_id === userId afterward"

requirements-completed: [CASHOUT-06, CASHOUT-07]

coverage:
  - id: D1
    description: "cashoutRepository.create() inserts a wager_cashouts row transactionally and RETURNING *; a duplicate (wager_id, idempotency_key) raises a catchable Postgres 23505 to the caller rather than being swallowed"
    requirement: "CASHOUT-07"
    verification:
      - kind: unit
        ref: "node -e structural gate (Task 1 verify block) confirming create()/findByIdempotencyKey() exist, RETURNING * present, no internal catch() swallowing 23505"
        status: pass
    human_judgment: true
    rationale: "23505's actual DB-enforced throw behavior requires a live Postgres instance with the wager_cashouts UNIQUE constraint from migration 004 — no *test*-named database is reachable in this sandbox (same carried-forward blocker as Phase 1 and 02-01). Structurally verified only; needs a live-DB integration test in Plan 04."
  - id: D2
    description: "wagerRepository.findByIdForUpdate(id, marketId, userId, client) locks a wager row FOR UPDATE with market_id and user_id baked into the WHERE clause — an attacker cannot lock/read another user's wager by guessing an id"
    requirement: "CASHOUT-06"
    verification:
      - kind: unit
        ref: "node -e structural gate (Task 2 verify block) confirming the exact WHERE clause shape 'WHERE id = $1 AND market_id = $2 AND user_id = $3 FOR UPDATE'"
        status: pass
    human_judgment: false
  - id: D3
    description: "marketRepository.findByIdForUpdate(id, client) locks a market row FOR UPDATE by id, reusable in place of the SQL currently inlined at 4 existing call sites"
    verification:
      - kind: unit
        ref: "node -e structural gate (Task 2 verify block) confirming the method exists and existing methods are unmodified"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-14
status: complete
---

# Phase 2 Plan 02: Cashout Repository Layer Summary

**New cashoutRepository (idempotent insert + read-back) plus IDOR-safe `findByIdForUpdate` lock helpers on wagerRepository and marketRepository — the data-access primitives Plan 02-03's cashout service will orchestrate.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-14T17:32:08Z (approx, git commit history)
- **Completed:** 2026-07-14T17:34:02Z
- **Tasks:** 2 completed
- **Files modified:** 3 (1 created, 2 extended)

## Accomplishments
- `src/repositories/cashoutRepository.js` — first-class repository for `wager_cashouts`, `create()` (RETURNING *, uncaught 23505 for the service to handle) + `findByIdempotencyKey()` (replay read-back for CASHOUT-07)
- `wagerRepository.findByIdForUpdate(id, marketId, userId, client)` — the IDOR-safe lock query the whole cashout concurrency story rests on: ownership is part of the lock acquisition itself, not a check performed after
- `marketRepository.findByIdForUpdate(id, client)` — DRYs the `SELECT * FROM markets WHERE id = $1 FOR UPDATE` SQL currently duplicated inline at 4 call sites across `wagerService.js`/`marketService.js` (not retrofitted in this plan — that's Plan 02-03's concern)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/repositories/cashoutRepository.js** - `467f824` (feat)
2. **Task 2: Add findByIdForUpdate lock helpers to wager and market repositories** - `9ae2f6c` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/repositories/cashoutRepository.js` - New repository: create() + findByIdempotencyKey(), both client-scoped
- `src/repositories/wagerRepository.js` - Added findByIdForUpdate(id, marketId, userId, client), additive only
- `src/repositories/marketRepository.js` - Added findByIdForUpdate(id, client), additive only

## Decisions Made
- `cashoutRepository.create` deliberately does not catch the `23505` unique-violation — this decision belongs to the service layer (Plan 02-03's `cashoutWager`), matching the existing `notificationRepository`/`notificationService` split in this codebase where the repository always surfaces the raw Postgres error and the service decides what "idempotent" means for that specific write.
- Ownership scoping (`user_id`) is baked directly into `wagerRepository.findByIdForUpdate`'s `WHERE` clause alongside `FOR UPDATE`, rather than being a separate check performed after the row is locked. This is a stronger IDOR mitigation than the existing `cancelWager` precedent (which locks first, then checks `wager.user_id !== userId` afterward) — per the plan's explicit success criterion and RESEARCH.md's IDOR threat analysis.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` and `<done>` criteria were met without needing any Rule 1-4 auto-fixes.

Note: the plan's Task 1 and Task 2 verify blocks contain inline `node -e "..."` commands wrapped in bash double quotes with `\$1`/`\$2`/`\$3` escape sequences. When run literally as written, bash's double-quote processing strips the backslash before `$`, which changes the regex the shell actually hands to `node` (turning an escaped literal `\$1` into an unescaped `$1`, where `$` is a regex anchor, not a literal dollar sign) — causing the grep gate to falsely report failure even though the underlying code is correct. This was diagnosed by re-running the identical regex from a `.js` script file (bypassing bash's quote-stripping) rather than as an inline `-e` argument, which confirmed the code satisfies the check as authored. This is a shell-quoting artifact of the plan's verification block, not a code defect — no fix was needed to the shipped files themselves, only to how the check was executed.

## Issues Encountered
- Carried forward from Plan 02-01 (and Phase 1): no live `*test*`-named Postgres database is reachable from this sandbox. `cashoutRepository.create`'s 23505-bubbling behavior is structurally verified (no internal catch, RETURNING * present) but its actual DB-enforced-conflict behavior against the `UNIQUE(wager_id, idempotency_key)` constraint from migration 004 has not been exercised live. Flagged in `coverage` (D1) for Plan 04's live-DB integration test.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `cashoutRepository`, `wagerRepository.findByIdForUpdate`, and `marketRepository.findByIdForUpdate` are ready for Plan 03 (`wagerService.cashoutWager` orchestration + `marketService.resolveMarket` payout-scaling edit) to build on directly — all three primitives match the exact shapes RESEARCH.md's Pattern 1/Pattern 2 code examples already assume.
- The live-DB test blocker (carried from Phase 1 and Plan 02-01) still needs resolving before Plan 04's concurrency/idempotency integration tests can get a real pass/fail signal.

---
*Phase: 02-partial-cashout*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: src/repositories/cashoutRepository.js
- FOUND: src/repositories/wagerRepository.js
- FOUND: src/repositories/marketRepository.js
- FOUND: .planning/phases/02-partial-cashout/02-02-SUMMARY.md
- FOUND: 467f824 (feat commit, Task 1)
- FOUND: 9ae2f6c (feat commit, Task 2)
