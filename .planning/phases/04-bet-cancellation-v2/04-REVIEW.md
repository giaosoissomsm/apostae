---
phase: 04-bet-cancellation-v2
reviewed: 2026-07-15T12:47:39Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/config/env.js
  - src/services/wagerService.js
  - tests/cashout.cancel-refund.test.js
  - tests/cancel.happy-path.test.js
  - tests/cancel.fee-computation.test.js
  - tests/cancel.audit.test.js
  - tests/cancel.blocking.test.js
  - tests/cancel.concurrency.test.js
  - tests/cancel.tampering.test.js
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-07-15T12:47:39Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

The `cancelWager` rewrite itself is solid on the dimensions this phase set out to fix: lock order is now market → wager → wallet consistently with `placeWager`/`cashoutWager`/`resolveMarket`/`deleteMarket` (verified against the pre-rewrite version at `005efd3^`, which locked the wager row first and threw `AuthorizationError` on ownership mismatch — both of those defects are gone); the IDOR check is now folded into `wagerRepository.findByIdForUpdate`'s `WHERE id = $1 AND market_id = $2 AND user_id = $3`, so a foreign wager id correctly 404s instead of 403ing; the hard cashout-block is checked before any fee/refund math runs and before `updateStatus` is called, so no partial-refund path can leak through; and the fee math is delegated to `money.applyFeePercent` rather than being recomputed inline. `env.js`'s new `[0,100]` bounds check on `CANCEL_FEE_PERCENT` correctly guards against the `fee > gross → negative refund` failure mode it documents. Traced the concurrency claims in `cancel.concurrency.test.js` against `cashoutWager` and `marketService.resolveMarket` and confirmed both also lock market-first, so the "never deadlock" claim holds structurally.

That said, I found one blocking repo-integrity issue and several real gaps that undercut the "financial correctness/auditability" bar this phase is held to.

## Critical Issues

### CR-01: `src/repositories/walletRepository.js` — hard dependency of `wagerService.js` was never committed to git

**File:** `src/repositories/walletRepository.js` (entire file; imported at `src/services/wagerService.js:3`)
**Issue:** `git ls-files src/repositories/` does not list `walletRepository.js` — it has no history at all (`git log --all -- src/repositories/walletRepository.js` returns nothing), and `git status` shows it as `??` (untracked). Every money-moving path in this file — `placeWager`, `cancelWager`, `cashoutWager` — and `marketService.resolveMarket`/`deleteMarket` require this module (`findByUserIdForUpdate`, `adjustBalance`, `recordTransaction`). A clean checkout of this repository (fresh clone, CI runner, another teammate's machine) would fail at `require('../repositories/walletRepository')` the instant any wallet-touching endpoint is hit — i.e. the entire betting/cashout/cancellation feature set, which is this project's stated core value, is currently un-shippable from version control as-is.
**Fix:**
```bash
git add src/repositories/walletRepository.js
git commit -m "fix: add walletRepository.js — was never committed, breaking all wallet-touching flows on a clean checkout"
```
Also worth adding a CI/pre-push check (`git status --porcelain` empty, or `git ls-files --others --exclude-standard` empty for `src/`) so an untracked file that the app depends on at runtime can't silently ride along in a working tree indefinitely.

## Warnings

### WR-01: `cancelWager`/`cashoutWager` never validate that `wagerId` is a finite number before it reaches Postgres

**File:** `src/services/wagerService.js:114` (`cancelWager`), `src/services/wagerService.js:199` (`cashoutWager`)
**Issue:** `placeWager` validates `market_id` with `Number.isFinite(marketId)` before using it (line 23). `cancelWager` and `cashoutWager` do not do the equivalent check on `wagerId` — it's passed straight from the controller (`Number(req.params.id)`, `src/controllers/wagersController.js:16`) into `client.query('SELECT market_id FROM wagers WHERE id = $1;', [wagerId])` with no route-level validation either (`src/routes/wagers.js:9`). A request like `DELETE /api/wagers/abc` produces `wagerId = NaN`. node-postgres's `prepareValue` (`node_modules/pg/lib/utils.js:69`) serializes any non-null, non-object value via `val.toString()`, so `NaN` is sent to Postgres as the literal text `"NaN"`, which Postgres rejects against the `integer` `wagers.id` column with `invalid input syntax for integer: "NaN"` (SQLSTATE `22P02`). This is a raw, non-operational error, so it isn't a `ValidationError`/`NotFoundError`/`ConflictError` — it propagates to `errorHandler.js`, whose "PostgreSQL error" branch only triggers `if (err.code && err.code.startsWith('P'))`, which — as this very file's own comment at line 210 says of the same error class — "nenhum SQLSTATE real faz" (no real Postgres SQLSTATE starts with `P`). So the branch never fires, `statusCode` defaults to 500, and `message = err.message` is sent back to the client verbatim, leaking raw database error text for a plain malformed-ID request. The team already fixed this exact class of bug for `idempotencyKey` length (line 213-215) but didn't apply the same defensive check to `wagerId` itself.
**Fix:**
```javascript
async cancelWager(wagerId, userId) {
  const wagerIdNum = Number(wagerId);
  if (!Number.isFinite(wagerIdNum)) throw new ValidationError('Aposta inválida.');
  const result = await transaction(async (client) => {
    const peek = await client.query('SELECT market_id FROM wagers WHERE id = $1;', [wagerIdNum]);
    // ...use wagerIdNum throughout
```
Apply the same guard to `cashoutWager`.

### WR-02: `wager.cancelled` event's `amount` field is repurposed to mean net refund, causing the cancellation notification to misstate the original bet size

**File:** `src/services/wagerService.js:182` (emission), consumed at `src/services/notificationService.js:52-60`
**Issue:** The event payload comment says `amount: result.netAmount, // preserva a semântica já existente de evt.amount lida por notificationService.js`. Before this phase, `CANCEL_FEE_PERCENT` was effectively 0 so `netAmount === grossAmount === wager.amount` and this was invisible. Now that a 5% fee is live, `notificationService.js` renders: `` `Sua aposta de R$${evt.amount.toFixed(2)} em "${evt.question}" foi cancelada e o valor foi devolvido pra sua carteira.` `` using `evt.amount` = net (95 on a 100 stake) — so the message literally tells the user their bet was R$95 when it was R$100, and never mentions the 5% fee at all, even though `grossAmount`/`feeAmount` are emitted alongside `amount` specifically to support this. Compare to the parallel `wager.cashed_out` handler (`notificationService.js:124-132`), which correctly phrases cashout in terms of what was actually withdrawn ("Você sacou R$X"), not as a claim about the original stake. `grossAmount`/`feeAmount` are emitted by `wagerService.js` but are not read anywhere (`grep` confirms zero consumers) — they're dead payload today.
**Fix:** Either rename the field at the source to make the semantics unambiguous and update the consumer to use both values:
```javascript
// wagerService.js
domainEvents.emit('wager.cancelled', {
  ...
  netAmount: result.netAmount,
  grossAmount: result.grossAmount,
  feeAmount: result.feeAmount,
});
```
```javascript
// notificationService.js
body: `Sua aposta de R$${evt.grossAmount.toFixed(2)} em "${evt.question}" foi cancelada. R$${evt.netAmount.toFixed(2)} foi devolvido pra sua carteira (taxa de R$${evt.feeAmount.toFixed(2)}).`,
```

### WR-03: `CANCEL_FEE_PERCENT`/`CASHOUT_FEE_PERCENT` startup validation accepts trailing garbage via `parseFloat` leniency

**File:** `src/config/env.js:37`, `src/config/env.js:42`
**Issue:** `parseFloat('5%')` returns `5` (parses the numeric prefix and silently ignores everything after it), so an operator typo like `CANCEL_FEE_PERCENT=5%` or `CANCEL_FEE_PERCENT=5 percent` passes the `Number.isFinite(...) && 0 <= x <= 100` guard cleanly instead of failing loudly at startup — exactly the failure mode this validation block was written to prevent (per its own comment: "operador digitando 500 em vez de 5"). A malformed value that happens to `parseFloat` to something in-range slips through undetected.
**Fix:**
```javascript
function parseStrictPercent(raw, fallback) {
  const str = raw === undefined ? fallback : raw;
  if (!/^-?\d+(\.\d+)?$/.test(str.trim())) return NaN; // forces the existing bounds check below to reject it
  return parseFloat(str);
}
// CANCEL_FEE_PERCENT: parseStrictPercent(process.env.CANCEL_FEE_PERCENT, '5'),
```

## Info

### IN-01: Heavy overlap between `tests/cashout.cancel-refund.test.js` and `tests/cancel.blocking.test.js`

**File:** `tests/cashout.cancel-refund.test.js:92-120`, `tests/cancel.blocking.test.js:104-142`
**Issue:** Both files assert the identical scenario (cashed_out_amount > 0 → `ConflictError`, wallet/status unchanged) with near-duplicate setup. The comments acknowledge this is intentional (one is a "carried-forward regression test," the other the canonical Plan 04-03 coverage), so this isn't a defect, just redundant maintenance surface — a future behavior change here means updating assertions in two places.
**Fix:** Consider deleting `tests/cashout.cancel-refund.test.js`'s second test (or the whole file, since its first test also fully overlaps `cancel.happy-path.test.js`) once `cancel.blocking.test.js`/`cancel.happy-path.test.js` are confirmed to be the canonical suite, to avoid drift between duplicate assertions.

### IN-02: Brittle regex-based source parsing in `cancel.tampering.test.js`

**File:** `tests/cancel.tampering.test.js:107-113`
**Issue:** The static "no `req.body` in controller" check parses `wagersController.js`'s source text with a regex (`/const cancelWager = catchAsync\(async \(req, res\) => \{[\s\S]*?\n\}\);/`) rather than testing behavior. Any harmless reformatting of the handler (e.g., destructuring params differently, adding a line break in the arrow signature) breaks this test without an actual regression, and conversely a subtle bypass (e.g. reading `req.body` via a helper function referenced by name rather than literally) wouldn't be caught.
**Fix:** Low priority given this is explicitly flagged in the test's own comments as a deliberate static/structural check with a documented rationale (no DB needed); if it becomes a maintenance burden, consider replacing with an integration test that actually sends a body and asserts it has no effect, alongside (not instead of) the arity check.

---

_Reviewed: 2026-07-15T12:47:39Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
