---
phase: 04-bet-cancellation-v2
fixed_at: 2026-07-15T13:00:00Z
review_path: .planning/phases/04-bet-cancellation-v2/04-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-07-15T13:00:00Z
**Source review:** .planning/phases/04-bet-cancellation-v2/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (critical: 1, warning: 3; info findings IN-01/IN-02 excluded, out of `critical+warning` fix_scope)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: `src/repositories/walletRepository.js` was never committed to git

**Files modified:** `src/repositories/walletRepository.js` (newly tracked, no content change)
**Commit:** `7b86b3d`
**Applied fix:** `git add` + committed the file as-is. It already existed and worked correctly in the working tree — the defect was purely that it had never been staged/committed (`git log --all` showed no history, `git status` showed `??`), so a fresh clone or CI checkout would crash at `require('../repositories/walletRepository')` the instant any wallet-touching endpoint (`placeWager`, `cancelWager`, `cashoutWager`, `resolveMarket`, `deleteMarket`) was hit. Confirmed via `git status --porcelain` that the file is now tracked with no diff.

### WR-01: `cancelWager`/`cashoutWager` never validated `wagerId` was a finite number

**Files modified:** `src/services/wagerService.js`
**Commit:** `8de2b15`
**Applied fix:** Added `const wagerIdNum = Number(wagerId); if (!Number.isFinite(wagerIdNum)) throw new ValidationError('Aposta inválida.');` at the top of both `cancelWager` and `cashoutWager`, before the transaction opens — mirroring `placeWager`'s existing `marketId` guard. Every subsequent use of the raw `wagerId` inside both methods (the unlocked peek query, `wagerRepository.findByIdForUpdate`, `updateStatus`, `incrementCashedOutAmount`, `cashoutRepository.create`/`findByIdempotencyKey`, the emitted event payloads, and the audit-log description strings) was switched to `wagerIdNum`. A malformed id (e.g. `DELETE /api/wagers/abc`) now throws a clean `ValidationError` (400) instead of reaching Postgres as the literal string `"NaN"` and surfacing a raw `22P02` error through the 500 fallback path. `node --check` passed; `npm test` shows the same 3-pass/25-fail split as before the fix (all 25 failures are the pre-existing sandbox DB-guard, not new breakage).

### WR-02: `wager.cancelled` notification misstated the original stake as the net refund

**Files modified:** `src/services/wagerService.js`, `src/services/notificationService.js`, `tests/notifications.events.test.js`, `tests/notifications.emission.test.js`
**Commit:** `8de2b15`
**Applied fix:** `wagerService.cancelWager` now emits `netAmount`/`grossAmount`/`feeAmount` on `wager.cancelled` (previously emitted a reused `amount` field holding the net value, plus unused `grossAmount`/`feeAmount`). `notificationService.js`'s listener now reads all three fields and states the original stake, the refunded amount, and the fee explicitly: `"Sua aposta de R$100.00 ... foi cancelada. R$95.00 foi devolvido ... (taxa de R$5.00)."` Two Phase 1 tests (`notifications.events.test.js`, `notifications.emission.test.js`) asserted the old payload shape (`{ amount: 30 }`, `result: { ok: true }`) — these had already gone stale when 04-01 first rewrote `cancelWager`'s return value and payload (before this review), but nothing caught it since these DB-dependent tests can't execute in this sandbox (the `assertTestDatabase()` guard throws before reaching the assertion). Updated both to the corrected payload/result shape, using `money.applyFeePercent`/`env.CANCEL_FEE_PERCENT` in `notifications.emission.test.js` rather than hardcoding the expected fee/net numbers.

### WR-03: `CANCEL_FEE_PERCENT`/`CASHOUT_FEE_PERCENT` accepted trailing garbage via `parseFloat`

**Files modified:** `src/config/env.js`
**Commit:** `8de2b15`
**Applied fix:** Added a `parseStrictNumber()` helper requiring the full raw string to match `^-?\d+(\.\d+)?$` before calling `parseFloat`; both env vars now route through it instead of `parseFloat` directly. A value like `"5%"` or `"5 percent"` now parses to `NaN` and is rejected by the existing `[0,100]` bounds check at startup, instead of silently truncating to `5`.

## Skipped Issues

None — all 4 in-scope findings (CR-01, WR-01, WR-02, WR-03) were fixed. IN-01 (test duplication between `cashout.cancel-refund.test.js` and `cancel.blocking.test.js`/`cancel.happy-path.test.js`) and IN-02 (brittle regex-based structural test in `cancel.tampering.test.js`) are Info-level, out of the `critical+warning` fix_scope for this run, and were left as documented, low-priority, already-acknowledged items in `04-REVIEW.md`.

---

_Fixed: 2026-07-15T13:00:00Z_
_Fixer: Claude Sonnet 5 (orchestrator, applying gsd-code-reviewer findings inline)_
_Iteration: 1_
