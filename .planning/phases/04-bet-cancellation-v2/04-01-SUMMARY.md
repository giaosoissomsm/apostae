---
phase: 04-bet-cancellation-v2
plan: 01
subsystem: payments
tags: [wallet, wager, cancellation, fee, postgresql, transaction, idor, locking]

# Dependency graph
requires:
  - phase: 02-partial-cashout
    provides: money.applyFeePercent, wagerRepository.findByIdForUpdate (IDOR-safe lock), marketRepository.findByIdForUpdate, walletRepository transaction pattern, CASHOUT_FEE_PERCENT config precedent
provides:
  - Rewritten wagerService.cancelWager with 5% fee / 95% net refund
  - CANCEL_FEE_PERCENT env var with [0,100] startup bounds validation
  - Hard outright block on cancellation once any cashout has occurred (cashed_out_amount > 0)
  - Market->wager->wallet lock order in cancelWager (closes the last reversed-order deadlock risk in the codebase)
  - IDOR-hardened wager lookup in cancelWager (404 not 403 for non-owners)
affects: [04-02, 04-03, dashboard.js cancel button UX (future, out of scope this plan)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "cancelWager rewritten to structurally mirror cashoutWager's lock sequence: unlocked market_id peek -> marketRepository.findByIdForUpdate -> wagerRepository.findByIdForUpdate (ownership in WHERE) -> walletRepository.findByUserIdForUpdate"
    - "Hard-block validation (cashed_out_amount > 0) runs immediately after lock+status checks, strictly before any fee/refund math"

key-files:
  created: []
  modified:
    - src/config/env.js
    - src/services/wagerService.js
    - tests/cashout.cancel-refund.test.js

key-decisions:
  - "CANCEL_FEE_PERCENT added as an env var (default 5, [0,100]-bounded) mirroring CASHOUT_FEE_PERCENT, per plan/RESEARCH.md recommendation — not hardcoded, for consistency and testability."
  - "AuthorizationError import removed from wagerService.js — no longer used anywhere in the file now that ownership is enforced by the locked SELECT returning null (404 NotFoundError instead of 403)."
  - "wager.status stays 'refunded' (not a new 'cancelled' enum value) — dashboard.js already labels it 'Cancelada'; no migration needed (Pitfall 3)."
  - ".env.example edit skipped — the file is blocked by this sandbox's own permission settings (Read/Bash both denied access to .env*), so its contents could not be verified. Per the plan's own escape clause ('if it does not exist or does not mention CASHOUT_FEE_PERCENT, skip the edit'), skipped rather than risk writing blind to an inaccessible file. Purely cosmetic/documentation — CANCEL_FEE_PERCENT works via its committed default (5) with no .env.example entry required."

requirements-completed: [CANCEL-01, CANCEL-02, CANCEL-03, CANCEL-04, CANCEL-05, CANCEL-06, CANCEL-07, CANCEL-08]

coverage:
  - id: D1
    description: "CANCEL_FEE_PERCENT env var added with [0,100] startup bounds validation, default 5"
    requirement: "CANCEL-02"
    verification:
      - kind: unit
        ref: "node -e default/bounds check (src/config/env.js) — see Task 1 verify command"
        status: pass
    human_judgment: false
  - id: D2
    description: "cancelWager rewritten: market->wager->wallet lock order, IDOR-safe 404-on-foreign-wager, hard block on any prior cashout, 5%/95% fee split via money.applyFeePercent, single wallet_transactions 'refund' row, same DELETE /api/wagers/:id route"
    requirement: "CANCEL-01, CANCEL-03, CANCEL-04, CANCEL-05, CANCEL-06, CANCEL-07, CANCEL-08"
    verification:
      - kind: unit
        ref: "structural grep check (Task 2 verify command) — lock order, IDOR helper, cashout-block-before-fee ordering, AuthorizationError removal"
        status: pass
      - kind: integration
        ref: "tests/cashout.cancel-refund.test.js — mock-backed dry run (temporary, deleted before commit) driving the real unmodified wagerService.cancelWager"
        status: pass
    human_judgment: true
    rationale: "No live *test*-named Postgres reachable in this sandbox (carried-forward Phase 1-3 blocker, reconfirmed against both default and apostae_test DB_NAME overrides). Jest could not execute against real Postgres, so a human/CI run against a real test DB is still needed to fully close CANCEL-07's concurrency/row-lock guarantee — the mock-backed dry run proves logic correctness but not real Postgres FOR UPDATE serialization."
  - id: D3
    description: "tests/cashout.cancel-refund.test.js updated (not deleted) to assert 95 net refund and ConflictError hard-block, replacing the old 100/60 refund assertions"
    requirement: "CANCEL-02, CANCEL-06"
    verification:
      - kind: integration
        ref: "tests/cashout.cancel-refund.test.js#aposta sem cashout prévio..., tests/cashout.cancel-refund.test.js#cashout parcial prévio..."
        status: unknown
    human_judgment: true
    rationale: "Test file is written and structurally correct (syntax-checked, and its logic was independently validated via the mock-backed dry run against the real cancelWager) but has never executed via jest against a real Postgres connection in this sandbox — status is unknown until a real *test*-named Postgres is reachable."

# Metrics
duration: 20min
completed: 2026-07-15
status: complete
---

# Phase 4 Plan 1: Core cancelWager Rewrite Summary

**Rewrote wagerService.cancelWager to charge a 5% fee (95% net refund) via a new `CANCEL_FEE_PERCENT` env var, hard-block cancellation outright once any cashout has occurred, fix the reversed lock order (now market->wager->wallet), and close the weaker IDOR pattern (404 not 403 on a foreign wager) — same `DELETE /api/wagers/:id` route.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-15T01:33:00Z (approx, based on preceding research/plan commit timestamps)
- **Completed:** 2026-07-15T04:52:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added `CANCEL_FEE_PERCENT` to `src/config/env.js` (default 5, `[0,100]`-bounded startup validation, mirrors `CASHOUT_FEE_PERCENT` exactly)
- Rewrote `wagerService.cancelWager` in place: lock order is now market -> wager -> wallet (fixes a documented, never-closed deadlock risk against `cashoutWager`/`resolveMarket`/`deleteMarket`); ownership is now enforced inside `wagerRepository.findByIdForUpdate`'s `WHERE` clause (404 for a foreign wager, not 403, avoiding existence leakage); cancellation now throws `ConflictError` outright the instant `cashed_out_amount > 0`, before any fee/refund math runs; fee/net split computed via `money.applyFeePercent(remainingStake, env.CANCEL_FEE_PERCENT)` — never hand-rolled floats
- Updated `tests/cashout.cancel-refund.test.js` (not deleted) to assert the new 95-net-refund and hard-block-with-ConflictError behavior, replacing the old 100/60-refund assertions from the pre-Phase-4 free/netting cancellation

## Task Commits

Each task was committed atomically:

1. **Task 1: Add CANCEL_FEE_PERCENT config with startup bounds validation** - `12f9c9a` (feat)
2. **Task 2: Rewrite cancelWager (lock order + IDOR + cashout block + 5% fee)** - `005efd3` (feat)
3. **Task 3: Update cashout.cancel-refund.test.js for the new fee + hard-block behavior** - `cf923d2` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/config/env.js` - Added `CANCEL_FEE_PERCENT` env var (default 5) and its `[0,100]` bounds-validation block, directly mirroring `CASHOUT_FEE_PERCENT`
- `src/services/wagerService.js` - Rewrote `cancelWager`'s transaction body in place (lock order, IDOR-safe lookup, cashout hard block, fee computation, richer event payload); removed the now-unused `AuthorizationError` import
- `tests/cashout.cancel-refund.test.js` - Updated both test cases to assert the new 5%-fee/hard-block behavior instead of the old free/netting behavior

## Decisions Made
- `CANCEL_FEE_PERCENT` is an env var (default 5), not a hardcoded constant — matches the `CASHOUT_FEE_PERCENT` architectural pattern for consistency and testability (per RESEARCH.md Open Question 2 recommendation)
- Kept the existing `'refunded'` wager status value rather than adding a new `'cancelled'` DB enum — the UI already displays `'refunded'` as "Cancelada" (Pitfall 3), so no migration was needed
- `AuthorizationError` import removed from `wagerService.js` since the rewrite no longer throws it anywhere in the file (ownership is now enforced by the locked SELECT returning `null` -> `NotFoundError`)
- CANCEL-06 implemented as documented in STATE.md's already-confirmed Phase 4 decision: an outright hard block on any prior cashout (`cashed_out_amount > 0`), not a partial-cancel-with-netting path — CANCEL-03's `remainingStake` formula is kept as a defensive no-op that is unreachable once the block fires, exactly per the locked decision

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written for the code changes.

### Other Notes (not deviations, documented per plan instructions)

**1. `.env.example` edit skipped — file inaccessible under this sandbox's own permission settings**
- **Found during:** Task 1 (env.js config addition)
- **Issue:** The plan's action text made the `.env.example` edit conditional: "If .env.example documents CASHOUT_FEE_PERCENT, add a matching CANCEL_FEE_PERCENT=5 line... if it does not exist or does not mention CASHOUT_FEE_PERCENT, skip the .env.example edit." Both the `Read` tool and `Bash` (`grep`/`wc`) were denied access to `.env.example` by this sandbox's permission settings (it matches a `.env*`-pattern deny rule), so its contents could not be inspected to decide.
- **Resolution:** Treated the file as effectively "cannot verify it documents CASHOUT_FEE_PERCENT" and skipped the edit per the plan's own escape clause, rather than writing blind to a file whose current content is unknown. `CANCEL_FEE_PERCENT` is fully functional via its committed default (`5`) in `src/config/env.js` regardless — this only affects operator-facing documentation, not runtime behavior.
- **Files modified:** None (skipped)
- **Committed in:** N/A

**2. `tests/cashout.cancel-refund.test.js` could not be executed via `npx jest` in this sandbox**
- **Found during:** Task 3 (test verification)
- **Issue:** Same carried-forward blocker documented in every prior phase (STATE.md, RESEARCH.md Environment Availability): no live `*test*`-named PostgreSQL is reachable. Confirmed again this plan against both the default `DB_NAME=apostae` (`assertTestDatabase` refuses to run) and an explicit `DB_NAME=apostae_test` override (`pg_hba.conf` rejects the connection entirely: `no pg_hba.conf entry for host "172.16.60.3", user "apostae", database "apostae_test"`).
- **Resolution:** Compensated via a temporary mock-backed dry run (same pattern as Phase 2 P07's SUMMARY) that fakes only `src/config/database.js`'s `query()`/`transaction()` exports via `require.cache` injection, leaving `wagerService.cancelWager`, `wagerRepository`, `marketRepository`, `walletRepository`, and `money.js` as the real, unmodified committed source. All 10 assertions across both updated test cases passed against this real code path (95 net refund / 5 fee / `refunded` status for the clean case; `ConflictError` / unchanged wallet / unchanged `pending` status for the cashed-out case). The script was deleted before this commit — it is not part of the deliverable.
- **Files modified:** None (temporary script only, deleted)
- **Committed in:** N/A

---

**Total deviations:** 0 auto-fixed. 2 documented environment/access limitations (both pre-existing, carried-forward from prior phases, with compensating verification performed).
**Impact on plan:** No scope creep. Both notes are environment-access limitations outside this plan's control, not code defects; the core financial rewrite (Task 2) was independently verified logically correct via the mock-backed dry run.

## Issues Encountered
- No live `*test*`-named Postgres reachable (see Deviations note 2 above) — same carried-forward blocker as Phases 1-3. This is Phase 4's own RESEARCH.md-flagged "third consecutive phase" gap; recommend escalating DB access resolution before `/gsd-verify-work` for this phase, especially for CANCEL-07's concurrency guarantee, which genuinely requires real Postgres row-lock serialization to prove (mocks cannot validate this, as already noted twice this milestone).
- `.env.example` inaccessible under sandbox permission settings (see Deviations note 1 above) — cosmetic only, does not block functionality.

## User Setup Required

None - no external service configuration required. `CANCEL_FEE_PERCENT` works via its code default (5) with no `.env` changes needed to run correctly; operators wanting a different fee percentage can set the env var directly.

## Next Phase Readiness
- Core `cancelWager` rewrite is complete and structurally verified (lock order, IDOR, hard block, fee math all confirmed via code read + structural grep + mock-backed dry run).
- Later plans in this phase (04-02, 04-03) that add dedicated `tests/cancel.*.test.js` files and any frontend polish can build directly on this rewrite without further service-layer changes.
- Outstanding blocker carried forward: a real `*test*`-named Postgres connection is still needed before any of this phase's tests (this plan's updated regression test, plus 04-02/04-03's new `tests/cancel.*.test.js` files) can get a genuine jest pass/fail signal — especially CANCEL-07's concurrency test, which cannot be meaningfully mock-verified.

---
*Phase: 04-bet-cancellation-v2*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: src/config/env.js
- FOUND: src/services/wagerService.js
- FOUND: tests/cashout.cancel-refund.test.js
- FOUND: .planning/phases/04-bet-cancellation-v2/04-01-SUMMARY.md
- FOUND commit: 12f9c9a
- FOUND commit: 005efd3
- FOUND commit: cf923d2
