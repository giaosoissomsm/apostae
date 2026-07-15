---
phase: 02-partial-cashout
reviewed: 2026-07-14T18:09:02Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - src/config/env.js
  - src/controllers/wagersController.js
  - src/migrations/004_cashout.js
  - src/repositories/cashoutRepository.js
  - src/repositories/marketRepository.js
  - src/repositories/wagerRepository.js
  - src/routes/wagers.js
  - src/services/marketService.js
  - src/services/notificationService.js
  - src/services/wagerService.js
  - src/utils/money.js
  - tests/cashout.audit.test.js
  - tests/cashout.computation.test.js
  - tests/cashout.concurrency.test.js
  - tests/cashout.controller.test.js
  - tests/cashout.idempotency.test.js
  - tests/cashout.notification.test.js
  - tests/cashout.resolution-integration.test.js
  - tests/cashout.validation.test.js
  - tests/helpers/testDb.js
  - tests/money.test.js
findings:
  critical: 3
  warning: 3
  info: 1
  total: 7
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-07-14T18:09:02Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Partial Cashout's lock ordering (market→wager→wallet), IDOR mitigation (ownership baked into the `FOR UPDATE` WHERE clause), server-side-only payout computation, parameterized SQL, and mass-assignment defenses at the controller boundary are all implemented correctly and match the codebase's proven patterns. `src/utils/money.js` is a solid integer-cents utility with a genuine IEEE-754 edge-case fix. `marketService.resolveMarket()`'s win-payout scaling (RESEARCH.md Pitfall 2) is implemented correctly and is the one code path the phase's own research called out.

However, this review found **three Critical/financial-integrity bugs**, none of which were caught by the shipped test suite — because every test file that would have exercised them was validated only via mocks/scratchpad dry-runs, never against a real PostgreSQL instance (confirmed by every plan's SUMMARY.md, e.g. 02-04, 02-07). Mocked/simulated Postgres clients do not reproduce real Postgres transaction-abort semantics, and none of the shipped code paths that pay back `wager.amount` on cancellation/deletion were audited for the same `cashed_out_amount` gap that `resolveMarket` was fixed for. Both classes of bug are exactly the "second/third code path" risk this review was specifically asked to check for (see specific_focus item 4), and both are real, reproducible, and un-mitigated in the current source.

## Critical Issues

### CR-01: Idempotent-replay path is broken by Postgres transaction-abort semantics — CASHOUT-07 fails on any real retry

**File:** `src/services/wagerService.js:179-202`
**Issue:** `cashoutWager`'s idempotency handling attempts `cashoutRepository.create(...)` inside the single `transaction()` block, and on a `23505` (unique-violation on `wager_cashouts(wager_id, idempotency_key)`) it catches the error and immediately issues `cashoutRepository.findByIdempotencyKey(wagerId, idempotencyKey, client)` **using the same `client`, in the same still-open transaction**:

```js
try {
  cashout = await cashoutRepository.create({ ... }, client);
} catch (err) {
  if (err.code === '23505') {
    cashout = await cashoutRepository.findByIdempotencyKey(wagerId, idempotencyKey, client);
    isReplay = true;
  } else {
    throw err;
  }
}
```

In PostgreSQL, once any statement inside a `BEGIN`/`COMMIT` block raises an error (including a unique-violation), the entire transaction enters an **aborted** state and every subsequent statement on that same connection fails with `ERROR: current transaction is aborted, commands ignored until end of transaction block` (SQLSTATE `25P02`) until an explicit `ROLLBACK` (or `ROLLBACK TO SAVEPOINT`, if a savepoint was established before the failing statement). No `SAVEPOINT` exists anywhere in this codebase (confirmed via `grep -rn "SAVEPOINT" src/` — zero results), and `src/config/database.js`'s `transaction()` helper does not create one either.

Concretely: the `findByIdempotencyKey` SELECT that is supposed to return the previously-committed row will itself throw `25P02`, which is **not** `23505`, so it is not caught by anything in `cashoutWager` — it propagates out of the `transaction()` callback, triggers `ROLLBACK` (a no-op, since the transaction was already aborted server-side), and surfaces to the caller as an unhandled 500 error rather than the intended idempotent-replay result. This breaks CASHOUT-07 (a mandatory requisitos.txt attack vector: "replay attacks") on **every** retry with a colliding `(wager_id, idempotency_key)` — both the sequential-retry and the genuinely-concurrent-retry scenarios in `tests/cashout.idempotency.test.js`.

This was not caught because every SUMMARY for the plans touching this code (02-02, 02-04, 02-07) explicitly documents that verification happened only via "a temporary mock-backed jest dry run" or a "fake Postgres client" that "emulates ... a simulated `23505` error" — none of these simulations reproduce PostgreSQL's server-side aborted-transaction cascade, so the mocks pass while real Postgres would not. `tests/cashout.idempotency.test.js` (both tests) and the concurrent-replay leg of `tests/cashout.concurrency.test.js`'s idempotency-adjacent scenarios were never actually run against a live database, per every plan's own "Issues Encountered" section.

**Fix:** Wrap the speculative INSERT in a `SAVEPOINT` and roll back to it (not the whole transaction) before reading the existing row:
```js
await client.query('SAVEPOINT cashout_insert');
let cashout;
let isReplay = false;
try {
  cashout = await cashoutRepository.create({ ... }, client);
} catch (err) {
  if (err.code === '23505') {
    await client.query('ROLLBACK TO SAVEPOINT cashout_insert');
    cashout = await cashoutRepository.findByIdempotencyKey(wagerId, idempotencyKey, client);
    isReplay = true;
  } else {
    throw err;
  }
}
```
This must then be exercised against a real PostgreSQL instance (not a mock) before CASHOUT-07 can be considered verified — the mock/dry-run compensations used throughout this phase are structurally incapable of catching this class of bug.

---

### CR-02: `cancelWager` refunds the full original stake, ignoring `cashed_out_amount` — double-pay via cancellation after a partial cashout

**File:** `src/services/wagerService.js:80-128` (specifically line 101)
**Issue:** `cancelWager` only checks `wager.status !== 'pending'` before refunding — a wager with a prior partial cashout is still `status = 'pending'` (cashout never changes wager status), so nothing prevents a user from cashing out part of a wager and then canceling the remainder:

```js
if (wager.status !== 'pending') throw new ConflictError('Essa aposta não pode mais ser cancelada.');
...
const updated = await walletRepository.adjustBalance(wallet.id, Number(wager.amount), client);
```

`wager.amount` is the **original, full** stake — it is never reduced by `cashed_out_amount`. Concrete repro: place a $100 wager (debits $100), cash out $40 of stake at 2x odds (credits $80 net, per the stake-proportional formula this phase implements), then cancel the same wager while it is still `pending` → the user is refunded the **full original $100** on top of the $80 already received from the cashout. Correct behavior is to refund only the remaining, non-cashed-out stake (`wager.amount - wager.cashed_out_amount` = $60). The bug manufactures $40 of value from nothing, a direct violation of CLAUDE.md's Core Value ("a user's balance must never diverge from the sum of their recorded transactions").

This is the exact class of bug RESEARCH.md's Pitfall 2 identified for `resolveMarket()` — but the fix in Plan 02-03 was scoped ("single-line-level fix," "did not touch ... any other part of resolveMarket") strictly to `resolveMarket`'s win branch, and neither the research nor any later plan revisited `cancelWager` (which also refunds `wager.amount` unconditionally) for the same class of gap. No test in the shipped suite exercises "cancel a wager after a prior partial cashout."

**Fix:**
```js
const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);
const updated = await walletRepository.adjustBalance(wallet.id, remainingStake, client);
await walletRepository.recordTransaction({
  ...
  amount: remainingStake,
  ...
});
```
And add a regression test seeding a wager with `cashedOutAmount > 0` before calling `cancelWager`, asserting the refund equals only the remaining stake.

---

### CR-03: `deleteMarket` refunds the full original stake for every pending wager, ignoring `cashed_out_amount` — same double-pay bug via a second code path

**File:** `src/services/marketService.js:207-251` (specifically lines 216-235)
**Issue:** Identical bug to CR-02, in the admin-triggered market-deletion path. `deleteMarket` iterates every `pending` wager (via `wagerRepository.findPendingByMarket`, which returns wagers regardless of `cashed_out_amount`) and refunds `wager.amount` in full:

```js
for (const wager of pendingWagers) {
  const wallet = await walletRepository.findByUserIdForUpdate(wager.user_id, client);
  const balanceBefore = wallet.balance;
  const updated = await walletRepository.adjustBalance(wallet.id, wager.amount, client);
  ...
}
```

If an admin deletes a market that has a pending wager with a prior partial cashout, the user receives the full original stake refunded on top of the cashout net value already credited — the same double-pay pattern as CR-02, just triggered by a different actor (admin action instead of the wager owner).

This confirms specific_focus item 4's concern generalizes beyond `resolveMarket`: there are now **three** pre-existing "pay back `wager.amount`" code paths in this codebase (`resolveMarket`, `cancelWager`, `deleteMarket`), and this phase's research/planning only identified and fixed one of them.

**Fix:** Same pattern as CR-02 — refund `Number(wager.amount) - Number(wager.cashed_out_amount)` instead of the raw `wager.amount`, and add a regression test for "delete a market with a pending, partially-cashed-out wager."

## Warnings

### WR-01: No bounds validation on `CASHOUT_FEE_PERCENT` — a misconfigured value can turn a "cashout" into a wallet debit

**File:** `src/config/env.js:37`, `src/utils/money.js:44-47`, `src/services/wagerService.js:175`
**Issue:** `env.CASHOUT_FEE_PERCENT` is read with `parseFloat(process.env.CASHOUT_FEE_PERCENT || '0')` with no range check. `money.applyFeePercent(gross, feePercent)` computes `fee = gross * (feePercent / 100)` with no clamp — if `feePercent` is ever configured above 100 (e.g. an operator typo, `500` instead of `5`), `fee > gross`, so `net = gross - fee` goes **negative**. `cashoutWager` then calls `walletRepository.adjustBalance(wallet.id, Number(cashout.net_value), client)` with that negative value — an endpoint whose entire contract is "credits the wallet" would silently debit it instead, with no guard anywhere catching this.
**Fix:** Validate `CASHOUT_FEE_PERCENT` is within `[0, 100]` at startup in `env.js` (throw on out-of-range, matching the existing `required` env-var validation pattern), and/or assert `net >= 0` in `cashoutWager` before crediting the wallet.

### WR-02: `idempotencyKey` has no server-side max-length validation before hitting the `VARCHAR(200)` column

**File:** `src/services/wagerService.js:143-145`
**Issue:** The only validation on `idempotencyKey` is `!idempotencyKey || typeof idempotencyKey !== 'string'`. `wager_cashouts.idempotency_key` is `VARCHAR(200)`; a client submitting a longer key triggers a Postgres `22001` ("value too long for type character varying(200)") error inside the transaction. Unlike `23505`, this code is not specially handled anywhere, so it propagates to `errorHandler.js`, which only special-cases codes starting with `'P'` (a check that, incidentally, never matches real PostgreSQL SQLSTATE codes like `22001`/`23505`/`25P02` — none of them start with `P`). The request fails with a generic 500 whose `message` is the raw Postgres error text (column/table name included), not the operational `ValidationError` the rest of this phase's validation consistently uses.
**Fix:** Add `idempotencyKey.length > 200` to the pre-lock validation block in `cashoutWager`, throwing `ValidationError` alongside the existing checks.

### WR-03: Idempotent-replay path's `remainingStakeAfter` is computed from potentially stale `wager` fields (contingent on CR-01)

**File:** `src/services/wagerService.js:227-229`
**Issue:** On the `isReplay` branch, `remainingStakeAfter = Number(wager.amount) - Number(wager.cashed_out_amount)` uses the `wager` row locked earlier in *this* transaction (after the original successful cashout already committed), so the value itself is not stale relative to the DB — but this whole branch is currently unreachable in practice because of CR-01 (the code never gets past the `findByIdempotencyKey` call). Once CR-01 is fixed, this line should be re-verified against a live-DB idempotency test, since it was never actually exercised (per every SUMMARY's own admission that only mocks reached this branch).
**Fix:** No code change required beyond CR-01's fix; flagging so this line gets explicit live-DB test coverage once the savepoint fix lands, rather than being assumed correct because a mock exercised it.

## Info

### IN-01: `errorHandler.js`'s Postgres-error detection (`err.code.startsWith('P')`) does not match any real PostgreSQL SQLSTATE code

**File:** `src/middleware/errorHandler.js:42` (pre-existing, not modified by this phase, but directly relevant to WR-02/CR-01's failure mode)
**Issue:** Real PostgreSQL SQLSTATE codes (`23505`, `25P02`, `22001`, `42601`, etc.) never start with the letter `P`, so this branch never fires for actual database errors, and every unhandled Postgres error (including the `25P02` from CR-01 and the `22001` from WR-02) falls through to the generic `message: err.message` response — leaking raw database error text to API clients instead of returning the generic "Erro ao processar requisição no banco de dados" message the code intends.
**Fix:** Out of this phase's direct scope (pre-existing file, not in the reviewed file list), but worth flagging since two of this phase's new failure modes (CR-01, WR-02) route directly through this dead branch. Consider fixing the check to match real SQLSTATE prefixes (e.g., `23`, `22`, `25`, `42`) in a follow-up.

---

_Reviewed: 2026-07-14T18:09:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
