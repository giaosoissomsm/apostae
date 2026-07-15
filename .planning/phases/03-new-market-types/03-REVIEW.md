---
phase: 03-new-market-types
reviewed: 2026-07-15T04:11:03Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - public/admin.html
  - public/css/style.css
  - public/js/admin.js
  - public/js/dashboard.js
  - src/controllers/marketsController.js
  - src/controllers/wagersController.js
  - src/migrations/005_market_types.js
  - src/migrations/006_market_odds_nullable.js
  - src/repositories/marketOptionRepository.js
  - src/repositories/marketRepository.js
  - src/repositories/wagerRepository.js
  - src/routes/markets.js
  - src/routes/wagers.js
  - src/services/marketService.js
  - src/services/wagerService.js
  - src/config/database.js
  - tests/helpers/testDb.js
  - tests/markets.creation.test.js
  - tests/markets.idor.test.js
  - tests/markets.resolution.test.js
  - tests/markets.validation.test.js
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-15T04:11:03Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

The financial-integrity core of this phase is implemented well. `resolveMarket`'s generalization is genuinely surgical — the `isWinner` predicate is the only line that changed inside the payout loop, and `remainingFraction`/`money.multiply`/wallet-audit code is byte-for-byte identical to the binary-only code Phase 2 shipped, including under a cashed-out-then-resolved scenario for option-based wagers. The IDOR guard (`marketOptionRepository.findByIdForMarket`, `WHERE id = $1 AND market_id = $2 ... FOR UPDATE`) is the single chokepoint for every client-supplied `option_id`/`winning_option_id`, used consistently at both wager placement and market resolution, with no second bare-id lookup anywhere in `src/`. The server-side 2–20 option bound (`validateOptionsInput`) is enforced independently of the admin UI's client-side cap, duplicate labels are rejected case-insensitively server-side, `requireAdmin` still gates market creation/resolution, and every controller destructures only expected fields (no mass-assignment path). Binary market creation/placement/resolution was traced end-to-end against the pre-Phase-3 source and is behaviorally unchanged (same SQL text/values for the binary INSERT, same win-check, same event shapes).

However, this review found a **Critical bug that breaks the phase's own verification strategy**: the new `tests/helpers/testDb.js` seed helper used by every non-binary Phase 3 integration test contains invalid PostgreSQL syntax (`INSERT ... RETURNING ... ORDER BY`), which is not valid in PostgreSQL's `INSERT` grammar. This means every scenario in `markets.idor.test.js` and `markets.resolution.test.js` that seeds options (i.e. essentially all of the IDOR and N-outcome payout coverage this phase's own SUMMARYs claim as "verified") will fail with a SQL syntax error the moment they are actually run against a real database — exactly the "mock-verified, hides real bugs" failure mode this phase's own plans repeatedly cite as the lesson from Phase 2's CR-01/02/03. It slipped through again, in the one place specifically designed to catch it. Additionally, a missing CSS rule leaves non-binary option selection with no visual feedback, and `over_under` threshold validation has two input-validation gaps (precision mismatch between the auto-generated option label and the stored `NUMERIC(10,2)` threshold; no upper bound, risking an unhandled DB overflow error).

## Critical Issues

### CR-01: `seedMarketOptions()` test helper uses invalid PostgreSQL syntax — breaks every non-binary Phase 3 integration test against a real database

**File:** `tests/helpers/testDb.js:216-234` (specifically 226-231)
**Issue:** The helper builds an `INSERT ... RETURNING ... ORDER BY` statement:

```js
const result = await query(
  `INSERT INTO market_options (market_id, label, odds, sort_order)
   VALUES ${placeholders}
   RETURNING id, sort_order
   ORDER BY sort_order;`,
  values
);
```

PostgreSQL's `INSERT` statement grammar does not support an `ORDER BY` clause after `RETURNING` (that syntax is only valid on a top-level `SELECT`). This will fail at parse time with a syntax error (SQLSTATE `42601`, `ERROR: syntax error at or near "ORDER"`) the instant this function runs against a real PostgreSQL instance.

`seedMarketOptions()` is called by nearly every non-binary scenario in this phase's test suites:
- `tests/markets.idor.test.js` — both `beforeAll` seed calls (market A and market B options), meaning **all 4 IDOR/attack-vector tests in the first `describe` block** depend on it succeeding.
- `tests/markets.resolution.test.js` — tests (b), (c), (d), (e) (over_under payout, multiple_choice payout, the critical cashed-out-then-resolved regression, and resolution IDOR) all call it directly.

Every plan's SUMMARY (03-01 through 03-07) explicitly and repeatedly documents that verification was performed via "mock-backed dry runs" or "structural" checks (`node --check`, `npx jest --listTests`) because no live `*test*`-named Postgres database was reachable in the sandbox — never by actually executing these SQL statements against Postgres. As a direct result, this defect was never caught, even though 03-05's plan explicitly names "Phase 2's mock-only-verification failure" as the exact risk this phase is supposed to guard against (03-07-PLAN.md's Task 2 phase-gate). The claims in 03-04-SUMMARY.md ("4 assertions covering cross-market rejection...") and 03-05-SUMMARY.md ("21/21 assertions passed") describe mock-backed dry runs of hand-rolled fake clients, not executions of this actual helper function — so they do not contradict this finding; they are exactly the blind spot that let it through.

**Fix:** Wrap the INSERT in a CTE and order in the outer `SELECT`, which is the standard PostgreSQL pattern for an ordered `RETURNING`:

```js
const result = await query(
  `WITH ins AS (
     INSERT INTO market_options (market_id, label, odds, sort_order)
     VALUES ${placeholders}
     RETURNING id, sort_order
   )
   SELECT id, sort_order FROM ins ORDER BY sort_order;`,
  values
);
```

This must then actually be executed against a real PostgreSQL instance (not just `node --check`/`--listTests`) before any of this phase's IDOR/resolution/creation test claims can be considered verified — re-affirming 03-07's own phase-gate requirement, which remains open per its SUMMARY.

## Warnings

### WR-01: No CSS rule for `.odd-btn.option.selected` — non-binary option selection gives the user zero visual feedback

**File:** `public/css/style.css` (missing rule; compare lines 222-227 for the binary equivalent), `public/js/dashboard.js:122`
**Issue:** `ticketTemplate()`'s non-binary branch applies a `selected` class to the chosen `.odd-btn.option` button (`class="odd-btn option ${sel === o.id ? 'selected' : ''}"`), but `style.css` only defines `.odd-btn.sim.selected` and `.odd-btn.nao.selected` — there is no `.odd-btn.option.selected` rule anywhere in the additive CSS block (lines 414-457). The class is applied but matches no selector, so clicking an Over/Under or multiple-choice option produces no border/background change at all. This directly violates `03-UI-SPEC.md`'s Color contract ("The **selected** state of any option button, binary or generalized ... this is the single unifying accent treatment ... regardless of market type") and its Dashboard contract ("the selected `.odd-btn.option` ... is the primary visual anchor of each ticket — same role the existing binary selection state already plays"). Functionally the wager still submits the correct `option_id` (the JS state is tracked correctly), but the user has no visual confirmation of which option is currently selected before clicking "Apostar" — a real UX defect on a betting UI where mis-clicks have financial consequences for the end user.
**Fix:** Add the missing rule per the UI-SPEC's own prescribed treatment (uniform `--sim` accent regardless of which option is selected):
```css
.odd-btn.option.selected { border-color: var(--sim); background: rgba(198,255,61,0.08); }
```

### WR-02: Over/Under auto-generated option labels can diverge from the stored `threshold` value (precision mismatch)

**File:** `src/services/marketService.js:151-167`
**Issue:** `thresholdNum = Number(threshold)` is used verbatim, with no rounding, to build the auto-generated option labels (`Over ${thresholdNum}` / `Under ${thresholdNum}`) before the market row is inserted. `markets.threshold` is `NUMERIC(10,2)` (migration 005), so PostgreSQL rounds/truncates the stored value to 2 decimal places on write. If a caller submits a threshold with more than 2 decimal digits — reachable via direct API call even though the admin UI's `step="0.5"` input constrains the browser form — the option labels ("Over 2.567") will not match `market.threshold` as actually stored and displayed elsewhere (e.g. `admin.js`'s `oddsCell()`: `` `Over ${m.threshold}: ...` `` reads the rounded value, e.g. "2.57"). The same class of mismatch can also occur from ordinary IEEE-754 float artifacts (e.g. a value arriving as `2.3000000000000003`). This is a data-consistency gap, not currently caught by any validation — `createMarket`'s only threshold check is `Number.isFinite(thresholdNum) && thresholdNum > 0`.
**Fix:** Round `thresholdNum` to 2 decimals before using it in both the label text and the value passed to `marketRepository.create`, so the label and the persisted column can never disagree:
```js
thresholdNum = Math.round(Number(threshold) * 100) / 100;
```

### WR-03: No upper bound on Over/Under `threshold` — an out-of-range value fails as a raw, untranslated Postgres error

**File:** `src/services/marketService.js:151-156`
**Issue:** `over_under` validation only checks `Number.isFinite(thresholdNum) && thresholdNum > 0` — there is no upper bound. `markets.threshold` is `NUMERIC(10,2)` (max magnitude 99999999.99). A client submitting an out-of-range value (e.g. `1e15`) passes this service-level check and reaches the database, where it fails with a raw Postgres `numeric field overflow` (SQLSTATE `22003`). This is not one of the codes `errorHandler.js` recognizes (its Postgres-error branch checks `err.code.startsWith('P')`, which — as already documented in `02-REVIEW.md` IN-01 — never matches any real PostgreSQL SQLSTATE), so it falls through to the generic 500 handler and can leak raw database error text instead of a clean `ValidationError`, unlike every other rejection this endpoint produces. This is the same category of gap requisitos.txt's "insufficient input validation" check calls out, and mirrors MARKET-05's own principle (bound server-side, don't rely on the DB/UI to reject) that was correctly applied to option count but missed for threshold.
**Fix:** Add an explicit, sane upper bound in `createMarket`'s `over_under` validation (e.g. `thresholdNum > 0 && thresholdNum <= 999999.99`), independent of relying on the `NUMERIC(10,2)` column to reject it.

## Info

### IN-01: `marketOptionRepository.findByMarketId()` is dead code

**File:** `src/repositories/marketOptionRepository.js:63-70`
**Issue:** Implemented and exported (per the 03-02 plan's spec) but never called anywhere in `src/` or `tests/` — `marketRepository.findAll()`'s `json_agg` query already supplies `options[]` for the list view, so nothing currently needs a standalone per-market option fetch.
**Fix:** No action required; either wire it up where it's eventually needed or remove it if it stays permanently unused. Flagging only for maintainability/dead-code hygiene.

### IN-02: `wager.placed` event still carries a stale, always-`undefined` `choice` field for non-binary wagers

**File:** `src/services/wagerService.js:95-102`
**Issue:** `placeWager`'s `domainEvents.emit('wager.placed', { ..., choice, amount: wagerAmount })` passes the raw destructured `choice` from the request body unconditionally. For a non-binary wager, `choice` was never validated/used (the non-binary branch never reads it) and is typically `undefined`. This is harmless today — `notificationService.js`'s `wager.placed` listener never reads `evt.choice` — but it's an unbranched leftover of the binary-only event shape sitting inside an otherwise carefully-generalized function (contrast with `resolveMarket`'s explicit "label for non-binary / raw value for binary" event-payload discipline, Pitfall 5).
**Fix:** Low priority; consider omitting/nulling `choice` for the non-binary branch (or adding `option_id`) for consistency, next time this event payload is touched.

---

_Reviewed: 2026-07-15T04:11:03Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
