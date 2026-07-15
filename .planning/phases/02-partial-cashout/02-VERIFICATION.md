---
phase: 02-partial-cashout
verified: 2026-07-14T19:30:00Z
status: human_needed
score: 1/5 truths fully verified (behavior-proven); 4/5 present + wired but behavior-unverified
behavior_unverified: 4
overrides_applied: 0
re_verification: No — initial verification
behavior_unverified_items:
  - truth: "After a partial cashout, the wager's remaining stake stays active and is still eligible for resolution/payout on the non-cashed-out portion (CASHOUT-03)"
    test: "Run `DB_NAME=<a *test*-named DB> NODE_ENV=test npx jest tests/cashout.resolution-integration.test.js` against a reachable Postgres test database."
    expected: "Regression case (cashed_out_amount=0) pays the full original potential_payout (200); scaled case (cashed_out_amount=40) pays exactly 120 (200 * 60/100), not 200."
    why_human: "resolveMarket()'s remaining-fraction payout scaling is a state-transition (wager status → won/lost + wallet credit) that only real Postgres row-locking/commit semantics can prove. No *test*-named database is reachable in this sandbox (assertTestDatabase() correctly refuses the 'apostae' dev/prod DB). Source read confirms the fix (money.multiply(potential_payout, remainingFraction)) is present and correct."
  - truth: "Cashouts below a minimum amount are rejected, and any cashout attempt is rejected once the market is closed or the wager is resolved (CASHOUT-04, CASHOUT-05)"
    test: "Run `npx jest tests/cashout.validation.test.js` against a reachable Postgres test database."
    expected: "amount<=0 throws ValidationError pre-lock; closed-market and non-pending-wager wagers throw ConflictError after lock+re-validation; requesting the exact remaining stake throws ValidationError; rejected paths never emit wager.cashed_out."
    why_human: "Rejection paths require real locked rows (market.status='closed', wager.status!='pending') read back from Postgres inside a real transaction — a mock cannot reproduce the lock-then-revalidate sequence faithfully (this is exactly the class of gap CR-01 proved mocks miss). No live test DB reachable in this sandbox. Note: CASHOUT-04's 'minimum amount' is satisfied by a documented business decision (STATE.md: 'No minimum cashout amount — confirmed by project owner... satisfied by the existing positive-amount validation only') — this is a locked scope decision, not a code gap."
  - truth: "Two concurrent cashout requests, or a retried request with the same idempotency key, on the same wager can never both succeed — verified by a concurrency test that fires simultaneous requests (CASHOUT-06, CASHOUT-07)"
    test: "Run `npx jest tests/cashout.concurrency.test.js tests/cashout.idempotency.test.js tests/cashout.savepoint-replay.test.js` against a reachable Postgres test database (the third file already runs live via mocks and passes — see evidence)."
    expected: "Over-subscribed concurrent requests: exactly one fulfilled, one rejected; under-subscribed: both succeed without data loss. Idempotency: sequential and Promise.all-concurrent retries with the same key never double-credit the wallet or double-increment cashed_out_amount."
    why_human: "This is the single highest-risk truth in the phase and the exact one where a real, reproducible bug (CR-01) was found by code review AFTER every mock-backed test file in Plans 02-02/02-04/02-07 reported green — Postgres's real transaction-abort semantics (SQLSTATE 25P02) are structurally impossible to reproduce with a mocked client. CR-01 is now fixed in source (SAVEPOINT/ROLLBACK TO SAVEPOINT, verified present and in the correct order by a live-passing mock-ordering test), but the fix itself has never been exercised against real Postgres row-lock contention or a real 23505 collision. No live test DB reachable in this sandbox."
  - truth: "Every cashout produces a wallet transaction record and an audit log entry, uses shared decimal-safe money math (no float rounding drift across repeated cashouts), and works identically regardless of market type (CASHOUT-08, CASHOUT-09, CASHOUT-10)"
    test: "Run `npx jest tests/cashout.audit.test.js` against a reachable Postgres test database."
    expected: "Exactly one wallet_transactions row per successful cashout (type='credit', related_entity='cashout'), amount/balance_before/balance_after reconcile exactly with the wallet's real balance column."
    why_human: "Audit-trail persistence (INSERT + balance UPDATE inside one commit) is a state-transition that requires real Postgres to prove no drift/duplication. No live test DB reachable in this sandbox. Note: the CASHOUT-09 (market-type-agnostic) and CASHOUT-10 (decimal-safe money math) sub-parts of this truth ARE fully behavior-verified without a DB — see Observable Truths row 5 and money.test.js (8/8 passing live)."
---

# Phase 2: Partial Cashout Verification Report

**Phase Goal:** Users can cash out part of an open, pending wager's value before resolution; the value is computed and locked safely and atomically server-side, and the remaining stake stays active for resolution.
**Verified:** 2026-07-14T19:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Environment Limitation (read before the findings below)

No isolated `*test*`-named Postgres database is reachable from this sandbox — only the real `apostae` dev/prod database connects, and `tests/helpers/testDb.js`'s `assertTestDatabase()` guard correctly refuses to run destructive/integration DDL/DML against it. Running the full suite reproduces this exactly:

```
Test Suites: 15 failed, 3 passed, 18 total
Tests:       56 failed, 14 passed, 70 total
```

All 15 failing suites fail with the identical `assertTestDatabase()` guard error (confirmed by re-running the suite in this session). The 3 passing suites (`money.test.js`, `cashout.savepoint-replay.test.js`, `cashout.controller.test.js` — 14/14 tests) are exactly the ones that are pure-unit or mock-backed and require no live database connection. This is the same pre-existing, already-documented (STATE.md) infrastructure limitation Phase 1's verification hit — not a Phase 2 regression. Per the task's explicit instruction, this phase is **not** marked `gaps_found` solely for this reason; unproven DB-dependent truths are routed to human verification below, mirroring Phase 1's `01-VERIFICATION.md` approach exactly.

## Code Review Fix Verification (CR-01, CR-02, CR-03, WR-01, WR-02) — read directly from current source, not from REVIEW-FIX.md's claims

`02-REVIEW.md` found 3 Critical financial-integrity bugs, all in already-shipped, previously-reviewed code, none caught by the phase's own mock-backed test suite:

| Finding | Claim in 02-REVIEW-FIX.md | Verified in current source? | Evidence |
|---|---|---|---|
| CR-01 | Idempotent-replay broken by Postgres transaction-abort semantics (25P02); fixed via SAVEPOINT | ✓ Confirmed landed | `src/services/wagerService.js:203-231` — `SAVEPOINT cashout_insert` issued before the speculative INSERT; on `23505`, `ROLLBACK TO SAVEPOINT cashout_insert` runs *before* `findByIdempotencyKey`. `tests/cashout.savepoint-replay.test.js` runs live (mocked DB/repos, real unmodified `cashoutWager`) and passes 2/2, asserting the exact operation order `SAVEPOINT → INSERT_ATTEMPT → ROLLBACK_TO_SAVEPOINT → REPLAY_SELECT` and that the replay path never re-credits the wallet or re-increments `cashed_out_amount`. |
| CR-02 | `cancelWager` refunded full `wager.amount`, ignoring `cashed_out_amount` (double-pay) | ✓ Confirmed landed | `src/services/wagerService.js:106-120` — `remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount)` now used for both `adjustBalance` and `recordTransaction`, and for the `wager.cancelled` event payload. `tests/cashout.cancel-refund.test.js` (real Postgres integration test, DB-dependent, not executable in this sandbox) covers both the regression case (100 refunded, no prior cashout) and the repro case (60 refunded, not 100, with `cashed_out_amount=40`). |
| CR-03 | `deleteMarket` refunded full `wager.amount` per pending wager, ignoring `cashed_out_amount` (same double-pay, admin path) | ✓ Confirmed landed | `src/services/marketService.js:228-244` — same `remainingStake` pattern applied inside the `deleteMarket` refund loop, used for `adjustBalance`, `recordTransaction`, and the `refundList` entry feeding `market.deleted`. `tests/cashout.delete-market-refund.test.js` (DB-dependent) covers both cases. |
| WR-01 | No bounds validation on `CASHOUT_FEE_PERCENT` (could turn a credit into a debit) | ✓ Confirmed landed | `src/config/env.js:59-63` — throws at require-time (any environment) if `CASHOUT_FEE_PERCENT` is not finite or outside `[0, 100]`. Live-verified in this session: `node -e "require('./src/config/env')"` loads cleanly with the default (`0`). |
| WR-02 | `idempotencyKey` had no server-side max-length check before hitting the `VARCHAR(200)` column | ✓ Confirmed landed | `src/services/wagerService.js:161-163` — `idempotencyKey.length > 200` now throws `ValidationError` in the pre-lock validation block, before the transaction opens. |

**Conclusion:** All 5 in-scope fixes (CR-01/02/03, WR-01/02) are present in the current source, structurally correct, syntax-valid (`node --check` clean on every modified file), and match the review's exact fix recommendations — this is not just a REVIEW-FIX.md claim, it was independently re-derived by reading `wagerService.js`/`marketService.js`/`env.js` directly. WR-03 required no code change (confirmed correct by the review itself) and the `isReplay` branch it flagged is reachable now that CR-01 is fixed. IN-01 was explicitly out of scope (pre-existing file) and was not touched, as documented.

**Residual gap the review itself did not catch (informational only, not a required-requirement blocker):** `money.applyFeePercent` allows `feePercent` up to 100 inclusive (WR-01's bound), and at exactly `feePercent=100`, `net=0`. `wallet_transactions.amount` has `CHECK (amount > 0)` (migration 002), so a `CASHOUT_FEE_PERCENT=100` configuration would make every cashout's `recordTransaction` call fail with an unhandled Postgres `23514` check-violation. This is an extreme boundary value (100% fee) far outside this milestone's locked default (`0`, BR-1) and is not a CASHOUT-01..10 requirement violation — flagged for awareness, not scored as a gap.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | User can request a cashout on part of an open, pending wager and receive a value computed entirely server-side using the stake-proportional formula — a client-submitted amount is always rejected (CASHOUT-01, CASHOUT-02) | ✓ VERIFIED | `src/services/wagerService.js:147-193` computes `gross`/`fee`/`net` exclusively via `money.multiply`/`money.applyFeePercent` from `wager.odds_at_time` and the validated `requestedStake` — never a client-supplied value. `src/controllers/wagersController.js` destructures only `{ amount, idempotency_key }` from `req.body`; `wagerId`/`userId` come exclusively from `req.params.id`/`req.user.id`. `tests/cashout.controller.test.js` (4/4, live-passing, no DB needed) proves mass-assignment (`userId`/`wagerId` in body) and parameter-tampering (`netValue`/`payout`/`value` in body) are both ignored. `tests/money.test.js` (8/8, live-passing) proves the underlying formula math is drift-free. Full DB-persisted round-trip is unproven live (see behavior_unverified). |
| 2 | After a partial cashout, the wager's remaining stake stays active and is still eligible for resolution/payout on the non-cashed-out portion (CASHOUT-03) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `src/services/marketService.js:141-142` computes `remainingFraction = (wager.amount - wager.cashed_out_amount) / wager.amount` and pays `money.multiply(wager.potential_payout, remainingFraction)`, reducing to the original full payout when `cashed_out_amount=0`. `tests/cashout.resolution-integration.test.js` exists and is structurally correct but is DB-dependent and unexecuted in this sandbox. |
| 3 | Cashouts below a minimum amount are rejected, and any cashout attempt is rejected once the market is closed or the wager is resolved (CASHOUT-04, CASHOUT-05) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `cashoutWager` rejects `amount<=0` pre-lock (ValidationError), and after locking re-validates `market.status==='open'` and `wager.status==='pending'` (ConflictError otherwise) — code confirmed present and correctly ordered. `tests/cashout.validation.test.js` covers all 5 rejection paths but is DB-dependent and unexecuted. CASHOUT-04's exact "minimum" is a documented business decision (STATE.md: no floor beyond the positive-amount check, confirmed by project owner) — not a code gap. |
| 4 | Two concurrent cashout requests, or a retried request with the same idempotency key, on the same wager can never both succeed — verified by a concurrency test that fires simultaneous requests (CASHOUT-06, CASHOUT-07) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Fixed market→wager→wallet `FOR UPDATE` lock order confirmed in source; `UNIQUE(wager_id, idempotency_key)` present in migration 004; CR-01's SAVEPOINT fix confirmed present and correctly ordered by a live-passing mock test (`cashout.savepoint-replay.test.js`, 2/2). `tests/cashout.concurrency.test.js` and `tests/cashout.idempotency.test.js` exist, are structurally correct, but require real Postgres row-lock contention to prove — this is precisely the class of truth where a real bug (CR-01) previously escaped mock-based testing. Not executed live. |
| 5 | Every cashout produces a wallet transaction record and an audit log entry, uses shared decimal-safe money math, and works identically regardless of market type (CASHOUT-08, CASHOUT-09, CASHOUT-10) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | CASHOUT-10 (money math) is fully live-verified: `tests/money.test.js` 8/8 passing, including a 20-iteration drift-accumulation guard. CASHOUT-09 (market-type-agnostic) is statically verified: region-scoped grep on `cashoutWager`'s method body confirms zero references to `wager.choice`. CASHOUT-08 (wallet_transactions audit row) is implemented (`walletRepository.recordTransaction` called with `type:'credit'`, `related_entity:'cashout'`, `related_id: cashout.id`) but `tests/cashout.audit.test.js`'s DB-backed reconciliation assertions are unexecuted in this sandbox. |

**Score:** 1/5 truths fully verified (behavior-proven); 4/5 present + wired but behavior-unverified (blocked on live-DB test execution, environment limitation, not a code defect).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/utils/money.js` | Decimal-safe money utility (CASHOUT-10) | ✓ VERIFIED | `toCents`/`fromCents`/`multiply`/`subtract`/`applyFeePercent`, integer-cents with `Number.EPSILON` correction; `tests/money.test.js` 8/8 passing live |
| `src/migrations/004_cashout.js` | `wager_cashouts` table + `wagers.cashed_out_amount` column | ✓ VERIFIED | `UNIQUE(wager_id, idempotency_key)`, `NUMERIC(15,2)` throughout, mirrored 2-step down; auto-discovered by `scripts/migrate.js`'s sorted `readdirSync` |
| `src/config/env.js` `CASHOUT_FEE_PERCENT` | Default 0, bounds-validated | ✓ VERIFIED | Defaults to `0`; `[0,100]` bounds check added by WR-01 fix, throws at require-time in any environment |
| `src/repositories/cashoutRepository.js` | `create`/`findByIdempotencyKey`, client-scoped | ✓ VERIFIED | `create` lets `23505` bubble (no internal catch), `RETURNING *` present |
| `src/repositories/wagerRepository.js` `findByIdForUpdate`/`incrementCashedOutAmount` | IDOR-safe lock + cumulative update | ✓ VERIFIED | `WHERE id = $1 AND market_id = $2 AND user_id = $3 FOR UPDATE` (ownership baked into lock); `incrementCashedOutAmount` additive |
| `src/repositories/marketRepository.js` `findByIdForUpdate` | Reusable market lock | ✓ VERIFIED | `SELECT * FROM markets WHERE id = $1 FOR UPDATE` |
| `src/services/wagerService.js` `cashoutWager` | Core financial transaction | ✓ VERIFIED, WIRED | Validates → locks market→wager→wallet → revalidates → computes via money.js → SAVEPOINT-protected idempotent insert → credits wallet → emits after commit. All CR/WR fixes present. |
| `src/services/marketService.js` `resolveMarket`/`deleteMarket` | Remaining-stake-aware payout/refund | ✓ VERIFIED, WIRED | Both paths now use `wager.amount - wager.cashed_out_amount` (CR-03 fix present in `deleteMarket`, pre-existing fix confirmed in `resolveMarket`) |
| `src/controllers/wagersController.js` `cashoutWager` | Whitelisted body destructuring | ✓ VERIFIED, WIRED | Only `{amount, idempotency_key}` read from body; `tests/cashout.controller.test.js` 4/4 live-passing |
| `src/routes/wagers.js` `POST /:id/cashout` | Authenticated route | ✓ VERIFIED, WIRED | `requireAuth` middleware, registered correctly |
| `src/services/notificationService.js` `wager.cashed_out` listener | Cashout-row-scoped notification | ✓ VERIFIED, WIRED | `relatedEntity:'cashout'`, `relatedId: evt.cashoutId` (never `evt.wagerId` — Pitfall 3 avoided) |
| `tests/*.test.js` (11 cashout files) | Real, non-stub test coverage | ✓ VERIFIED (source-level), ⚠️ UNEXECUTED (8 of 11 need live DB) | All files load (`npx jest --listTests`), contain real assertions against the actual interface contracts; `money.test.js`/`cashout.controller.test.js`/`cashout.savepoint-replay.test.js` run and pass live (14/14) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `wagersController.cashoutWager` | `wagerService.cashoutWager` | Direct call, whitelisted params | ✓ WIRED | `wagerService.cashoutWager(Number(req.params.id), req.user.id, {amount, idempotencyKey})` |
| `wagerService.cashoutWager` | `marketRepository.findByIdForUpdate` → `wagerRepository.findByIdForUpdate` → `walletRepository.findByUserIdForUpdate` | Fixed lock order inside `transaction()` | ✓ WIRED | Market locked first, wager second (ownership+market in WHERE), wallet third — matches `placeWager`/`resolveMarket`/`deleteMarket`, never `cancelWager`'s reverse order |
| `wagerService.cashoutWager` | `cashoutRepository.create`/`findByIdempotencyKey` | SAVEPOINT-protected idempotent insert | ✓ WIRED | CR-01 fix confirmed: `SAVEPOINT` → attempt → on `23505` → `ROLLBACK TO SAVEPOINT` → replay read |
| `wagerService.cashoutWager` (post-commit) | `domainEvents.emit('wager.cashed_out', ...)` → `notificationService` listener | Event bus, emitted strictly after `transaction()` resolves | ✓ WIRED | Emit outside the transaction closure (D-01 convention); listener uses `evt.cashoutId` for `relatedId` |
| `marketService.resolveMarket`/`deleteMarket` | `wager.cashed_out_amount` (migration 004 column) | Remaining-stake computation | ✓ WIRED | Both paths read `cashed_out_amount` and subtract it from `wager.amount`/`potential_payout` before crediting the wallet |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Money math is drift-free across repeated operations (CASHOUT-10) | `npx jest tests/money.test.js` | 8/8 passed | ✓ PASS |
| Controller forwards only whitelisted fields, ignores mass-assignment/tampering attempts | `npx jest tests/cashout.controller.test.js` | 4/4 passed | ✓ PASS |
| CR-01 SAVEPOINT fix issues operations in the correct order, replay never re-credits | `npx jest tests/cashout.savepoint-replay.test.js` | 2/2 passed | ✓ PASS |
| Resolution scaling, refund scaling, validation rejections, concurrency, idempotency, audit-trail reconciliation | `npx jest tests/cashout.resolution-integration.test.js tests/cashout.validation.test.js tests/cashout.concurrency.test.js tests/cashout.idempotency.test.js tests/cashout.audit.test.js tests/cashout.cancel-refund.test.js tests/cashout.delete-market-refund.test.js tests/cashout.notification.test.js tests/cashout.computation.test.js` | All 8 fail with the identical `assertTestDatabase()` guard error (no live test DB reachable) | ? SKIP — routed to human verification |
| Full suite run once (not filtered per-truth) | `npx jest` | 15 failed / 3 passed suites, 56 failed / 14 passed tests — all 56 failures are the identical DB-guard error | Documented above under Environment Limitation |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| CASHOUT-01 | 02-04, 02-06 | User can request a cashout quote for part of an open, pending wager's value | ✓ SATISFIED | `cashoutWager` + `POST /:id/cashout`, controller boundary live-tested |
| CASHOUT-02 | 02-04, 02-06 | Value computed by backend via stake-proportional formula, never from frontend | ✓ SATISFIED | `money.multiply`/`applyFeePercent`, region-scoped grep confirms no client-value read, live-tested at controller boundary |
| CASHOUT-03 | 02-03 | Remaining stake stays active, eligible for resolution/payout | ? NEEDS HUMAN | Code present/correct (source read); DB-dependent test unexecuted |
| CASHOUT-04 | 02-04 | Minimum cashout amount enforced | ✓ SATISFIED (business-decision-scoped) | STATE.md documents project-owner-confirmed decision: positive-amount check only, no additional floor |
| CASHOUT-05 | 02-04 | Cashout only while market open AND wager pending | ? NEEDS HUMAN | Code present/correct (source read); DB-dependent test unexecuted |
| CASHOUT-06 | 02-02, 02-04, 02-07 | Concurrent cashout requests cannot both succeed | ? NEEDS HUMAN | Lock ordering present/correct; genuine concurrency proof requires live DB (highest-risk item, CR-01 precedent) |
| CASHOUT-07 | 02-01, 02-02, 02-04, 02-07 | Idempotent retries never double-apply | ? NEEDS HUMAN | CR-01 SAVEPOINT fix present and order-verified live via mock; real Postgres 23505/25P02 semantics unproven live |
| CASHOUT-08 | 02-05, 02-07 | Wallet transaction record + audit log entry on every cashout | ? NEEDS HUMAN | `recordTransaction` call present with correct fields; DB reconciliation test unexecuted |
| CASHOUT-09 | 02-04 | Market-type-agnostic (no binary-choice coupling) | ✓ SATISFIED | Region-scoped grep: zero `.choice` references inside `cashoutWager` |
| CASHOUT-10 | 02-01, 02-03 | Shared decimal-safe money utility, no float drift | ✓ SATISFIED | `tests/money.test.js` 8/8 passing live, including 20-iteration drift guard |

**No orphaned requirements** — all 10 CASHOUT-* IDs from REQUIREMENTS.md are claimed across plans 02-01 through 02-07's `requirements` frontmatter (union covers CASHOUT-01 through CASHOUT-10).

### Anti-Patterns Found

None. `grep -n -E "TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER"` across all phase-2-modified source files (`wagerService.js`, `marketService.js`, `notificationService.js`, `cashoutRepository.js`, `wagerRepository.js`, `marketRepository.js`, `wagersController.js`, `wagers.js`, `money.js`, `env.js`, `004_cashout.js`, `testDb.js`) returns zero matches. All files pass `node --check`. No debt markers, no stubs, no empty implementations.

### Human Verification Required

### 1. Live-DB run of the resolution/refund/validation/concurrency/idempotency/audit test suites

**Test:** With a reachable `*test*`-named PostgreSQL database (e.g. `apostae_test`) configured via `DB_*` env vars and `NODE_ENV=test`, run: `npx jest tests/cashout.resolution-integration.test.js tests/cashout.validation.test.js tests/cashout.concurrency.test.js tests/cashout.idempotency.test.js tests/cashout.audit.test.js tests/cashout.cancel-refund.test.js tests/cashout.delete-market-refund.test.js tests/cashout.notification.test.js tests/cashout.computation.test.js`
**Expected:** All 9 suites pass, in particular: (a) the CR-01 SAVEPOINT fix survives a real `23505` collision followed by a real `25P02`-avoiding replay read; (b) `cashout.concurrency.test.js`'s over-subscribed scenario shows exactly one success under real row-lock contention; (c) CR-02/CR-03's regression tests confirm cancellation/deletion refund only the remaining stake.
**Why human:** No live Postgres test database is reachable in this sandbox; this is the single blocking gap between "present, wired, and structurally correct" and "behavior-proven," and it is the exact class of gap that let CR-01 ship undetected in the first place — mocked tests cannot reproduce Postgres's transaction-abort semantics or genuine row-lock contention.

### 2. Manual review of the CASHOUT-04 "minimum amount" business-decision scoping

**Test:** Confirm with the project owner that "reject amount ≤ 0, no additional floor" is the intended final interpretation of CASHOUT-04/ROADMAP Success Criteria #3's "Cashouts below a minimum amount are rejected."
**Expected:** Either explicit sign-off that this interpretation is final, or a follow-up requirement/plan introducing a real `CASHOUT_MIN_AMOUNT` floor.
**Why human:** This is a product/business decision, not a code-verifiable fact — STATE.md documents it as already confirmed by the project owner during planning, but it's worth a final human checkpoint since the roadmap's own wording ("below a minimum amount") reads as implying a nonzero floor.

## Gaps Summary

No blocking gaps found. All 3 Critical financial-integrity bugs from `02-REVIEW.md` (CR-01, CR-02, CR-03) and both Warnings (WR-01, WR-02) are confirmed fixed in the current source — independently re-derived by reading `wagerService.js`, `marketService.js`, and `env.js` directly, not merely trusting `02-REVIEW-FIX.md`'s claims. All required artifacts exist, are substantive, and are correctly wired end-to-end (controller → service → repository → DB schema → notification listener). No anti-patterns, debt markers, or stub implementations were found in any phase-2-modified file. Requirements traceability is complete (10/10 CASHOUT-* IDs claimed, no orphans).

The phase is not `gaps_found` because every identified gap from code review has a confirmed, correctly-landed fix. It is `human_needed` because 4 of the 5 roadmap Success Criteria describe money-moving state transitions (resolution payout scaling, rejection-path re-validation, concurrent-request row-lock contention, idempotent-replay-under-real-Postgres-semantics, audit-trail reconciliation) that fundamentally require a live PostgreSQL instance to prove — and this sandbox has none reachable, a pre-existing infrastructure limitation carried forward from Phase 1, not a code defect introduced by this phase. This is the identical situation Phase 1's own verification reached (1/5 truths behavior-verified, 4/5 present_behavior_unverified), and per this session's explicit environment-constraint instruction, this phase is verified consistently with that precedent rather than blocked or failed on infrastructure grounds.

---

_Verified: 2026-07-14T19:30:00Z_
_Verifier: Claude (gsd-verifier)_
