---
phase: 04-bet-cancellation-v2
verified: 2026-07-15T12:59:58Z
status: human_needed
score: 1/5 truths fully verified (behavior-proven); 4/5 present + wired but behavior-unverified
behavior_unverified: 4
overrides_applied: 0
re_verification: No — initial verification
behavior_unverified_items:
  - truth: "User can cancel a wager while the market permits it; the cancellation automatically charges a 5% fee and refunds 95% of the wagered amount to the wallet, and the wager's status becomes 'Cancelada' (CANCEL-01, CANCEL-02, CANCEL-05)"
    test: "Run `DB_NAME=<a *test*-named DB> NODE_ENV=test npx jest tests/cancel.happy-path.test.js tests/cashout.cancel-refund.test.js` against a reachable Postgres test database."
    expected: "Cancelling a clean pending wager (amount 100, cashed_out_amount 0) returns { ok:true, refunded:95, fee:5 }, the real wallet balance increases by exactly 95, exactly one wallet_transactions row of type 'refund' is written, and wagers.status becomes 'refunded' (dashboard.js already maps this to \"Cancelada\")."
    why_human: "The end-to-end wallet-balance/status state transition (row lock, UPDATE, INSERT, commit) can only be proven against real Postgres. Source read confirms the code path (src/services/wagerService.js:114-192) is correct and money.applyFeePercent(100,5) === {fee:5, net:95} is proven live (tests/money.test.js, 8/8 passing, no DB needed) — but the persisted DB round-trip itself is unexecuted in this sandbox."
  - truth: "The 5% fee is computed off the wager's remaining stake after any prior partial cashout, never the original wagered amount (CANCEL-03)"
    test: "Run `npx jest tests/cancel.fee-computation.test.js` against a reachable Postgres test database."
    expected: "For amount=100 and amount=33.33 (decimal case), the service's returned fee/refunded exactly equal money.applyFeePercent(remainingStake, env.CANCEL_FEE_PERCENT), and remainingStake === wager.amount when cashed_out_amount=0."
    why_human: "remainingStake = wager.amount - wager.cashed_out_amount is confirmed present in source immediately before the money.applyFeePercent call (wagerService.js:155-156), and the branch order is deterministic — but proving the value that Postgres actually persists and returns requires a live DB run; unexecuted in this sandbox."
  - truth: "Every cancellation produces a wallet transaction record and an audit log entry (CANCEL-04)"
    test: "Run `npx jest tests/cancel.audit.test.js` against a reachable Postgres test database."
    expected: "Exactly one wallet_transactions row (type='refund', related_entity='wager') per cancellation; its amount/balance_before/balance_after reconcile exactly with the real wallets.balance column; description is human-readable and documents the fee."
    why_human: "Audit-row persistence + balance reconciliation is a state-transition that requires real Postgres to prove no drift/duplication. walletRepository.recordTransaction is confirmed called with the correct fields in source, but the DB-backed reconciliation assertions are unexecuted in this sandbox."
  - truth: "Cancellation is blocked once the market is closed, the wager is resolved, or a cashout has already occurred on that wager — enforced transactionally (row lock + re-validation) so it cannot race a concurrent cashout or market resolution, verified by a concurrency test (CANCEL-06, CANCEL-07)"
    test: "Run `npx jest tests/cancel.blocking.test.js tests/cancel.concurrency.test.js` against a reachable Postgres test database."
    expected: "The three CANCEL-06 block conditions (closed market, resolved wager, prior cashout) reject with ConflictError and zero side effects. cancel.concurrency.test.js's Promise.allSettled races (cancel vs cashout, cancel vs resolveMarket) never let both operations commit, never double-pay, and never surface a raw Postgres deadlock (40P01)."
    why_human: "This is the highest-risk truth in the phase: CANCEL-07's guarantee is fundamentally a real-Postgres-row-lock-contention proof that mocks are structurally incapable of reproducing (the plan's own STRIDE register and <human-check> instructions say this explicitly, echoing the identical class of gap — CR-01 — found by code review in Phases 2 and 3 of this milestone). Lock order (market->wager->wallet) and the cashout hard-block-before-fee-math ordering are confirmed present and correctly sequenced by direct source reading, but the actual concurrent-execution proof is unexecuted in this sandbox."
human_verification:
  - test: "Run `DB_NAME=<a *test*-named DB> NODE_ENV=test npx jest tests/cancel.happy-path.test.js tests/cancel.fee-computation.test.js tests/cancel.audit.test.js tests/cancel.blocking.test.js tests/cancel.concurrency.test.js tests/cashout.cancel-refund.test.js` (plus the IDOR case in tests/cancel.tampering.test.js) against a reachable Postgres test database."
    expected: "All suites pass with the expected 95%/5% split, ConflictError blocking, no-double-pay concurrency guarantees, and 404-not-403 IDOR behavior described above."
    why_human: "No live *test*-named Postgres is reachable in this sandbox (assertTestDatabase() correctly refuses the real 'apostae' dev DB) — this is the 6th consecutive phase in this milestone carried forward with the identical infrastructure blocker (Phases 1-3 all hit this same gap in their own verifications). This is an environment-access limitation, not a code defect."
---

# Phase 4: Bet Cancellation v2 Verification Report

**Phase Goal:** Users can cancel a pending wager for an automatic 5% fee (95% refunded), fully audited, replacing the old free/pending-only cancellation and blocked whenever market/wager/cashout state makes cancellation unsafe.
**Verified:** 2026-07-15T12:59:58Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Environment Limitation (read before the findings below)

No isolated `*test*`-named Postgres database is reachable from this sandbox — only the real `apostae` dev/prod database connects, and `tests/helpers/testDb.js`'s `assertTestDatabase()` guard correctly refuses to run integration DDL/DML against it. Running every phase-4 test file confirms this exactly:

```
npx jest tests/cancel.happy-path.test.js tests/cancel.fee-computation.test.js tests/cancel.audit.test.js \
         tests/cancel.blocking.test.js tests/cancel.concurrency.test.js tests/cancel.tampering.test.js \
         tests/cashout.cancel-refund.test.js
Test Suites: 7 failed, 7 total
Tests:       13 failed, 2 passed, 15 total
```

All 13 failures are the identical `assertTestDatabase()` guard error ("Recusando operar: DB_NAME=\"apostae\" não contém \"test\""), confirmed by counting the guard message across the run — never an assertion failure. The 2 passes are `tests/cancel.tampering.test.js`'s static/structural tests (no DB needed), which are isolated into their own `describe` block precisely so a DB outage never masks their own pass/fail signal. This is the identical carried-forward blocker documented in `02-VERIFICATION.md` and `03-VERIFICATION.md`, now a 6th consecutive occurrence across this milestone (per `.planning/STATE.md`'s "Known Environment Limitations" section) — an infrastructure-access limitation, not a code defect introduced by this phase.

## Code Review Fixes — Independently Re-Verified

`04-REVIEW.md` found 1 Critical + 3 Warnings; `04-REVIEW-FIX.md` claims all 4 fixed. Re-derived directly from current source rather than trusting the fix report:

- **CR-01** (`src/repositories/walletRepository.js` never committed to git): `git ls-files src/repositories/` now lists it, `git status --porcelain` shows clean, and `git log --oneline -- src/repositories/walletRepository.js` shows commit `7b86b3d`. **Confirmed fixed.**
- **WR-01** (`wagerId`/no finite-number guard): `wagerService.js:115-116` now has `const wagerIdNum = Number(wagerId); if (!Number.isFinite(wagerIdNum)) throw new ValidationError(...)` at the top of `cancelWager`, and the same guard exists in `cashoutWager` (line 203-204). Every subsequent use inside both methods was switched to `wagerIdNum`. **Confirmed fixed.**
- **WR-02** (`wager.cancelled` event misstating stake as net): `wagerService.js:180-188` now emits `netAmount`/`grossAmount`/`feeAmount` (no reused `amount` field); `notificationService.js:56` now reads all three and states gross, net, and fee explicitly. **Confirmed fixed.**
- **WR-03** (`parseFloat` trailing-garbage leniency): `env.js:9-12` now has a `parseStrictNumber()` helper requiring `^-?\d+(\.\d+)?$` before parsing; both `CASHOUT_FEE_PERCENT` and `CANCEL_FEE_PERCENT` route through it. Live-confirmed: `CANCEL_FEE_PERCENT='5%' node -e "require('./src/config/env')"` now throws `Invalid CANCEL_FEE_PERCENT: "5%"` instead of silently parsing to `5`. **Confirmed fixed.**

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | User can cancel a wager while the market permits it; the cancellation automatically charges a 5% fee and refunds 95% of the wagered amount to the wallet, and the wager's status becomes "Cancelada" (CANCEL-01, CANCEL-02, CANCEL-05) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `src/services/wagerService.js:114-192` computes the split exclusively via `money.applyFeePercent(remainingStake, env.CANCEL_FEE_PERCENT)`, sets `wagerRepository.updateStatus(wagerIdNum, 'refunded', client)`, and credits the wallet through `walletRepository.adjustBalance`/`recordTransaction`. `money.applyFeePercent(100, 5)` === `{fee:5, net:95}` is proven live (`tests/money.test.js`, 8/8 passing). `public/js/dashboard.js:246` confirms `refunded` → `'Cancelada'` label mapping and `dashboard.js:231-234` confirms the Cancelar button calls `Api.del('/wagers/:id')`, matching the unchanged route. The full DB-persisted round-trip (real balance delta, real status write) is unexecuted live — see behavior_unverified. |
| 2 | The 5% fee is computed off the wager's remaining stake after any prior partial cashout, never the original wagered amount (CANCEL-03) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `wagerService.js:155-156`: `const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);` computed and passed to `applyFeePercent` immediately after the CANCEL-06 cashout-block check. Confirmed by direct source read that this is the defensive formula the plan calls for (D-01: unreachable at non-zero `cashed_out_amount` in practice, since that path is blocked outright by truth #4 below). DB-backed proof (`tests/cancel.fee-computation.test.js`) unexecuted live. |
| 3 | Every cancellation produces a wallet transaction record and an audit log entry (CANCEL-04) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `wagerService.js:164-173` calls `walletRepository.recordTransaction` with `type:'refund'`, `relatedEntity:'wager'`, `relatedId: wager.id`, populated `balanceBefore`/`balanceAfter`, and a description documenting gross/fee/net (consistent with the project's established convention — per Phase 2's own verification, `wallet_transactions` is the audit trail for money-moving actions; the separate `audit_logs` table is reserved for admin/auth actions only, confirmed by grep — no phase-4 code writes to it, matching precedent). DB reconciliation test (`tests/cancel.audit.test.js`) unexecuted live. |
| 4 | Cancellation is blocked once the market is closed, the wager is resolved, or a cashout has already occurred on that wager — enforced transactionally (row lock + re-validation) so it cannot race a concurrent cashout or market resolution, verified by a concurrency test (CANCEL-06, CANCEL-07) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Lock order confirmed market→wager→wallet (`wagerService.js:125,137,161`), matching `placeWager`/`cashoutWager`/`resolveMarket`/`deleteMarket` (the reversed-order defect this phase set out to fix). The `cashed_out_amount > 0` hard block (`wagerService.js:147-149`) runs before any fee/refund math (`applyFeePercent` at line 156), confirmed by direct source read and by the plan's own automated structural verify command. `tests/cancel.blocking.test.js` (3 scenarios) and `tests/cancel.concurrency.test.js` (2 Promise.allSettled races against the real, unmodified `cashoutWager`/`resolveMarket`) exist, are structurally sound, and use the correct non-sequential race pattern — but require real Postgres `FOR UPDATE` row-lock contention to prove, which mocks are structurally incapable of reproducing (the exact class of gap — CR-01 — that escaped mock-only testing twice earlier in this milestone, per `02-REVIEW.md`/`03-REVIEW.md`). Unexecuted live. |
| 5 | The new logic replaces `cancelWager` in place — same route/method, no versioned endpoint or feature flag (CANCEL-08) | ✓ VERIFIED | `src/routes/wagers.js:9` still reads `router.delete('/:id', requireAuth, wagersController.cancelWager)` (confirmed by direct grep). `src/controllers/wagersController.js:15-18`'s `cancelWager` handler reads only `req.params.id`/`req.user.id`, never `req.body`. `wagerService.cancelWager.length === 2` (live-confirmed via `node -e`), proving the signature cannot silently smuggle a client-supplied fee/amount. `tests/cancel.tampering.test.js`'s 2 static/structural tests (route text + controller source + arity) **actually ran and passed live** (`npx jest tests/cancel.tampering.test.js` → 2 passed, 1 failed — the 1 failure is the separate DB-dependent IDOR test, isolated into its own describe block precisely so this static signal survives a DB outage). |

**Score:** 1/5 truths fully verified (behavior-proven); 4/5 present + wired but behavior-unverified (blocked on live-DB test execution, environment limitation, not a code defect).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/config/env.js` `CANCEL_FEE_PERCENT` | Default 5, `[0,100]`-bounds-validated, strict-numeric-parsed | ✓ VERIFIED | Live-confirmed default `5`; live-confirmed throws on `500` and on `'5%'` (WR-03 fix) |
| `src/services/wagerService.js` `cancelWager` | Core financial rewrite (lock order, IDOR, hard block, fee) | ✓ VERIFIED, WIRED | All must-have code paths present and correctly ordered per direct source read; `node -e "require(...)"` loads cleanly |
| `src/repositories/walletRepository.js` | Wallet lock/adjust/audit repository — CR-01 dependency | ✓ VERIFIED (now tracked in git) | `git ls-files`/`git log` confirm committed at `7b86b3d`; no content change, purely a repo-integrity fix |
| `src/services/notificationService.js` `wager.cancelled` listener | Correct gross/net/fee messaging — WR-02 fix | ✓ VERIFIED, WIRED | Reads `evt.grossAmount`/`evt.netAmount`/`evt.feeAmount`; matches emitted payload shape exactly |
| `tests/cashout.cancel-refund.test.js` | Updated regression test (95% net, hard block) | ✓ VERIFIED (source-level), ⚠️ UNEXECUTED | Asserts 95 net refund and `ConflictError` hard-block; no longer asserts the old 100/60 amounts |
| `tests/cancel.happy-path.test.js` | Clean-cancel 95%/5%/status test | ✓ VERIFIED (source-level), ⚠️ UNEXECUTED | Reads `CANCEL_FEE_PERCENT` from env, not hardcoded |
| `tests/cancel.fee-computation.test.js` | Fee-off-remaining-stake, matches money util | ✓ VERIFIED (source-level), ⚠️ UNEXECUTED | Pins to `money.applyFeePercent`, exercises decimal case (33.33) |
| `tests/cancel.audit.test.js` | Exactly-one-reconciling-row test | ✓ VERIFIED (source-level), ⚠️ UNEXECUTED | Reconciles `balance_before`/`balance_after` with real wallet balance |
| `tests/cancel.blocking.test.js` | Three CANCEL-06 block-condition tests | ✓ VERIFIED (source-level), ⚠️ UNEXECUTED | Closed market, resolved wager, prior cashout — each asserts zero side effects |
| `tests/cancel.concurrency.test.js` | Cancel-vs-cashout, cancel-vs-resolve races | ✓ VERIFIED (source-level), ⚠️ UNEXECUTED | Genuine `Promise.allSettled`, never sequential awaits; tolerant of either winner |
| `tests/cancel.tampering.test.js` | IDOR 404, no-trusted-body, route-unchanged | ✓ VERIFIED, ✓ PARTIALLY LIVE-PASSING | 2/3 tests (static/structural) actually ran and passed live; 1/3 (IDOR, DB-dependent) unexecuted |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `wagersController.cancelWager` | `wagerService.cancelWager` | Direct call, no body read | ✓ WIRED | `wagerService.cancelWager(Number(req.params.id), req.user.id)` — confirmed via source read + live-passing static test |
| `wagerService.cancelWager` | `marketRepository.findByIdForUpdate` → `wagerRepository.findByIdForUpdate` → `walletRepository.findByUserIdForUpdate` | Fixed lock order inside `transaction()` | ✓ WIRED | Market locked first (line 125), wager second with ownership+market in WHERE (line 137), wallet third (line 161) — matches sibling `cashoutWager`/`resolveMarket`/`deleteMarket`, fixes the pre-existing reversed order |
| `wagerService.cancelWager` | `money.applyFeePercent(remainingStake, env.CANCEL_FEE_PERCENT)` | Decimal-safe fee split | ✓ WIRED | Confirmed present at line 156; live-proven at the utility level (`money.test.js` 8/8) |
| `wagerService.cancelWager` | `walletRepository.recordTransaction` | Audit ledger row | ✓ WIRED | `type:'refund'`, `relatedEntity:'wager'`, populated before/after balances and fee-documenting description |
| `wagerService.cancelWager` (post-commit) | `domainEvents.emit('wager.cancelled', ...)` → `notificationService` listener | Event bus, emitted strictly after `transaction()` resolves | ✓ WIRED | Emit outside the transaction closure; listener reads the corrected `grossAmount`/`netAmount`/`feeAmount` fields (WR-02 fix) |
| `public/js/dashboard.js` Cancelar button | `DELETE /api/wagers/:id` | `Api.del(...)` on click | ✓ WIRED | Confirmed by direct source read; only rendered when `status==='pending' && market_status==='open'` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Money math for the default 5% fee is correct and decimal-safe | `npx jest tests/money.test.js` | 8/8 passed, including `applyFeePercent(100,5)` === `{fee:5,net:95}` | ✓ PASS |
| `env.js` accepts the correct default and rejects out-of-range/malformed values (WR-03) | `node -e "require('./src/config/env')"`; `CANCEL_FEE_PERCENT=500 node -e ...`; `CANCEL_FEE_PERCENT='5%' node -e ...` | Default `5`; both malformed values throw `Invalid CANCEL_FEE_PERCENT` | ✓ PASS |
| `cancelWager`/`wagerService.js` load without error | `node -e "require('./src/services/wagerService')"` | Loads cleanly | ✓ PASS |
| `cancelWager` signature cannot smuggle a client-supplied fee/amount | `node -e "console.log(require('./src/services/wagerService').cancelWager.length)"` | `2` | ✓ PASS |
| Static/structural attack-surface checks (route unchanged, no `req.body` read) | `npx jest tests/cancel.tampering.test.js` | 2 passed, 1 failed (the 1 failure is the DB-dependent IDOR test, isolated in its own describe block) | ✓ PASS (for the 2 static tests) |
| Full phase-4 test set run once (not filtered per-truth) | `npx jest tests/cancel.happy-path.test.js tests/cancel.fee-computation.test.js tests/cancel.audit.test.js tests/cancel.blocking.test.js tests/cancel.concurrency.test.js tests/cancel.tampering.test.js tests/cashout.cancel-refund.test.js` | 7 suites failed, 13/15 tests failed — all 13 failures are the identical `assertTestDatabase()` guard error, never an assertion failure | Documented above under Environment Limitation |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| CANCEL-01 | 04-01, 04-02 | User can cancel a wager when the market permits cancellation | ✓ SATISFIED (code-level) / ? NEEDS HUMAN (DB proof) | `cancelWager` + `DELETE /:id`, code path confirmed; DB round-trip unexecuted |
| CANCEL-02 | 04-01, 04-02 | Cancelling automatically charges 5% fee, refunds 95% | ✓ SATISFIED (code + math-util level) / ? NEEDS HUMAN (DB proof) | `money.applyFeePercent` call confirmed and generically live-proven (`money.test.js`); full DB round-trip unexecuted |
| CANCEL-03 | 04-01, 04-02 | Fee computed off remaining stake, not original amount | ✓ SATISFIED (code-level) / ? NEEDS HUMAN (DB proof) | `remainingStake` formula confirmed present and correctly ordered; DB-backed test unexecuted |
| CANCEL-04 | 04-01, 04-02 | Wallet transaction record + audit log entry | ✓ SATISFIED (code-level) / ? NEEDS HUMAN (DB proof) | `recordTransaction` call confirmed with correct fields; DB reconciliation unexecuted |
| CANCEL-05 | 04-01, 04-02 | Status becomes "Cancelada" | ✓ SATISFIED (code-level) / ? NEEDS HUMAN (DB proof) | `updateStatus(..., 'refunded', ...)` confirmed; `dashboard.js` label mapping confirmed live (no DB needed); full round-trip unexecuted |
| CANCEL-06 | 04-01, 04-03 | Blocked when market closed, wager resolved, or cashout occurred | ✓ SATISFIED (code-level) / ? NEEDS HUMAN (DB proof) | All 3 block branches confirmed present, correctly ordered before fee math; DB-backed side-effect-free proof unexecuted |
| CANCEL-07 | 04-03 | Blocking checks enforced transactionally, cannot race concurrent cashout/resolution | ? NEEDS HUMAN | Lock order confirmed structurally; genuine concurrency proof requires live Postgres row-lock contention — highest-risk item, CR-01-class gap precedent in this milestone |
| CANCEL-08 | 04-01, 04-03 | Replaces cancelWager in place, same route/method, no versioned endpoint | ✓ SATISFIED (live-verified) | Route text, controller body, and arity all confirmed; 2/3 `cancel.tampering.test.js` tests actually ran and passed live |

**No orphaned requirements** — all 8 CANCEL-* IDs from `REQUIREMENTS.md` are claimed across `04-01` (all 8), `04-02` (01-05), and `04-03` (06-08)'s `requirements` frontmatter; the union covers CANCEL-01 through CANCEL-08 exactly, matching REQUIREMENTS.md's Phase 4 traceability table (lines 116-123).

### Anti-Patterns Found

None. `grep -n -E "TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER"` across all phase-4-modified/created files (`src/services/wagerService.js`, `src/config/env.js`, `src/services/notificationService.js`, `src/repositories/walletRepository.js`, `tests/cashout.cancel-refund.test.js`, `tests/cancel.happy-path.test.js`, `tests/cancel.fee-computation.test.js`, `tests/cancel.audit.test.js`, `tests/cancel.blocking.test.js`, `tests/cancel.concurrency.test.js`, `tests/cancel.tampering.test.js`, `tests/notifications.events.test.js`, `tests/notifications.emission.test.js`) returns zero matches. All modified source files load cleanly via `node -e "require(...)"`. No stubs, no empty implementations, no hardcoded-empty data flowing to rendering.

### Human Verification Required

### 1. Live-DB run of the full phase-4 cancel test suite

**Test:** With a reachable `*test*`-named PostgreSQL database (e.g. `apostae_test`) configured via `DB_*` env vars and `NODE_ENV=test`, run: `npx jest tests/cancel.happy-path.test.js tests/cancel.fee-computation.test.js tests/cancel.audit.test.js tests/cancel.blocking.test.js tests/cancel.concurrency.test.js tests/cashout.cancel-refund.test.js` plus the IDOR case in `tests/cancel.tampering.test.js`.
**Expected:** All suites pass: 95%/5% split on a clean cancel, `ConflictError` + zero side effects on all three CANCEL-06 block conditions, no double-pay/no-deadlock on both `cancel.concurrency.test.js` races, exactly one reconciling `wallet_transactions` row per cancellation, and `NotFoundError`(404)-not-`AuthorizationError`(403) for a non-owner.
**Why human:** No live `*test*`-named Postgres is reachable in this sandbox (`assertTestDatabase()` correctly refuses the real `apostae` dev DB) — this is the 6th consecutive phase in this milestone carried forward with the identical infrastructure blocker (Phases 1-3 hit this same gap in their own verifications, per `02-VERIFICATION.md`/`03-VERIFICATION.md`). This is an environment-access limitation, not a code defect.

### 2. CANCEL-07 concurrency guarantee specifically

**Test:** Run `tests/cancel.concurrency.test.js`'s two `Promise.allSettled` races (cancel-vs-cashout, cancel-vs-resolveMarket) against real Postgres row locks, ideally repeated a handful of times to exercise both winner orderings.
**Expected:** Never both operations commit on the same wager; never a raw deadlock (`40P01`) surfaces; exactly one of `wallet_transactions`'s `refund` row or the competing operation's effect (cashout credit / resolution payout) exists, never both.
**Why human:** This is the single highest-risk truth in the phase — the exact class of gap (mocks structurally cannot reproduce real `FOR UPDATE` row-lock serialization) that let a real concurrency bug (CR-01) ship undetected earlier in this milestone (Phase 2), per `02-REVIEW.md` and `03-REVIEW.md`. STATE.md documents a mutex-based mock-backed dry run was used as interim compensation, but this is explicitly NOT a substitute for real Postgres proof (per the plan's own `<human-check>` instruction).

## Gaps Summary

No blocking gaps found. The 1 Critical (`CR-01`, untracked `walletRepository.js`) and 3 Warnings (`WR-01` finite-number guard, `WR-02` notification payload semantics, `WR-03` strict-numeric env parsing) from `04-REVIEW.md` are all independently re-confirmed fixed by reading the current source directly, not by trusting `04-REVIEW-FIX.md`'s claims. All required artifacts exist, are substantive, and are correctly wired end-to-end (route → controller → service → repository → DB schema → notification listener → frontend button). Requirements traceability is complete (8/8 CANCEL-* IDs claimed across the three plans, no orphans, matching REQUIREMENTS.md). No anti-patterns, debt markers, or stub implementations were found in any phase-4-modified file.

The phase is not `gaps_found` because every identified code-review gap has a confirmed, correctly-landed fix, and every must-have artifact/key-link is present and wired. It is `human_needed` because 4 of the 5 roadmap Success Criteria describe money-moving state transitions (fee/refund persistence, remaining-stake fee computation, audit-row reconciliation, and — most critically — the CANCEL-07 concurrent row-lock guarantee) that fundamentally require a live PostgreSQL instance to prove, and this sandbox has none reachable — the identical, well-documented infrastructure limitation carried forward from Phases 1-3 of this same milestone (`02-VERIFICATION.md`: 1/5 behavior-verified; `03-VERIFICATION.md`: 0/5 behavior-verified). Per the explicit environment-constraint guidance for this verification, this phase is judged consistently with that precedent: `human_needed`, not `gaps_found`, with all four unproven truths itemized above for a follow-up live-DB verification pass.

---

_Verified: 2026-07-15T12:59:58Z_
_Verifier: Claude (gsd-verifier)_
