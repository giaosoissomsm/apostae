---
phase: 01-notifications-infrastructure
fixed_at: 2026-07-14T14:02:17Z
review_path: .planning/phases/01-notifications-infrastructure/01-REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-07-14T14:02:17Z
**Source review:** .planning/phases/01-notifications-infrastructure/01-REVIEW.md
**Iteration:** 1

**Scope:** Applied by hand (not via `/gsd-code-review --fix`/gsd-code-fixer) at the user's explicit request: fix the sole Critical finding now, defer the 4 Warnings and 3 Info findings to a later pass.

**Summary:**
- Findings in scope: 1 (CR-01 only)
- Fixed: 1
- Skipped: 0

## Fixed Issues

### CR-01: `deleteMarket` deletes ALL wagers for a market, not just the refunded pending ones — irreversible audit-trail loss

**Files modified:** `src/services/marketService.js`
**Applied fix:**
- Added a guard at the top of `deleteMarket`'s transaction: `if (market.status === 'resolved') throw new ConflictError('Não é possível deletar um mercado já resolvido.')`, matching the existing guard style already used in `resolveMarket`. This is the change that actually closes CR-01 — a resolved market's `won`/`lost` wager rows (the real audit-trail-loss scenario the finding described) can no longer be deleted at all, so the DB-level `ON DELETE CASCADE` on `wagers.market_id` (see `src/migrations/001_initial.js:74`) can never fire against settled wagers.
- Scoped the explicit wager delete from `DELETE FROM wagers WHERE market_id = $1;` to `DELETE FROM wagers WHERE market_id = $1 AND status = 'pending';`, so the statement's own intent matches "remove only the wagers just refunded in this operation."

**Residual note (not part of CR-01, not fixed — flagging for awareness):** `wagers.market_id REFERENCES markets(id) ON DELETE CASCADE` means that when `marketRepository.delete()` removes the market row, Postgres cascades and removes *any* remaining wager rows for that market — including ones with `status = 'refunded'` from an earlier individual `cancelWager` call — regardless of the scoped DELETE above. This is a narrower, lower-severity gap than CR-01 (a refunded wager's `wallet_transactions` row, written at cancellation time, already preserves that audit trail independently), and matches the reviewer's own suggested fix, which has the same characteristic. Not addressed here per the user's explicit "defer the rest" scope decision; worth a follow-up if `wagers` history for cancelled-then-market-deleted bets needs to survive too (would require changing the FK to `ON DELETE RESTRICT`/removing `CASCADE` and deleting explicitly, or a soft-delete instead of a hard `DELETE`).

## Skipped Issues (deferred, not attempted this pass)

### WR-01: Negative `limit`/`page` values reach raw SQL `LIMIT`/`OFFSET`
**File:** `src/repositories/notificationRepository.js:21-24`, `src/controllers/notificationsController.js:10-15`
**Reason:** Deferred by user decision — not a correctness blocker for this phase's NOTIF requirements.

### WR-02: Non-numeric notification `:id` leaks a raw Postgres error via 500
**File:** `src/controllers/notificationsController.js:33-36`
**Reason:** Deferred by user decision.

### WR-03: Idempotent duplicate-notification inserts logged as raw DB errors
**File:** `src/services/notificationService.js:26-36`
**Reason:** Deferred by user decision.

### WR-04: Fixed `wait(50)` sleep in test helper is a flaky pattern
**File:** `tests/helpers/testDb.js:118-125`
**Reason:** Deferred by user decision.

### IN-01, IN-02, IN-03
**Reason:** Deferred by user decision (Info-level, non-blocking).

---

_Fixed: 2026-07-14T14:02:17Z_
_Fixer: Claude (by hand, at user's request)_
_Iteration: 1_
