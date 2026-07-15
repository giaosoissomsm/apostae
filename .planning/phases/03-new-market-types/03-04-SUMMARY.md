---
phase: 03-new-market-types
plan: 04
subsystem: api
tags: [transactions, idor, money, jest]

# Dependency graph
requires:
  - phase: 03-01
    provides: "migration 005 (markets.market_type/threshold, market_options table, wagers.option_id + XOR CHECK)"
  - phase: 03-02
    provides: "marketOptionRepository.findByIdForMarket — the IDOR-safe (market_id-scoped) option lookup chokepoint; wagerRepository.create(optionId-aware)"
provides:
  - "wagerService.placeWager generalized to binary/over_under/multiple_choice, server-sourced odds, IDOR-safe option lookup at the wager-placement chokepoint"
  - "tests/markets.idor.test.js — cross-market option_id rejection, own-market odds sourcing, client-odds-ignored, route-wiring non-admin-creation check"
affects: [03-05, 03-06, 03-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deferred market-type branch: choice/option_id validity is decided only after the market row is loaded and locked (FOR UPDATE) inside the transaction — never before, since the branch depends on market.market_type"
    - "money.multiply replacing the last remaining raw Math.round payout calculation in the codebase"

key-files:
  created:
    - tests/markets.idor.test.js
  modified:
    - src/services/wagerService.js

key-decisions:
  - "wagerService.placeWager still passes the raw destructured `choice` (not a locally-derived 'chosenChoice') to wagerRepository.create — wagerRepository.create's own optionId-ternary (optionId ? null : choice) already nulls it out when optionId is set (03-02 decision), so re-deriving it in the service would be redundant. Keeps the binary INSERT byte-identical without introducing a second place where the choice/option_id XOR is decided."
  - "The non-admin market-creation attack vector (plan Task 2's explicit ask) is verified via Express router-stack introspection (requireAuth before requireAdmin before the controller handler, by reference equality) rather than a live HTTP request — this repo has no supertest/Playwright/Cypress harness, and no other Phase 1/2/3 test file mounts the real Express app. Documented inline in the test file per the plan's own instruction to 'document the choice in a comment.'"

patterns-established:
  - "Any future service generalized the same way (branch depends on a DB row loaded inside a lock) should defer the client-input validation that depends on that row's type until after the row is loaded, not before — matches this plan's move of the choice validation from a pre-transaction guard into the market_type branch."

requirements-completed: [MARKET-03, MARKET-06]

coverage:
  - id: D1
    description: "placeWager places binary wagers with byte-identical behavior to pre-Phase-3 code (choice validation, odds_yes/odds_no lookup, same INSERT shape via optionId:null)"
    requirement: "MARKET-03"
    verification:
      - kind: unit
        ref: "node -e module-shape + regex assertion (market_type/findByIdForMarket/money.multiply present, Math.round(wagerAmount removed) — see Task 1 verify block"
        status: pass
      - kind: other
        ref: "Mock-backed dry run (deleted before commit) driving the real, unmodified wagerService.placeWager against a fake transaction/repository layer — binary wager returned choice:'yes', optionId:null, potentialPayout:180 for amount=100/odds=1.8, matching pre-change arithmetic exactly"
        status: pass
      - kind: other
        ref: "Live-DB execution against real Postgres — deferred to phase gate 03-07 per carried-forward no-test-DB blocker (STATE.md)"
        status: unknown
    human_judgment: true
    rationale: "No live *test*-named Postgres database is reachable in this sandbox (carried-forward blocker from Phase 1/2/03-01/02/03). Logic was verified structurally and via a mock-backed dry run reusing the real, unmodified service source (not a reimplementation), but actual transaction/FOR UPDATE execution against Postgres requires a human/CI environment with DB access."
  - id: D2
    description: "placeWager's non-binary branch validates option_id via marketOptionRepository.findByIdForMarket(optionId, market.id, client) inside the market lock — an option_id belonging to a different market resolves to null and is rejected with ValidationError before any wallet debit or wagers INSERT"
    requirement: "MARKET-06"
    verification:
      - kind: unit
        ref: "node -e regex assertion (findByIdForMarket call present in placeWager's source slice) — see Task 1 verify block"
        status: pass
      - kind: other
        ref: "Mock-backed dry run: option 100 (market 1) submitted while wagering on market 2 threw ValidationError; option 201 (market 2's own option) submitted while wagering on market 2 succeeded with odds_at_time=4.25 (the option's own odds, not a guessed/fabricated value)"
        status: pass
      - kind: other
        ref: "tests/markets.idor.test.js — 4 assertions covering cross-market rejection, own-market acceptance with server-sourced odds, forged-odds-ignored, and nonexistent-option rejection. Structurally valid (npx jest --listTests passes) and re-verified via the same mock-backed dry run technique reusing the real, unmodified wagerService/marketOptionRepository source"
        status: pass
      - kind: other
        ref: "Live-DB execution against real Postgres — deferred to phase gate 03-07"
        status: unknown
    human_judgment: true
    rationale: "Same carried-forward no-test-DB blocker as D1. The IDOR-rejection logic itself was exercised end-to-end against the real service/repository source via mock-backed dry run (not just static analysis), giving high confidence the logic is correct; only the Postgres FOR UPDATE lock/transaction semantics themselves remain unexecuted against a real database."
  - id: D3
    description: "cashoutWager and cancelWager (Phase 2) are byte-identical to their pre-Plan-04 state — this plan touches only placeWager"
    requirement: "MARKET-03 (regression guard)"
    verification:
      - kind: unit
        ref: "git diff src/services/wagerService.js — confirms only placeWager's method body and the top-level marketOptionRepository require were changed; cancelWager/cashoutWager/getMyWagers/getWagersByUsername are unmodified in the diff"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-15
status: complete
---

# Phase 03 Plan 04: Generalized Wager Placement Summary

**wagerService.placeWager now branches on the locked market's market_type: binary keeps its exact pre-existing choice/odds_yes/odds_no logic, while over_under/multiple_choice source odds from marketOptionRepository.findByIdForMarket — the IDOR-safe, market_id-scoped lookup chokepoint — inside the same FOR UPDATE lock scope. The pre-existing Math.round payout anti-pattern is replaced with money.multiply.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-14T23:44:00-03:00 (approx)
- **Completed:** 2026-07-14T23:47:10-03:00
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `wagerService.placeWager` accepts `option_id` alongside `choice`/`amount`. The binary `choice !== 'yes' && choice !== 'no'` validation moved from a pre-transaction guard into a `market.market_type === 'binary'` branch inside the transaction — it needs the market row loaded first, which now happens via the existing `SELECT ... FOR UPDATE` before any choice/option validation runs.
- Non-binary branch: `Number(option_id)` finiteness check, then `marketOptionRepository.findByIdForMarket(optionId, market.id, client)` — the single IDOR chokepoint established in 03-02. A `null` return (option missing or belonging to a different market) throws `ValidationError('Opção inválida para esse mercado.')` before any wallet debit or `wagers` INSERT.
- `potentialPayout` now computed via `money.multiply(wagerAmount, odds)`, replacing the pre-existing `Math.round(wagerAmount * odds * 100) / 100` anti-pattern (explicitly called out in `money.js`'s own header comment) — same numeric output for every binary case, decimal-safe for the new types.
- `wagerRepository.create` receives `optionId: chosenOptionId` (null for binary) alongside the unchanged `choice` value; the repository's own `optionId ? null : choice` ternary (03-02) already nulls `choice` out when an option is chosen, so the service didn't need to re-derive that itself.
- `cancelWager`, `cashoutWager`, `getMyWagers`, `getWagersByUsername` are completely untouched — confirmed via `git diff`.
- `tests/markets.idor.test.js`: seeds two `multiple_choice` markets (A/B) with 2 options each, asserts (1) a market-A option_id is rejected when wagering on market B (IDOR), (2) a market-B option_id succeeds with `odds_at_time` equal to that option's own `odds` (proves server-sourcing), (3) client-submitted `odds_at_time`/`potential_payout` fields are ignored (server always recomputes from the locked option), (4) a nonexistent `option_id` is rejected with `ValidationError`, not a raw DB error. A second `describe` block verifies the non-admin market-creation attack vector by inspecting `src/routes/markets.js`'s Express router stack for `requireAuth` → `requireAdmin` → controller ordering (by reference equality against the real, unmodified middleware/controller exports) — chosen because this repo has no HTTP-request test harness (no supertest/Playwright/Cypress in any Phase 1/2/3 test file).

## Task Commits

Each task was committed atomically:

1. **Task 1: Generalize wagerService.placeWager (option_id branch + IDOR lookup + money.multiply)** - `0e5bb3b` (feat)
2. **Task 2: Write IDOR and attack-vector test suite** - `f1063bc` (test)

_No plan-metadata-only commit — final docs/state commit follows this summary._

## Files Created/Modified
- `src/services/wagerService.js` - `placeWager` generalized (market_type branch, IDOR-safe option lookup via `marketOptionRepository.findByIdForMarket`, `money.multiply` payout); `cancelWager`/`cashoutWager`/`getMyWagers`/`getWagersByUsername` unchanged.
- `tests/markets.idor.test.js` - New: cross-market option_id IDOR rejection, own-market odds sourcing, client-odds-ignored, nonexistent-option rejection, non-admin market-creation route-wiring check.

## Decisions Made
- **`placeWager` passes the raw destructured `choice` to `wagerRepository.create`, not a locally-derived variable.** `wagerRepository.create`'s existing `optionId ? null : choice` ternary (03-02) already handles nulling `choice` out when `optionId` is set, so re-deriving it in the service (e.g. a `chosenChoice` local) would duplicate logic that already lives in exactly one place. This keeps the binary code path's INSERT parameters byte-identical to before.
- **Non-admin market-creation attack vector verified via router-stack introspection, not a live HTTP request.** No test file in this repo (Phase 1/2/3) mounts the real Express app or uses a request-simulation library — `requireAdmin`/`requireAuth` are always tested indirectly via service-layer behavior. Since the plan explicitly asked to "pick whichever the existing test infra supports and document the choice," this test instead asserts `POST /api/markets`'s route definition (`src/routes/markets.js`) has `requireAuth` before `requireAdmin` before `marketsController.createMarket` in its middleware stack, using reference equality against the real, unmodified exports — proving structurally that an authenticated-but-non-admin request can never reach the controller, without needing a request-simulation harness this codebase doesn't have.

## Deviations from Plan

None — plan executed exactly as written. Both tasks matched their `<action>`/`<verify>`/`<done>` blocks without needing any Rule 1-4 auto-fix.

## Issues Encountered

None beyond the carried-forward no-test-DB blocker (STATE.md, same as every prior Phase 3 plan): no live `*test*`-named Postgres database is reachable in this sandbox. `placeWager`'s generalized logic and `tests/markets.idor.test.js` were verified structurally (`node --check`, `npx jest tests/markets.idor.test.js --listTests`, the plan's own `node -e` module-shape/regex assertion) and via two temporary mock-backed dry runs (deleted before commit, not part of the deliverable) that drove the real, unmodified `wagerService.placeWager` source against a fake transaction/repository layer for both the general placement flow and the specific IDOR/attack-vector scenarios in the new test file — every assertion in both dry runs passed. The route-wiring assertion (non-admin creation) was additionally re-verified directly against the real, unmodified `src/routes/markets.js` outside of Jest (no mocking involved) and confirmed the exact `requireAuth(0) → requireAdmin(1) → createMarket(2)` ordering. Genuine execution against real Postgres constraints (the `FOR UPDATE` lock, the XOR CHECK, actual transaction commit/rollback semantics) remains deferred to the Phase 3 gate (03-07), same as every prior plan this phase.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `wagerService.placeWager` now supports all 3 market types end-to-end at the service layer, with the MARKET-06 IDOR guard enforced at the wager-placement chokepoint. Plan 03-05 (`marketService.resolveMarket` generalization) is the next consumer of the same `marketOptionRepository.findByIdForMarket` chokepoint, applied to `winning_option_id` at resolution time instead of `option_id` at placement time.
- Blocker carried forward unchanged: no live `*test*`-named Postgres database reachable in this sandbox. `placeWager`'s generalization and `tests/markets.idor.test.js` are structurally correct and dry-run-verified against the real, unmodified source, but need real-DB execution (human/CI) before the 03-07 phase gate — same limitation as 03-01/02/03.

---
*Phase: 03-new-market-types*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: src/services/wagerService.js
- FOUND: tests/markets.idor.test.js
- FOUND: .planning/phases/03-new-market-types/03-04-SUMMARY.md
- FOUND: 0e5bb3b (Task 1 commit)
- FOUND: f1063bc (Task 2 commit)
