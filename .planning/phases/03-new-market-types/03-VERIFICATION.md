---
phase: 03-new-market-types
verified: 2026-07-15T05:30:00Z
status: human_needed
score: 0/5 truths fully behavior-proven; 5/5 present + wired but behavior-unverified
behavior_unverified: 5
overrides_applied: 0
re_verification: No — initial verification
behavior_unverified_items:
  - truth: "Admin can create an Over/Under market with a freely configurable numeric threshold through the admin panel UI (MARKET-01, MARKET-08)"
    test: "Point DB_* env vars at a reachable *test*-named Postgres (e.g. apostae_test), NODE_ENV=test, run migrations 001-006, then run `npx jest tests/markets.creation.test.js tests/markets.validation.test.js`. In a browser, as admin, create an Over/Under market (threshold 2.5, Odds Over/Under) via the form."
    expected: "createMarket writes one markets row (market_type='over_under', threshold=2.50) and exactly 2 market_options rows ('Over 2.5'/'Under 2.5') atomically in one transaction; the admin list shows the new market with correct type/odds; no console errors."
    why_human: "The transaction (marketRepository.create + marketOptionRepository.createMany) is a multi-statement atomicity guarantee that only a real Postgres commit/rollback can prove. No *test*-named Postgres database is reachable in this sandbox (assertTestDatabase() correctly refuses DB_NAME=apostae) and no browser/DOM automation harness exists in this repo."
  - truth: "Admin can create a multiple-choice market with a dynamic number of options, not capped at 3, through the admin panel UI (MARKET-02, MARKET-08)"
    test: "Same DB setup as above; run tests/markets.creation.test.js (4-option case) and tests/markets.validation.test.js (21-option/duplicate-label rejections). In browser, create a multiple-choice market with 4+ options using the +/- row builder."
    expected: "N option rows are created in submitted order with sort_order=index; 21 options and duplicate (case-insensitive) labels are rejected with ValidationError before any DB write; the admin list renders every option's label/odds without crashing."
    why_human: "Same atomicity/DB-write-then-read-back argument as MARKET-01, plus the visual add/remove row UX needs a real browser render to confirm floor(2)/cap(20) UI behavior end-to-end."
  - truth: "Existing binary Sim/Não markets continue to work unchanged after the new types are added (MARKET-03)"
    test: "Run the full pre-existing Phase 1/2 regression suite (notifications.*, cashout.*, money) plus tests/markets.creation.test.js's binary-regression cases against a real Postgres test DB."
    expected: "All previously-passing Phase 1/2 suites still pass green; a binary market created with/without an explicit market_type field returns market_type:'binary', threshold:null, no options key, and behaves identically to pre-Phase-3 code."
    why_human: "This is a regression claim across the whole existing test corpus (86 tests currently blocked by the same assertTestDatabase() guard, not by a code defect — confirmed by re-running `npm test` in this session: 19/22 suites fail with the identical guard error, the 3 that pass are exactly the DB-independent ones). Code-level diffs strongly support byte-identical binary paths (verified directly against git history for admin.html/admin.js/marketRepository/wagerRepository/marketService), but only a live run proves no regression."
  - truth: "All market-type and option input is validated and bounded server-side, and an option ID can never be used to reference a different market's option — no IDOR (MARKET-04, MARKET-05, MARKET-06)"
    test: "Run tests/markets.idor.test.js and tests/markets.validation.test.js against real Postgres. Attack spot-check: attempt (via devtools/curl) to place a wager on market B using an option_id from market A → must be rejected; submit a 21-option multiple_choice bypassing the UI → must be rejected server-side."
    expected: "Cross-market option_id lookups return null from marketOptionRepository.findByIdForMarket and reject with ValidationError before any wallet write; the 2-20 option bound and duplicate-label check reject invalid input before any DB write."
    why_human: "The IDOR guard's core behavior (a WHERE id=$1 AND market_id=$2 lookup genuinely returning no row for a foreign option) can only be proven by inserting real cross-market rows and querying them — impossible without a live Postgres connection. One sub-claim of this truth (non-admin cannot reach POST /api/markets) WAS behaviorally verified in this session — see Behavioral Spot-Checks below — but the option-scoping IDOR guard itself remains unexercised."
  - truth: "Wagers on any market type resolve and pay out correctly through a generalized N-outcome resolution path (MARKET-07)"
    test: "Run tests/markets.resolution.test.js against real Postgres. As admin, resolve a binary, an Over/Under, and a multiple-choice market in the browser; confirm winners credited, losers marked lost, and the resolution notification shows the winning option's LABEL (not a raw id) for new types. Also verify the cashed-out-then-resolved regression (test (d)) pays only the remaining fraction, not the full payout."
    expected: "Binary resolution pays the full potential_payout to the winning choice exactly as pre-Phase-3; Over/Under and multiple_choice resolution pay only wagers whose option_id matches winning_option_id; a wager with cashed_out_amount=40 on a $200 potential_payout pays exactly $120, never $200."
    why_human: "This is the phase's highest-risk financial state transition (money credited to a wallet based on a win-check across 3 market types) — Phase 2's own review found 3 critical double-pay bugs in a superficially similar function that only real Postgres row-lock/commit semantics exposed. The `isWinner` branch and `remainingFraction` math were read directly and confirmed byte-identical to pre-Phase-3 code outside the single changed line, but this claim requires a real balance-before/balance-after assertion against Postgres to be considered proven, matching Phase 2's own precedent for this exact class of truth."
human_verification:
  - test: "Point DB_* env vars at a reachable *test*-named Postgres (e.g. apostae_test), NODE_ENV=test, and run migrations 001-006. Confirm migration 005 applies cleanly and its `down` reverses cleanly on a throwaway copy."
    expected: "market_options table, market_type/threshold/winning_option_id columns, wagers.option_id + XOR CHECK all present; down migration removes them cleanly."
    why_human: "No live Postgres reachable in this sandbox to execute DDL."
  - test: "Run `npm test` against the real Postgres test DB (all 22 suites, including markets.creation/validation/idor/resolution and the full Phase 1/2 regression corpus)."
    expected: "All suites pass green; specifically the CR-01-fixed seedMarketOptions() CTE query (tests/helpers/testDb.js:226-232) executes without a SQL syntax error."
    why_human: "assertTestDatabase() correctly refuses to run against the only reachable DB (apostae, not *test*-named). This is the exact phase-gate check 03-07-PLAN.md's Task 2 requires and 03-07-SUMMARY.md documents as still open."
  - test: "In the browser, as admin: create a binary market (confirm form/ticket unchanged), an Over/Under market (threshold 2.5 + Odds Over/Under), and a multiple-choice market with 4 options. As a user: place a wager on each of the three markets and confirm my-wagers shows the correct option label. As admin: resolve each market and confirm correct payouts/notifications."
    expected: "All three market types are fully creatable, wagerable, and resolvable end-to-end through the UI with no console errors; binary UI is pixel-identical to pre-Phase-3."
    why_human: "No browser/DOM automation harness (Playwright/Puppeteer/jsdom) exists in this repo and this sandbox has no interactive browser."
---

# Phase 3: New Market Types Verification Report

**Phase Goal:** Admins can create Over/Under and multiple-choice markets (in addition to the existing binary Sim/Não market) through the admin panel UI, with all validation, option scoping, and resolution logic generalized to N outcomes.
**Verified:** 2026-07-15T05:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Environment Limitation (read before the findings below)

No isolated `*test*`-named Postgres database is reachable from this sandbox (confirmed directly in this session: `/dev/tcp/127.0.0.1/5432` connection refused, no `psql`/`docker` binaries available), and no browser/DOM automation harness exists in this repo. Running `npm test` reproduces exactly the state described in 03-07-SUMMARY.md and this task's known-environment-constraint:

```
Test Suites: 19 failed, 3 passed, 22 total
Tests:       86 failed, 15 passed, 101 total
```

All 19 failing suites fail with the identical `assertTestDatabase()` guard error (`DB_NAME="apostae" não contém "test"`). The 3 passing suites (`money.test.js`, `cashout.savepoint-replay.test.js`, `cashout.controller.test.js`) are exactly the ones that are pure-unit or mock-backed and require no live database. This is the same pre-existing, already-documented (STATE.md) limitation Phase 1 and Phase 2 verification both hit, with explicit project-owner confirmation to persist as human-verification/UAT and proceed — this phase follows the identical precedent, not a new decision. Per the task instructions, this is **not** grounds to mark the phase `gaps_found`; DB-dependent truths are routed to human verification below.

One genuinely runnable check inside `tests/markets.idor.test.js` (a describe block with no `beforeAll` DB dependency — asserts `POST /api/markets` carries `requireAuth`→`requireAdmin`→controller in the correct middleware order) WAS executed live in this session and passed:

```
$ npx jest tests/markets.idor.test.js -t "exige requireAdmin"
Tests: 4 skipped, 1 passed, 5 total
```

## Code Review Fix Verification (CR-01, WR-01, WR-02, WR-03) — read directly from current source, not from 03-REVIEW-FIX.md's claims

`03-REVIEW.md` found 1 Critical bug (invalid PostgreSQL `INSERT...RETURNING...ORDER BY` syntax in the test seed helper, which would have silently broken every non-binary integration test the instant it ran against real Postgres — the exact "mock-verified, hides real bugs" failure mode this phase's own plans cite from Phase 2) and 3 Warnings. All 4 were independently re-verified against current source, not taken from 03-REVIEW-FIX.md's claims:

| Finding | Claim in 03-REVIEW-FIX.md | Verified in current source? | Evidence |
|---|---|---|---|
| CR-01 | `seedMarketOptions()`'s `INSERT...RETURNING...ORDER BY` (invalid Postgres grammar) rewritten as a `WITH ins AS (...) SELECT ... ORDER BY` CTE | ✓ Confirmed landed | `tests/helpers/testDb.js:226-235` — the CTE-wrapped, ordered-`SELECT` pattern is present exactly as specified; `node -c tests/helpers/testDb.js` passes. This is the standard, syntactically valid Postgres pattern for an ordered multi-row `RETURNING`. Genuine execution against real Postgres remains blocked by the environment (see above) — same open status 03-REVIEW-FIX.md itself documents. |
| WR-01 | Missing `.odd-btn.option.selected` CSS rule added | ✓ Confirmed landed | `public/css/style.css:445` — `.odd-btn.option.selected { border-color: var(--sim); background: rgba(198,255,61,0.08); }` present immediately after `.odd-btn.option .value`; surrounding additive rules (`.odds-row.multi`, `.option-row`) intact; existing `.odd-btn.sim`/`.odd-btn.nao` rules (lines 222-227) untouched. |
| WR-02 | Over/Under threshold rounded to 2 decimals before use in both label and persisted value | ✓ Confirmed landed | `src/services/marketService.js:157` — `thresholdNum = Math.round(Number(threshold) * 100) / 100`, used consistently for both the auto-generated option labels (lines 169-170) and the value passed to `marketRepository.create` (line 185). |
| WR-03 | Upper bound (999999.99) added to threshold validation | ✓ Confirmed landed | `src/services/marketService.js:158` — `thresholdNum <= 0 \|\| thresholdNum > 999999.99` throws `ValidationError`, rejecting out-of-range values before any DB write instead of surfacing a raw Postgres `numeric field overflow`. |

**Conclusion:** All 4 in-scope fixes are present in current source, structurally correct, and match the review's exact recommendations. IN-01 (dead code, `marketOptionRepository.findByMarketId` unused) and IN-02 (stale `choice` field on the `wager.placed` event for non-binary wagers) remain unfixed as explicitly documented — both Info-level, non-blocking, and correctly out of the fix scope.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Admin can create an Over/Under market with a freely configurable numeric threshold through the admin panel UI (MARKET-01, MARKET-08) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `marketService.createMarket`'s `over_under` branch (validated threshold/odds, auto-labels, transaction-wrapped `create`+`createMany`) and `admin.html`/`admin.js`'s 3-field fieldset are present, wired, and code-reviewed clean (WR-02/WR-03 fixed). No live Postgres/browser to prove the end-to-end write+render. |
| 2 | Admin can create a multiple-choice market with a dynamic number of options, not capped at 3, through the admin panel UI (MARKET-02, MARKET-08) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `validateOptionsInput()` (2-20 bound, dedupe) and `admin.js`'s dynamic option-row builder (`addOptionBtn`, floor/cap enforcement) are present and wired. No live Postgres/browser to prove the end-to-end write+render. |
| 3 | Existing binary Sim/Não markets continue to work unchanged after the new types are added (MARKET-03) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Direct diffs (`git show ae5dd24`) confirm binary form inputs were only wrapped in a fieldset div, not altered; `marketRepository.create`'s binary INSERT path, `wagerRepository.create`'s choice-only path, and `dashboard.js ticketTemplate()`'s binary branch are all confirmed byte-identical to pre-Phase-3 markup/logic by direct code read. Full regression proof requires the blocked Phase 1/2 suite run. |
| 4 | All market-type/option input validated/bounded server-side; option IDs scoped per-market, no IDOR (MARKET-04, MARKET-05, MARKET-06) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `marketOptionRepository.findByIdForMarket` (`WHERE id=$1 AND market_id=$2 FOR UPDATE`) is the single IDOR chokepoint, consistently reused by both `placeWager` and `resolveMarket` — confirmed by direct code read, no second bare-id lookup exists anywhere in `src/`. One sub-claim (non-admin blocked from `POST /api/markets`) WAS behaviorally proven live in this session (see spot-check below). The core cross-market-rejection behavior itself needs real Postgres rows to exercise. |
| 5 | Wagers on any market type resolve and pay out correctly through a generalized N-outcome path (MARKET-07) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `resolveMarket`'s `isWinner` predicate is the only changed line inside the payout loop; `remainingFraction`/`money.multiply`/wallet-audit code confirmed character-for-character identical to the pre-Phase-3 binary-only code by direct read. `tests/markets.resolution.test.js` encodes the exact cashed-out-regression and IDOR-at-resolution scenarios but cannot execute without Postgres. |

**Score:** 0/5 truths fully behavior-proven; 5/5 present + wired but behavior-unverified (blocked by the documented no-live-DB/no-browser sandbox limitation, not by a missing or broken code path)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/migrations/005_market_types.js` | Additive up/down migration: market_type/threshold/market_options/winning_option_id/wagers.option_id+XOR CHECK | ✓ VERIFIED | All 8 up statements present; down is exact reverse; `market_options.market_id` FK has `ON DELETE CASCADE`; odds bound (1.01-1000) matches `isValidOdds()`. `node -e` module-shape check passes. |
| `src/migrations/006_market_odds_nullable.js` | Additive fix relaxing `markets.odds_yes`/`odds_no` to nullable | ✓ VERIFIED | Auto-fix from 03-03 (correctly documented as a Rule 1/2 deviation, not scope creep); required for any non-binary INSERT to succeed at all. `node -c` passes. |
| `tests/helpers/testDb.js` | applyMarketTypesMigration + seedMarketOptions + generalized seedOpenMarket/seedWager | ✓ VERIFIED | All 4 functions exported and present; CR-01 fix (CTE-wrapped ordered RETURNING) confirmed landed; default-arg binary paths kept byte-identical (structurally). |
| `src/repositories/marketOptionRepository.js` | findByIdForMarket (IDOR-safe), createMany (parameterized bulk insert), findByMarketId | ✓ VERIFIED | `WHERE id = $1 AND market_id = $2 FOR UPDATE` in findByIdForMarket; createMany uses positional placeholders, never string-concatenates labels. |
| `src/repositories/marketRepository.js` | findAll (json_agg options), create (marketType/threshold+client), resolveWithOption | ✓ VERIFIED | Single-query json_agg aggregation confirmed; binary `resolve()` untouched; `resolveWithOption` present and separate. |
| `src/repositories/wagerRepository.js` | SELECT_WITH_MARKET (+option_id/market_type/option_label), create (+optionId) | ✓ VERIFIED | LEFT JOIN market_options for option_label; create() writes choice=null when optionId provided, preserving binary path otherwise. |
| `src/services/marketService.js` | createMarket generalized (3 branches, transaction-wrapped); resolveMarket generalized (surgical isWinner branch) | ✓ VERIFIED | Confirmed by direct read; WR-02/WR-03 fixes present; resolveMarket's payout loop confirmed to change only the win-check condition. |
| `src/services/wagerService.js` | placeWager generalized (option_id branch, IDOR lookup, money.multiply) | ✓ VERIFIED | `findByIdForMarket` call inside the market lock; `Math.round` payout replaced by `money.multiply`; cancelWager/cashoutWager untouched. |
| `src/controllers/marketsController.js` | resolveMarket passes winning_option_id through | ✓ VERIFIED | Destructure-and-forward `{ outcome, winning_option_id }`, never a body spread. |
| `public/admin.html` | Market-type select + 3 fieldsets + dynamic option builder | ✓ VERIFIED | `#mMarketType`, `#mThreshold`/`#mOddsOver`/`#mOddsUnder`, `#optionsList`/`#addOptionBtn` all present; binary inputs preserved via diff. |
| `public/js/admin.js` | Branched submit payload, type-aware odds cell, non-binary resolve control | ✓ VERIFIED | `toggleMarketTypeFieldsets`, per-type submit body construction, `oddsCell`/`resultLabel`/`actionsCell` branching, `.resolve-select` + Resolver button all present. |
| `public/css/style.css` | Additive .options-list/.option-row/.odd-btn.option/.odds-row.multi/.resolve-select | ✓ VERIFIED | All 5 rule groups present at lines 415-457; WR-01 fix (`.odd-btn.option.selected`) landed; existing binary rules untouched. |
| `public/js/dashboard.js` | ticketTemplate branch, selection, submit payload, option_label call sites | ✓ VERIFIED | Binary/non-binary branches produce distinct HTML strings (no shared conditional template); both `loadMyWagers`/`showUserWagers` branch on `w.option_id != null`; resolved-ticket result label also generalized (auto-fixed deviation, documented in 03-07-SUMMARY.md). |
| `tests/markets.creation.test.js`, `tests/markets.validation.test.js`, `tests/markets.idor.test.js`, `tests/markets.resolution.test.js` | Positive/negative coverage per plan | ✓ VERIFIED (structurally) | All 4 files listed by `npx jest --listTests`; content read directly — genuinely comprehensive coverage (binary regression, per-type creation, count/threshold/duplicate/odds rejections, cross-market IDOR, own-option acceptance, forged-odds rejection, non-admin route-wiring, cashed-out-then-resolved regression, resolution IDOR). Execution against real Postgres blocked by environment. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `market_options.market_id` | `markets(id)` | `ON DELETE CASCADE` FK | ✓ WIRED | Present in migration 005; the ownership FK the IDOR guard's WHERE clause relies on. |
| `wagers.choice`/`wagers.option_id` | DB CHECK | XOR constraint | ✓ WIRED | `wagers_choice_xor_option` CHECK present in migration 005; backstops the service-layer discipline. |
| `marketOptionRepository.findByIdForMarket` | `wagerService.placeWager` | Inside market FOR UPDATE lock | ✓ WIRED | Confirmed at `wagerService.js:60`. |
| `marketOptionRepository.findByIdForMarket` | `marketService.resolveMarket` | Inside market FOR UPDATE lock | ✓ WIRED | Confirmed at `marketService.js:266`. |
| `marketRepository.findAll` json_agg | `public/js/dashboard.js` ticketTemplate | `market.options[]` | ✓ WIRED | dashboard.js reads `market.options` to render N option buttons; confirmed both consume the same shape. |
| `createMarket` transaction | `marketRepository.create` + `marketOptionRepository.createMany` | Single `transaction()` call | ✓ WIRED | Confirmed in `marketService.js:177-196` for over_under/multiple_choice; binary intentionally stays outside (single INSERT already atomic). |
| `admin.js` submit payload | `marketService.createMarket` body contract | market_type-branched body | ✓ WIRED | Confirmed field-for-field match between admin.js's 3 branches and marketService's destructuring. |
| `dashboard.js` submit payload | `wagerService.placeWager` body contract | `{market_id, choice, amount}` vs `{market_id, option_id, amount}` | ✓ WIRED | Confirmed match. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `public/js/admin.js` `loadMarkets()` | `markets` (from `Api.get('/markets')`) | `marketRepository.findAll()` — real `json_agg`/`LEFT JOIN` query, not a static return | Yes (query-backed) | ✓ FLOWING |
| `public/js/dashboard.js` `ticketTemplate()` | `market.options[]` | Same `findAll()` query → `marketsController.listMarkets` → `sanitizeMarket` (passthrough for non-admin fields) | Yes | ✓ FLOWING |
| `public/js/dashboard.js` wager rows | `w.option_label` | `wagerRepository.SELECT_WITH_MARKET`'s `LEFT JOIN market_options` | Yes (query-backed, not hardcoded) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| POST /api/markets middleware order is `requireAuth → requireAdmin → controller` (non-admin creation blocked, MARKET-04) | `npx jest tests/markets.idor.test.js -t "exige requireAdmin"` | `Tests: 4 skipped, 1 passed, 5 total` | ✓ PASS |
| Migration 005/006 module shape and SQL text | `node -e` module-shape assertions (per each plan's own `<verify>` block) | All assertions pass | ✓ PASS |
| testDb.js / marketOptionRepository / marketRepository / wagerRepository / marketService / wagerService / marketsController — syntax validity | `node -c <file>` on every phase-modified source file | All pass | ✓ PASS |
| Full Jest suite against real Postgres (creation/validation/idor/resolution + Phase 1/2 regression) | `npm test` | `19 failed, 3 passed` — all 19 failures are the identical `assertTestDatabase()` guard error, none are assertion failures | ? SKIP (environment-blocked, not a code failure) |
| Browser: create/wager/resolve all 3 market types end-to-end | N/A — no browser/DOM automation harness in this repo | — | ? SKIP (environment-blocked) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| MARKET-01 | 03-01, 03-03, 03-06 | Admin can create Over/Under market with configurable threshold | ? NEEDS HUMAN | Code present/wired/reviewed; live-DB write+browser render unverified (see Truth 1). |
| MARKET-02 | 03-01, 03-03, 03-06, 03-07 | Admin can create multiple-choice market, dynamic option count | ? NEEDS HUMAN | Code present/wired/reviewed; live-DB write+browser render unverified (see Truth 2). |
| MARKET-03 | all plans | Binary markets unchanged | ? NEEDS HUMAN | Byte-level diffs confirm no binary-path alteration; full regression suite run blocked by environment (see Truth 3). |
| MARKET-04 | 03-03 | Server-side validation of all market-type/option input | ? NEEDS HUMAN | `validateOptionsInput`/threshold/odds checks present and code-reviewed (WR-02/WR-03 fixed); live-DB rejection-path proof unverified. |
| MARKET-05 | 03-03, 03-06 | Option count bounded server-side (2-20), independent of UI | ✓ SATISFIED (code) / ? NEEDS HUMAN (live) | `MAX_OPTIONS=20` enforced in `validateOptionsInput` before any DB write, independent of `admin.js`'s client cap; live rejection unverified. |
| MARKET-06 | 03-02, 03-04, 03-05 | Option IDs scoped per-market server-side, no IDOR | ? NEEDS HUMAN | Single chokepoint (`findByIdForMarket`) confirmed reused everywhere, no bare-id lookup found in `src/`; the non-admin-creation sub-claim WAS live-verified; the core cross-market-rejection behavior needs real Postgres rows. |
| MARKET-07 | 03-05, 03-07 | Resolution/payout generalized to N outcomes | ? NEEDS HUMAN | Surgical `isWinner`-only change confirmed by direct read; live payout-correctness proof unverified (see Truth 5). |
| MARKET-08 | 03-06, 03-07 | Admin panel UI supports both new types, not API-only | ? NEEDS HUMAN | Full UI present (selector, fieldsets, dynamic builder, resolve controls, dashboard rendering); browser walkthrough unverified. |

No orphaned requirements: all 8 MARKET-* IDs declared in REQUIREMENTS.md Phase 3 traceability are claimed by at least one plan's `requirements:` frontmatter (03-01 through 03-07).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `src/repositories/marketOptionRepository.js` | 63-70 | `findByMarketId()` implemented and exported but never called anywhere in `src/`/`tests/` (dead code, IN-01 from 03-REVIEW.md) | ℹ️ Info | No functional impact — `marketRepository.findAll()`'s json_agg already supplies options for the list view. Not a blocker. |
| `src/services/wagerService.js` | ~95-102 | `wager.placed` event still passes the raw destructured `choice` (typically `undefined` for non-binary wagers) unconditionally (IN-02 from 03-REVIEW.md) | ℹ️ Info | Harmless today — `notificationService.js`'s listener never reads `evt.choice` — but is an unbranched leftover inconsistent with `resolveMarket`'s explicit label-for-non-binary discipline. Not a blocker. |

No debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) found in any phase-modified file. No blocker-level anti-patterns found.

### Human Verification Required

### 1. Live-Postgres migration + full test suite

**Test:** Point `DB_*` env vars at a reachable `*test*`-named Postgres (e.g. `apostae_test`), `NODE_ENV=test`, run migrations 001-006, then `npm test`.
**Expected:** All 22 suites pass green, including `tests/markets.creation/validation/idor/resolution.test.js` and the full Phase 1/2 regression corpus. The CR-01-fixed `seedMarketOptions()` CTE query executes without a SQL syntax error.
**Why human:** No live Postgres reachable in this sandbox; `assertTestDatabase()` correctly refuses the only reachable DB (`apostae`, not `*test*`-named).

### 2. Browser walkthrough — all 3 market types end-to-end

**Test:** As admin, create a binary market (confirm form/ticket unchanged), an Over/Under market (threshold 2.5 + Odds Over/Under), and a multiple-choice market with 4 options. As a user, wager on each of the three; confirm my-wagers shows the correct option label. As admin, resolve each; confirm winners credited, losers marked lost, resolution notification shows the option LABEL (not a raw id) for new types.
**Expected:** All three market types fully creatable/wagerable/resolvable through the UI with no console errors; binary UI pixel-identical to pre-Phase-3.
**Why human:** No browser/DOM automation harness exists in this repo; this sandbox has no interactive browser.

### 3. Attack spot-check

**Test:** Via devtools/curl, attempt to place a wager on market B using an `option_id` that belongs to market A. Separately, submit a multiple-choice market creation with 21 options, bypassing the admin UI's client-side cap.
**Expected:** Both rejected server-side (`ValidationError`) — the option_id case before any wager row is written, the 21-option case before any market row is written.
**Why human:** Requires a live API/DB connection to actually issue and observe the rejected request; the corresponding assertions exist in `tests/markets.idor.test.js`/`tests/markets.validation.test.js` but cannot execute in this sandbox.

### Gaps Summary

No code, artifact, or wiring gaps were found. Every artifact the phase's plans committed to exists, is substantive (not a stub), and is correctly wired end-to-end by direct code inspection — including confirmation that all 4 code-review findings (1 Critical, 3 Warning) were genuinely fixed in current source, not just claimed in 03-REVIEW-FIX.md. The phase's own SUMMARYs are honest about the one open item: this sandbox has no live `*test*`-named Postgres database and no browser/DOM automation harness, so none of the 5 roadmap Success Criteria — each of which is fundamentally a database state-transition or a UI end-to-end flow — could be behaviorally proven in this session. This mirrors Phase 1 and Phase 2's own verification precedent exactly (both landed on `human_needed` for the identical reason, with explicit project-owner sign-off to persist as UAT and proceed). Recommend the same resolution here: route the 3 human-verification items above to whoever has real Postgres + browser access, then proceed.

---

_Verified: 2026-07-15T05:30:00Z_
_Verifier: Claude (gsd-verifier)_
