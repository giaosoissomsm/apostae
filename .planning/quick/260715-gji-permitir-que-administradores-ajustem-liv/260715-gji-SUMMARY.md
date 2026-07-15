---
phase: quick-260715-gji
plan: 01
subsystem: payments
tags: [express, postgresql, transactions, wallet, admin]

# Dependency graph
requires:
  - phase: existing wallet/wagerService infrastructure
    provides: walletRepository (findByUserIdForUpdate, adjustBalance, recordTransaction), transaction() helper, audit_logs table
provides:
  - Admin-only endpoint to freely credit or debit any user's wallet balance
  - adjustUserBalance service method with FOR UPDATE locking + atomic audit trail
affects: [admin-panel, wallet, audit-logs]

# Tech tracking
tech-stack:
  added: []
  patterns: [transactional FOR UPDATE lock + wallet_transactions + audit_logs written atomically on the same client]

key-files:
  created: []
  modified:
    - src/services/userService.js
    - src/controllers/usersController.js
    - src/routes/users.js

key-decisions:
  - "Self-adjustment (adminId === userId) is explicitly allowed, unlike setActive/setRole/deleteUser which block self-targeting."
  - "Route uses POST (not PUT) because balance adjustment is a non-idempotent money movement — replaying it must not be a safe no-op."
  - "Debit sufficiency is checked inside the FOR UPDATE lock before the UPDATE, so the Postgres CHECK(balance >= 0) never surfaces as a raw DB error — a clean ValidationError is thrown instead."

patterns-established:
  - "Admin money-movement mutation: transaction() -> walletRepository.findByUserIdForUpdate (FOR UPDATE) -> business validation -> adjustBalance -> recordTransaction -> audit_logs INSERT, all inside the same client."

requirements-completed: [GJI-01]

coverage:
  - id: D1
    description: "Admin can POST a credit or debit adjustment for any user's wallet; balance moves by exactly the amount, never below zero for debits."
    requirement: "GJI-01"
    verification:
      - kind: unit
        ref: "node --check src/services/userService.js + structural grep for findByUserIdForUpdate/type=correction/admin_adjustment/admin_adjust_balance/Saldo insuficiente"
        status: pass
    human_judgment: true
    rationale: "No live Postgres reachable in this sandbox (carried-forward blocker from STATE.md) — structural/static checks pass but runtime behavior (actual balance movement, over-draft rejection, atomic audit-row pair, concurrent-adjustment serialization) needs a human or CI run against a real DB to confirm end-to-end."
  - id: D2
    description: "Non-admin requests to POST /:id/balance are rejected before any balance mutation."
    requirement: "GJI-01"
    verification:
      - kind: unit
        ref: "node --check src/routes/users.js + grep for requireAuth, requireAdmin on the route registration"
        status: pass
    human_judgment: true
    rationale: "requireAuth/requireAdmin middleware wiring is identical to all other admin routes in this file (statically verified), but no live server was exercised in this sandbox to confirm the 403 response at runtime."

duration: 40min
completed: 2026-07-15
status: complete
---

# Quick Task 260715-gji: Admin Wallet Balance Adjustment Summary

**Admin-only POST /api/users/:id/balance endpoint that credits or debits any user's wallet inside a PostgreSQL transaction with a FOR UPDATE row lock and an atomic wallet_transactions + audit_logs pair.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-15T15:00:00Z (approx)
- **Completed:** 2026-07-15T15:14:00Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- Added `UserService.adjustUserBalance(userId, type, amount, description, adminId, ipAddress)`: validates type/amount/description server-side, 404s on a missing target user, locks the wallet `FOR UPDATE`, rejects over-drafting debits with a `ValidationError` before touching the row, mutates balance only via `walletRepository.adjustBalance`, and records a `type='correction'`/`related_entity='admin_adjustment'` `wallet_transactions` row plus an `action='admin_adjust_balance'` `audit_logs` row on the same transaction client.
- Added `usersController.adjustUserBalance` — boundary validation (clean 400s for bad type/amount/description) then delegates to the service.
- Registered `POST /api/users/:id/balance` guarded by `requireAuth` + `requireAdmin`, placed next to the existing `PUT /:id/status` and `PUT /:id/role` admin routes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add adjustUserBalance service method (transactional, locked, audited)** - `7d63704` (feat)
2. **Task 2: Wire controller handler and admin-only route** - `a1a96c6` (feat)

**Plan metadata:** committed separately by the orchestrator (docs artifacts excluded from this executor's commits per constraints)

## Files Created/Modified
- `src/services/userService.js` - Added `adjustUserBalance` method (imports `transaction` from `../config/database` and `walletRepository`)
- `src/controllers/usersController.js` - Added `adjustUserBalance` handler, exported it
- `src/routes/users.js` - Registered `POST /:id/balance` behind `requireAuth` + `requireAdmin`

## Decisions Made
- Self-adjustment is allowed (no `adminId === userId` guard), per plan's explicit CONTEXT decision — differs from `setActive`/`setRole`/`deleteUser` which block self-targeting.
- Used `POST` (not `PUT`) for the route since a balance adjustment is a non-idempotent money movement.
- Debit sufficiency check happens inside the `FOR UPDATE` lock, before the `UPDATE`, so the DB-level `CHECK (balance >= 0)` constraint never surfaces as a raw/unhandled error.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched the plan's method signatures, transaction shape, and route wiring precisely; all structural verification greps specified in the plan passed on first attempt.

## Issues Encountered
None. No live PostgreSQL instance was reachable in this sandbox to run true runtime integration checks (carried-forward blocker noted in the plan's `<verification>` section and in STATE.md) — this is a pre-existing sandbox limitation, not something introduced by this task. Static verification (`node --check` on all three files plus structural greps for the FOR UPDATE lock, transaction type/related_entity values, audit action name, and insufficient-balance guard) passed cleanly.

## Known Stubs
None — no placeholder/stub data introduced. The feature is fully wired end-to-end (route -> controller -> service -> repository -> DB), pending only a live-DB runtime smoke test that could not be run in this sandbox.

## Threat Flags

None beyond what the plan's own `<threat_model>` already covers (T-gji-01 through T-gji-06 all mitigated as specified; no new endpoints, auth paths, or schema changes were introduced beyond the single `POST /:id/balance` route the plan defined).

## User Setup Required

None - no external service configuration required. Feature uses only existing dependencies (pg, existing repositories) and existing DB schema (`wallet_transactions.type` already allows `'correction'`, `audit_logs` schema already supports the fields used).

## Next Phase Readiness
- Endpoint is code-complete and passes all static verification.
- Recommend a live-DB smoke test (credit increases balance, debit decreases balance, over-draft debit throws `ValidationError` and leaves balance unchanged, each success writes exactly one `wallet_transactions` + one `audit_logs` row, non-admin gets 403) as soon as a reachable test Postgres is available — this mirrors the compensating-verification approach already used across Phases 1-4 per the plan's `<verification>` note.
- No blockers for subsequent work.

---
*Phase: quick-260715-gji*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: src/services/userService.js
- FOUND: src/controllers/usersController.js
- FOUND: src/routes/users.js
- FOUND: .planning/quick/260715-gji-permitir-que-administradores-ajustem-liv/260715-gji-SUMMARY.md
- FOUND: commit 7d63704
- FOUND: commit a1a96c6
