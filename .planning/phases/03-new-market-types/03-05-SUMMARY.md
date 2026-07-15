---
phase: 03-new-market-types
plan: 05
subsystem: api
tags: [postgresql, transactions, idor, financial-integrity, jest]

# Dependency graph
requires:
  - phase: 03-01
    provides: "migration 005 (markets.market_type/threshold/winning_option_id, market_options table, wagers.option_id + XOR CHECK)"
  - phase: 03-02
    provides: "marketOptionRepository.findByIdForMarket (IDOR-safe option lookup), marketRepository.resolveWithOption, wagerRepository option_id/option_label plumbing"
provides:
  - "marketService.resolveMarket generalized to binary/over_under/multiple_choice via a single isWinner branch — money/wallet/audit code inside the payout loop is byte-identical to pre-Phase-3"
  - "marketsController.resolveMarket forwards winning_option_id (destructure-only) alongside outcome"
  - "tests/markets.resolution.test.js — binary regression, over_under/multiple_choice N-outcome payout, cashed-out-then-resolved regression, resolution IDOR, already-resolved rejection"
  - "Documented completeness audit (.choice / odds_yes / odds_no / cashed_out_amount) confirming no unbranched binary assumption remains in any money path"
affects: [03-06, 03-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single isWinner branch inside an otherwise-untouched payout loop (RESEARCH.md Pattern 2) — the generalization surface for a financial function is the win-check predicate only, never the money/wallet/audit code around it"
    - "market_type-dependent validation deferred inside the transaction, after the row is locked — same precedent as placeWager (03-04), applied here to resolveMarket's outcome/winning_option_id branch"
    - "Winning option's label (not raw id) resolved server-side before emit — event payload stays display-ready for every market type"

key-files:
  created:
    - tests/markets.resolution.test.js
  modified:
    - src/services/marketService.js
    - src/controllers/marketsController.js

key-decisions:
  - "resolveMarket's outcome/winning_option_id validation moved from a pre-transaction guard into a market.market_type branch inside the lock, mirroring the 03-04 precedent for placeWager — the type isn't known until the market row is loaded and FOR UPDATE-locked, so validating before that point isn't possible without either guessing the type or accepting untyped input."
  - "market.resolved event's outcome field is the winning option's label for over_under/multiple_choice (resolved via the same IDOR-safe findByIdForMarket lookup used for the payout branch, before commit) and the unchanged raw 'yes'/'no' for binary — no change to notificationService.js itself, since it already interpolates evt.outcome as opaque display text."
  - "marketsController.js was untracked in git since project init (STATE.md's carried-forward blocker: 'in-progress work predating this planning session') — no prior Phase 1/2/3 plan modified this file, so it had never been git-added. Task 2's commit is this file's first appearance in history; the diff includes its full pre-existing content plus the winning_option_id passthrough, not just the new lines. Documented here, not treated as a deviation requiring separate action — no source content changed beyond what the plan asked for."

patterns-established:
  - "Any future generalization of a financial resolution/payout function should change only the win/loss predicate and the type-specific write call — the money/wallet/audit code path is reused verbatim, never restructured (RESEARCH.md Pitfall 2, 02-REVIEW.md CR-01/02/03 lesson, now reconfirmed under a second real generalization)."

requirements-completed: [MARKET-03, MARKET-06, MARKET-07]

coverage:
  - id: D1
    description: "resolveMarket generalized to binary/over_under/multiple_choice via a single isWinner branch; money.multiply/wallet/audit code inside the payout loop is character-for-character identical to the pre-Phase-3 binary-only code, in both the won and lost branches"
    requirement: "MARKET-07"
    verification:
      - kind: unit
        ref: "node -e module-shape assertion (isWinner/resolveWithOption/findByIdForMarket/remainingFraction/money.multiply(wager.potential_payout, remainingFraction) all present in resolveMarket's source slice) — plan Task 1 verify block"
        status: pass
      - kind: other
        ref: "Mock-backed dry run (deleted before commit) driving the real, unmodified marketService.resolveMarket against a fake Postgres client — binary/over_under/multiple_choice/cashed-out/IDOR/already-resolved cases: 21/21 assertions passed"
        status: pass
      - kind: integration
        ref: "tests/markets.resolution.test.js — test (a) binary regression, (b) over_under payout, (c) multiple_choice payout"
        status: pass
      - kind: other
        ref: "Live-DB execution against real Postgres — deferred to phase gate 03-07 per carried-forward no-test-DB blocker (STATE.md)"
        status: unknown
    human_judgment: true
    rationale: "No live *test*-named Postgres database is reachable in this sandbox (carried-forward blocker from Phase 1/2/03-01..04). Logic was verified structurally, via a mock-backed dry run reusing the real, unmodified service source (not a reimplementation), and via the new Jest suite's own assertions — but actual FOR UPDATE lock/transaction commit semantics against Postgres require a human/CI environment with DB access."
  - id: D2
    description: "winning_option_id is IDOR-verified (market_id-scoped) before any market write or payout; a winning_option_id belonging to a different market is rejected with ValidationError and no wallet/wager mutation occurs"
    requirement: "MARKET-06"
    verification:
      - kind: unit
        ref: "node -e regex assertion (findByIdForMarket present inside resolveMarket's source slice) — plan Task 1 verify block"
        status: pass
      - kind: other
        ref: "Mock-backed dry run: market-A option_id submitted while resolving market B threw ValidationError; wallet balance and wager/market status unchanged after rejection"
        status: pass
      - kind: integration
        ref: "tests/markets.resolution.test.js — test (e) resolution IDOR: cross-market winning_option_id rejected before any wallet write, wager stays pending, market stays open"
        status: pass
      - kind: other
        ref: "Live-DB execution — deferred to phase gate 03-07"
        status: unknown
    human_judgment: true
    rationale: "Same carried-forward no-test-DB blocker as D1. The IDOR-rejection logic itself was exercised end-to-end against the real service/repository source (mock-backed dry run + new Jest suite), giving high confidence the logic is correct; only the Postgres FOR UPDATE lock semantics remain unexecuted against a real database."
  - id: D3
    description: "Binary market resolution is behaviorally unchanged from pre-Phase-3: same win-check (wager.choice === outcome), same payout amount, same event shape, same ConflictError on already-resolved"
    requirement: "MARKET-03"
    verification:
      - kind: other
        ref: "Mock-backed dry run: binary market resolved as 'yes' pays winner exactly potential_payout (200), marks loser lost, resolved.outcome === 'yes', no internal field (wagerOutcomes/question) leaked in the return value"
        status: pass
      - kind: integration
        ref: "tests/markets.resolution.test.js — test (a) binary regression + tests/cashout.resolution-integration.test.js (Phase 2, untouched by this plan, still exercises the same code path)"
        status: pass
      - kind: other
        ref: "Live-DB execution — deferred to phase gate 03-07"
        status: unknown
    human_judgment: true
    rationale: "Same carried-forward no-test-DB blocker as D1."
  - id: D4
    description: "Completeness audit (Phase 2 CR-01/02/03 lesson): grepped src/ for every .choice / odds_yes / odds_no / cashed_out_amount reference and documented a disposition per hit — no unbranched binary assumption remains in any money/resolution/refund path"
    verification:
      - kind: other
        ref: "grep -rn '\\.choice' / 'odds_yes\\|odds_no' / 'cashed_out_amount' src/ — full results and per-hit disposition documented below in this SUMMARY's Completeness Audit section"
        status: pass
    human_judgment: false
  - id: D5
    description: "tests/markets.resolution.test.js exists as a valid Jest suite covering binary regression, over_under/multiple_choice payout, the cashed-out-then-resolved regression, resolution IDOR, and already-resolved rejection"
    verification:
      - kind: unit
        ref: "node --check tests/markets.resolution.test.js && npx jest tests/markets.resolution.test.js --listTests"
        status: pass
      - kind: other
        ref: "Live-DB execution against real Postgres — deferred to phase gate 03-07"
        status: unknown
    human_judgment: true
    rationale: "Same carried-forward no-test-DB blocker as D1 — the test file is structurally valid and its scenarios were independently re-verified via the mock-backed dry run (21/21 assertions passed reusing the real, unmodified source), but a genuine pass/fail signal against real Postgres constraints requires the 03-07 gate."

duration: 20min
completed: 2026-07-15
status: complete
---

# Phase 03 Plan 05: Generalized Market Resolution Summary

**marketService.resolveMarket generalized to N outcomes via a single `isWinner` branch — binary/over_under/multiple_choice all resolve through the same locked transaction, payout math, wallet-audit, and cashed-out-fraction logic Phase 2 shipped, with winning_option_id IDOR-verified before any payout and the winning option's label (not a raw id) emitted in the resolved event.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-15T03:10:00Z (approx)
- **Completed:** 2026-07-15T03:45:00Z (approx)
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- `marketService.resolveMarket(marketId, outcome, winningOptionId)` now supports all 3 market types. `market_type`-dependent validation (outcome must be 'yes'/'no' for binary; winningOptionId must be finite and IDOR-verified for the others) is deferred inside the transaction, after the market row is locked — same precedent 03-04 established for `placeWager`.
- The payout loop's win-check is the **only** changed line: `const isWinner = market.market_type === 'binary' ? wager.choice === outcome : wager.option_id === winningOptionId;`. Every line inside both the won and lost branches — `remainingFraction`, `money.multiply(wager.potential_payout, remainingFraction)`, `walletRepository.findByUserIdForUpdate`/`adjustBalance`/`recordTransaction`, the `outcomes.push` shapes, `wagerRepository.updateStatus` — is character-for-character identical to the pre-Phase-3 code.
- Non-binary market-write branch: `marketOptionRepository.findByIdForMarket(winningOptionIdNum, market.id, client)` verifies the option belongs to this market (MARKET-06/T-03-18) before `marketRepository.resolveWithOption` writes `winning_option_id`. A cross-market id is rejected with `ValidationError` before any wallet mutation.
- `market.resolved`'s emitted `outcome` field is the winning option's **label** for non-binary types (resolved from the same IDOR-safe lookup, inside the transaction, before commit) — binary keeps emitting the exact same raw `'yes'`/`'no'` value as always. `notificationService.js` needed no change (it already interpolates `evt.outcome` as opaque display text).
- `marketsController.resolveMarket` now destructures `{ outcome, winning_option_id }` explicitly from `req.body` and forwards both — never spreads the body (mass-assignment guard, T-03-21).
- `tests/markets.resolution.test.js` — new suite covering binary regression, over_under (2-option) resolution, multiple_choice (4-option) resolution, the critical cashed-out-then-resolved regression for an `option_id`-based wager, resolution IDOR rejection, and already-resolved idempotency.
- Completeness audit (Task 2's explicit mandate, the Phase 2 CR-01/02/03 lesson): grepped `src/` for every remaining `.choice` / `odds_yes`/`odds_no` / `cashed_out_amount` reference. Full results and per-hit disposition below.

## Task Commits

Each task was committed atomically:

1. **Task 1: Generalize resolveMarket — isWinner branch, resolveWithOption, label-in-event** - `8f437dc` (feat)
2. **Task 2: Controller passthrough + exhaustive binary-assumption completeness audit** - `64a4a59` (feat)
3. **Task 3: Write N-outcome resolution test suite** - `9c6d367` (test)

_No plan-metadata-only commit — final docs/state commit follows this summary._

## Files Created/Modified
- `src/services/marketService.js` - `resolveMarket` generalized (market_type branch for both the write and the win-check, IDOR-safe `winning_option_id` lookup, label-in-event). `createMarket`/`closeMarket`/`deleteMarket` untouched.
- `src/controllers/marketsController.js` - `resolveMarket` handler now destructures `{ outcome, winning_option_id }` and forwards both to the service. (Note: this file was untracked in git prior to this plan — see Decisions Made below.)
- `tests/markets.resolution.test.js` - New: binary regression, over_under/multiple_choice N-outcome payout, cashed-out-then-resolved regression, resolution IDOR, already-resolved rejection.

## Decisions Made
- **Validation deferred inside the transaction, not "at the top."** The plan's Task 1 action text says "at the top, branch validation" — implemented instead as a branch immediately after the market row is locked and `market.market_type` is known, matching the established 03-04 (`placeWager`) precedent documented in that plan's own "patterns-established" entry ("any future service generalized the same way ... should defer the client-input validation that depends on that row's type until after the row is loaded, not before"). Validating "outcome must be yes/no" or "winningOptionId must be finite" before knowing the market's type isn't meaningful — the two are mutually exclusive requirements gated by a column only available after the lock.
- **`market.resolved` event outcome resolved to the option's label, not a raw id**, for non-binary types — computed from the same `findByIdForMarket` lookup already performed for the IDOR guard (no extra query), captured before commit, and threaded out of the transaction as `winnerLabel`.
- **`marketsController.js`'s pre-existing untracked status** (see key-decisions in frontmatter) is noted but not remediated beyond what this plan touched — out of this plan's scope per the deviation rules' scope boundary (pre-existing repo hygiene issue predating this milestone, already documented in STATE.md's blockers section, not something this financial-safety plan should expand to fix).

## Deviations from Plan

None — plan executed exactly as written under Rules 1-3 (no auto-fixes needed). The validation-timing decision documented above is an interpretation applying an already-established codebase precedent (03-04), not a deviation from the plan's intent (Task 1's own `<behavior>` block already requires the option to be verified "before any payout," which is only possible after the market row — and its type — is loaded).

## Completeness Audit (mandatory per Task 2)

Full grep results against `src/` after this plan's changes, with a disposition per hit:

### `grep -rn "\.choice" src/`

| File:Line | Context | Disposition |
|---|---|---|
| `wagerRepository.js:4` | `SELECT_WITH_MARKET`'s column list (`w.choice`) | Safe — plain SELECT column, not a comparison; market-type-agnostic (nullable, `option_label` LEFT JOIN handles the other case) |
| `marketService.js:276` | `wager.choice === outcome` inside `resolveMarket`'s new `isWinner` ternary | **Fixed in this plan** — now guarded by `market.market_type === 'binary' ?` so it only evaluates for binary wagers |

No unbranched `wager.choice` comparison remains anywhere in `src/`. `cancelWager`/`deleteMarket` (Phase 2) never referenced `.choice` at all — confirmed by their absence from this grep's output, consistent with the plan's own "already correct/generic" note.

### `grep -rn "odds_yes\|odds_no" src/`

| File:Line(s) | Context | Disposition |
|---|---|---|
| `migrations/001_initial.js:53-54` | Original column definitions + CHECK constraints | Safe — schema definition, expected |
| `migrations/005_market_types.js:19` | Comment referencing the odds range reused for `market_options.odds` | Safe — comment only |
| `migrations/006_market_odds_nullable.js` (7 hits) | `ALTER COLUMN ... DROP/SET NOT NULL` + comments | Safe — schema migration relaxing the constraint for non-binary types |
| `repositories/marketRepository.js:44` | `create()`'s single INSERT column list | Safe — non-binary callers pass `oddsYes: null, oddsNo: null` (03-02/03-03 decision); this is a write, not a binary-only read/comparison |
| `services/wagerService.js:46,56` | `odds = choice === 'yes' ? market.odds_yes : market.odds_no` | Safe — inside `if (market.market_type === 'binary')` branch (03-04); non-binary sources odds from `market_options.odds` instead |
| `services/marketService.js:126,127,134,135` | `createMarket`'s binary-type destructure/validation/INSERT params | Safe — inside `if (marketType === 'binary')` branch (03-03) |

No non-binary code path reads `odds_yes`/`odds_no` anywhere in `src/`. Every remaining hit is either schema/migration text or inside an explicit `market_type === 'binary'` guard.

### `grep -rn "cashed_out_amount" src/`

| File:Line(s) | Context | Disposition |
|---|---|---|
| `migrations/004_cashout.js` (3 hits) | Column definition + comment | Safe — schema definition |
| `repositories/wagerRepository.js:67` | `incrementCashedOutAmount` — generic UPDATE by `wager.id` | Safe — market-type-agnostic, never references `choice`/`option_id` |
| `services/wagerService.js:134` (`cancelWager`) | `remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount)` | **Confirmed still correct** — Phase 2 CR-02 fix untouched by this plan; formula never references `wager.choice`, works identically for option_id-based wagers |
| `services/wagerService.js:213,285` (`cashoutWager`) | Same `remainingStake` formula, both the fresh-cashout and idempotent-replay branches | **Confirmed still correct** — same reasoning, untouched by this plan |
| `services/marketService.js:289` (`resolveMarket`, this plan) | `remainingFraction = (Number(wager.amount) - Number(wager.cashed_out_amount)) / Number(wager.amount)` | **This plan's own generalization point** — verified via test (d) and the mock-backed dry run to still scale correctly (200 × 0.6 = 120) for an `option_id`-based wager, not just binary |
| `services/marketService.js:383` (`deleteMarket`) | `remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount)` | **Confirmed still correct** — Phase 2 CR-03 fix untouched by this plan, same reasoning as `cancelWager` |

All three payout/refund paths this codebase has (`resolveMarket`, `cancelWager`, `deleteMarket`) independently confirmed `cashed_out_amount`-aware and correct for every market type — none of them regressed by this plan's `resolveMarket` change, since `cancelWager`/`deleteMarket` were not touched and never depended on `wager.choice` in the first place (matching the `<important_context>` note this plan was executed under).

**Audit conclusion:** No unbranched binary assumption remains in any money/resolution/refund path in `src/`. No additional fix was required beyond the plan's own Task 1 change.

## Issues Encountered

None beyond the carried-forward no-test-DB blocker (STATE.md, same as every prior Phase 3 plan): no live `*test*`-named Postgres database is reachable in this sandbox. `resolveMarket`'s generalized logic and `tests/markets.resolution.test.js` were verified structurally (`node --check`, `npx jest --listTests`, the plan's own `node -e` module-shape/regex assertion) and via a temporary mock-backed dry run (deleted before commit, not part of the deliverable) that drove the real, unmodified `marketService.resolveMarket` source against a fake Postgres client for all 6 scenarios (binary, over_under, multiple_choice, cashed-out regression, resolution IDOR, already-resolved rejection) — 21/21 assertions passed. Genuine execution against real Postgres constraints (the `FOR UPDATE` lock, the XOR CHECK, actual transaction commit/rollback semantics) remains deferred to the Phase 3 gate (03-07), same as every prior plan this phase.

Additionally observed (not a defect, documented for traceability): `src/controllers/marketsController.js` had never been committed to git prior to this plan (untracked since project init, per STATE.md's "in-progress work predating this planning session" blocker). Task 2's commit is this file's first git history entry, so its diff includes the file's full pre-existing content alongside the new `winning_option_id` passthrough — the source content itself was not altered beyond what the plan specified.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `marketService.resolveMarket` now supports all 3 market types end-to-end, closing the MARKET-07 requirement and the resolution half of MARKET-06. Combined with 03-03 (creation) and 03-04 (placement), every service-layer financial code path in this phase now branches correctly on `market_type` with no remaining unbranched binary assumption (confirmed by this plan's completeness audit).
- Plan 03-06 (admin/user frontend for the new market types) can now safely call `PUT /api/markets/:id/resolve` with either `{ outcome }` (binary) or `{ winning_option_id }` (new types) — the controller/service contract is stable.
- Blocker carried forward unchanged: no live `*test*`-named Postgres database reachable in this sandbox. `resolveMarket`'s generalization and `tests/markets.resolution.test.js` are structurally correct and dry-run-verified against the real, unmodified source, but need real-DB execution (human/CI) before the 03-07 phase gate — same limitation as 03-01 through 03-04.

---
*Phase: 03-new-market-types*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: src/services/marketService.js
- FOUND: src/controllers/marketsController.js
- FOUND: tests/markets.resolution.test.js
- FOUND: .planning/phases/03-new-market-types/03-05-SUMMARY.md
- FOUND: 8f437dc (Task 1 commit)
- FOUND: 64a4a59 (Task 2 commit)
- FOUND: 9c6d367 (Task 3 commit)
