---
phase: 03-new-market-types
plan: 03
subsystem: api
tags: [postgresql, transactions, validation, jest]

# Dependency graph
requires:
  - phase: 03-01
    provides: "migration 005 (markets.market_type/threshold/winning_option_id, market_options table, wagers.option_id + XOR CHECK), tests/helpers/testDb.js market-types seed helpers"
  - phase: 03-02
    provides: "marketOptionRepository.createMany/findByIdForMarket, marketRepository.create(marketType/threshold/client), marketRepository.findAll (json_agg options)"
provides:
  - "marketService.createMarket generalized to binary/over_under/multiple_choice, branching on market_type (default 'binary')"
  - "Server-side option-count bound (2-20), duplicate-label rejection (case/whitespace-insensitive), threshold/odds validation — all independent of any client UI"
  - "migration 006_market_odds_nullable.js — markets.odds_yes/odds_no relaxed to nullable (blocking gap left by migration 005)"
  - "tests/markets.creation.test.js, tests/markets.validation.test.js"
affects: [03-04, 03-05, 03-06, 03-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-type validation branch inside a single service method, each branch throwing ValidationError before any DB write (never a raw Error/500)"
    - "Transaction wrapping only where a multi-row write actually needs atomicity (over_under/multiple_choice market+options); binary keeps its pre-existing single-INSERT, no-transaction path unchanged"
    - "Server-side-derived labels ('Over X'/'Under X') vs. admin-supplied odds — labels are never accepted as free text for over_under"

key-files:
  created:
    - src/migrations/006_market_odds_nullable.js
    - tests/markets.creation.test.js
    - tests/markets.validation.test.js
  modified:
    - src/services/marketService.js
    - tests/helpers/testDb.js

key-decisions:
  - "Added migration 006_market_odds_nullable.js (out of this plan's stated files_modified) — migration 005 left markets.odds_yes/odds_no as NOT NULL, which would make every over_under/multiple_choice INSERT fail outright since those types never populate those columns. This is a Rule 1/2 auto-fix (blocking correctness gap in already-shipped schema, not a new architectural surface): a 2-line ALTER COLUMN DROP NOT NULL, purely relaxing an existing constraint, no data migration, no existing binary row affected. tests/helpers/testDb.js's applyMarketTypesMigration() now applies both 005 and 006 together, since neither type can be created without both."
  - "Binary branch is NOT wrapped in transaction() — a single INSERT is already atomic, and RESEARCH.md/03-PATTERNS.md's 'byte-identical' requirement is about behavior, not about forcing an unnecessary transaction wrapper onto a path that never needed one. Only over_under/multiple_choice (market INSERT + options bulk-insert, two statements that must succeed or fail together) use transaction()."
  - "Over/Under option labels ('Over {threshold}'/'Under {threshold}') are always derived server-side from the validated threshold — never accepted as option text from the client, matching the STATE.md-locked 3-field form contract (threshold + Odds Over + Odds Under)."

patterns-established:
  - "validateOptionsInput() as the single chokepoint for multiple_choice's count/label/odds/duplicate validation, reused verbatim by any future caller that needs the same 2-20 bound and dedupe logic."

requirements-completed: [MARKET-01, MARKET-02, MARKET-04, MARKET-05]

coverage:
  - id: D1
    description: "marketService.createMarket generalized to branch on market_type (default 'binary'); over_under validates threshold>0 + 2 admin-supplied odds and auto-labels 'Over X'/'Under X'; multiple_choice validates 2-20 unique-labeled options"
    requirement: "MARKET-01"
    verification:
      - kind: unit
        ref: "node -e module-shape assertion (market_type/over_under/multiple_choice/createMany/transaction presence in createMarket's source slice) — see Task 1 verify block"
        status: pass
      - kind: other
        ref: "Mock-backed dry run (deleted before commit) driving the real createMarket against a fake Postgres client — over_under case asserted threshold=2.5, options[0].label='Over 2.5', options[1].label='Under 2.5', both odds correct"
        status: pass
      - kind: other
        ref: "Live-DB execution against real Postgres — deferred to phase gate 03-07 per carried-forward no-test-DB blocker (STATE.md)"
        status: unknown
    human_judgment: true
    rationale: "No live *test*-named Postgres database is reachable in this sandbox (carried-forward blocker from Phase 1/2/03-01/03-02). Logic was verified structurally and via a mock-backed dry run reusing the real, unmodified service source, but actual DDL/DML execution against Postgres — confirming migration 006 applies cleanly and the transaction commits atomically — requires a human/CI environment with DB access."
  - id: D2
    description: "multiple_choice option count bounded 2-20 server-side, independent of any client UI cap (MARKET-05) — 21 options rejected, exactly 20 accepted"
    requirement: "MARKET-05"
    verification:
      - kind: other
        ref: "Mock-backed dry run: 1-option and 21-option multiple_choice both rejected with ValidationError before any DB write (COUNT(*) unchanged); exactly-20-option case created successfully"
        status: pass
      - kind: other
        ref: "Live-DB execution — deferred to phase gate 03-07"
        status: unknown
    human_judgment: true
    rationale: "Same carried-forward no-test-DB blocker as D1."
  - id: D3
    description: "Duplicate option labels (case/whitespace-insensitive) rejected server-side for multiple_choice"
    requirement: "MARKET-04"
    verification:
      - kind: other
        ref: "Mock-backed dry run: ['Time A', '  time a  '] rejected with ValidationError, no market row written"
        status: pass
      - kind: other
        ref: "Live-DB execution — deferred to phase gate 03-07"
        status: unknown
    human_judgment: true
    rationale: "Same carried-forward no-test-DB blocker as D1."
  - id: D4
    description: "Binary market creation (market_type absent or 'binary') behaves identically to pre-Phase-3 code: same question/odds validation, no transaction wrapper, same return shape (no options key)"
    requirement: "MARKET-03 (regression guard, not a Phase-3-new requirement but explicitly re-verified this plan)"
    verification:
      - kind: other
        ref: "Mock-backed dry run: binary market with/without market_type field both return market_type:'binary', threshold:null, options:undefined"
        status: pass
      - kind: other
        ref: "Live-DB execution against real Postgres — deferred to phase gate 03-07"
        status: unknown
    human_judgment: true
    rationale: "Same carried-forward no-test-DB blocker as D1."
  - id: D5
    description: "tests/markets.creation.test.js and tests/markets.validation.test.js exist as valid Jest suites covering every positive/negative case from this plan's must_haves"
    verification:
      - kind: unit
        ref: "npx jest tests/markets.creation.test.js tests/markets.validation.test.js --listTests"
        status: pass
      - kind: other
        ref: "Live-DB execution against real Postgres — deferred to phase gate 03-07"
        status: unknown
    human_judgment: true
    rationale: "Same carried-forward no-test-DB blocker — test files are structurally valid and were exercised via a mock-backed dry run (21/21 assertions passed, reusing the real committed testDb helpers/marketService/errors source, not simplified reimplementations), but a genuine pass/fail signal against real Postgres constraints (CHECK, UNIQUE, FK) requires the 03-07 gate."

duration: 20min
completed: 2026-07-15
status: complete
---

# Phase 03 Plan 03: Generalized Market Creation Summary

**marketService.createMarket branches on market_type to create binary (unchanged), over_under (threshold + 2 auto-labeled options), and multiple_choice (2-20 deduped options) markets, all server-side-validated and transaction-wrapped where atomicity is needed — plus a migration fix (006) closing a blocking odds_yes/odds_no NOT NULL gap left by migration 005.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-15T02:17:00Z (approx)
- **Completed:** 2026-07-15T02:32:13Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- `marketService.createMarket` generalized: branches on `body.market_type` (default `'binary'`, preserving today's implicit contract for any caller that omits it). Binary path is untouched — same `question`/`isValidOdds` checks, no transaction wrapper (a single INSERT was already atomic), same return shape (no `options` key).
- `over_under` branch: `threshold` validated `Number.isFinite && > 0`; `odds_over`/`odds_under` each validated via the existing `isValidOdds`; builds exactly 2 option rows with server-derived labels (`Over {threshold}`/`Under {threshold}`) and admin-supplied odds, written atomically with the market row in one `transaction()`.
- `multiple_choice` branch: options array bounded 2-20 (`MARKET-05`, independent of any client cap); each label trimmed/non-empty, each odds `isValidOdds`, duplicate labels rejected via case-insensitive trimmed comparison; N option rows written in submitted order, atomically with the market row.
- Every rejection throws `ValidationError` (PT-BR message) before any DB write; an unknown `market_type` string is rejected the same way.
- New market types never get a `scheduled_outcome` (Pitfall 6 from 03-RESEARCH.md) — `finalScheduledOutcome` is forced to `null` for any non-binary type even if the client sends one.
- **Migration 006** (`src/migrations/006_market_odds_nullable.js`): relaxes `markets.odds_yes`/`odds_no` to nullable. Migration 005 (03-01) added `market_type`/`threshold`/`market_options` but left `odds_yes`/`odds_no` as `NOT NULL` — since `over_under`/`multiple_choice` never populate those two columns (they use `market_options.odds` per-row instead), every non-binary `INSERT` would have failed with a `NOT NULL` violation. Purely relaxing, no data change; the pre-existing `CHECK` constraints already tolerated `NULL` (Postgres `CHECK` only rejects a `FALSE` evaluation, and a comparison against `NULL` evaluates `UNKNOWN`, which passes).
- `tests/helpers/testDb.js`'s `applyMarketTypesMigration()` now applies both migration 005 and 006, since the two are required together for any non-binary market creation to succeed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Generalize marketService.createMarket with per-type server-side validation + transaction** - `a65ee30` (feat)
2. **Task 2: Write creation and validation test suites** - `5e0480a` (test)

_No plan-metadata-only commit — final docs/state commit follows this summary._

## Files Created/Modified
- `src/services/marketService.js` - `createMarket` generalized (binary/over_under/multiple_choice branches), new `MARKET_TYPES`/`MIN_OPTIONS`/`MAX_OPTIONS` constants and `validateOptionsInput()` helper; `closeMarket`/`resolveMarket`/`deleteMarket` untouched.
- `src/migrations/006_market_odds_nullable.js` - New additive migration: `ALTER TABLE markets ALTER COLUMN odds_yes/odds_no DROP NOT NULL`.
- `tests/helpers/testDb.js` - `applyMarketTypesMigration()` extended to also apply migration 006.
- `tests/markets.creation.test.js` - New: binary regression (with/without explicit `market_type`), over_under (threshold + 2 labeled options), multiple_choice (4 options in order, 2-option floor).
- `tests/markets.validation.test.js` - New: below-floor/above-20-bound option counts (with an at-the-limit 20 positive control), duplicate labels, malformed threshold (0/negative/NaN), out-of-range odds, unknown `market_type`, binary odds-out-of-range regression, short question for any type.

## Decisions Made
- **Migration 006 added, outside this plan's stated `files_modified`.** Migration 005 (03-01, already committed/summarized) left `markets.odds_yes`/`odds_no` `NOT NULL`, which is a genuine blocking bug: it would make every `over_under`/`multiple_choice` market creation fail with a raw Postgres `23502` (not-null violation) instead of the clean `ValidationError`s this plan's own success criteria require. Fixed via Rule 1/2 (bug/missing-critical-functionality) rather than Rule 4 (architectural) — it's a 2-line constraint relaxation on an existing column, not a new table/service/framework, and it directly blocks this plan's stated success criteria ("Over/Under creation requires exactly 3 admin-supplied fields... labels auto-generate").
- **Binary branch stays outside `transaction()`.** A single `INSERT` is already atomic; wrapping it would add code with no correctness benefit and risk deviating from "binary creation stays byte-identical." Only `over_under`/`multiple_choice` (market + options, two statements) use `transaction()`.
- **Over/Under labels are always server-derived, never client-supplied text**, matching STATE.md's locked 3-field decision (threshold + Odds Over + Odds Under) — this was already explicit in the plan and confirmed unambiguously during implementation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/2 - Bug / Missing Critical Functionality] markets.odds_yes/odds_no NOT NULL blocked all non-binary market creation**
- **Found during:** Task 1 (generalizing `createMarket`), before writing any code — traced by re-reading migration 001's `markets` table definition against migration 005's actual column list.
- **Issue:** Migration 005 (03-01) added `market_type`/`threshold`/`market_options` but never relaxed `markets.odds_yes`/`odds_no` from `NOT NULL`. Since `over_under`/`multiple_choice` markets never populate those two columns (per RESEARCH.md's own design — they use `market_options.odds`), any INSERT for those types would fail with a Postgres `23502` not-null violation, not a clean `ValidationError`. This would have made MARKET-01/MARKET-02 impossible to satisfy at the database level regardless of how correct the service-layer validation was.
- **Fix:** Added `src/migrations/006_market_odds_nullable.js` (`ALTER TABLE markets ALTER COLUMN odds_yes/odds_no DROP NOT NULL`), purely additive/relaxing, no data change. Extended `tests/helpers/testDb.js`'s `applyMarketTypesMigration()` to apply it alongside migration 005.
- **Files modified:** `src/migrations/006_market_odds_nullable.js` (new), `tests/helpers/testDb.js`.
- **Verification:** Mock-backed dry run confirms `oddsYes: null, oddsNo: null` flow through `marketRepository.create` without error for both new types; migration file passes `node --check`.
- **Committed in:** `a65ee30` (Task 1 commit).

---

**Total deviations:** 1 auto-fixed (1 Rule 1/2 blocking bug in already-shipped schema).
**Impact on plan:** Essential for MARKET-01/MARKET-02 to be achievable at all against real Postgres. No scope creep — the fix is a 2-line constraint relaxation on the specific columns this plan's new code paths needed, nothing broader touched.

## Issues Encountered
None beyond the migration gap documented above. As with every prior Phase 1/2/3 plan, no live `*test*`-named Postgres database is reachable in this sandbox (carried-forward blocker, STATE.md) — `createMarket`'s new logic and both test files were verified structurally (`node --check`, `npx jest --listTests`, the plan's own `node -e` module-shape assertion) and via a temporary mock-backed dry run (deleted before commit, not part of the deliverable) that drove the real, unmodified `marketService`/`testDb` helper source against a fake Postgres client — 21/21 dry-run assertions passed (5 creation-positive cases + 16 validation-rejection cases including the at-the-limit 20-option positive control). Genuine execution against real Postgres constraints (CHECK, UNIQUE(market_id,label), the migration 006 fix itself) is deferred to the Phase 3 gate (03-07), same as every prior plan this phase.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `marketService.createMarket` now supports all 3 market types end-to-end at the service layer; Plans 03-04 (`wagerService.placeWager` generalization) and 03-05 (`resolveMarket` generalization) can build on it without touching this method.
- Migration 006 must be picked up by `scripts/migrate.js`'s auto-discovery (`readdirSync` + `sort`) the same way 001-005 were — no wiring change needed, confirmed by file naming convention (`006_` sorts after `005_`).
- Blocker carried forward unchanged: no live `*test*`-named Postgres database reachable in this sandbox. `createMarket`'s generalization, migration 006, and both new test files are structurally correct and dry-run-verified, but need real-DB execution (human/CI) before the 03-07 phase gate — same limitation as 03-01/03-02.

---
*Phase: 03-new-market-types*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: src/services/marketService.js
- FOUND: src/migrations/006_market_odds_nullable.js
- FOUND: tests/markets.creation.test.js
- FOUND: tests/markets.validation.test.js
- FOUND: tests/helpers/testDb.js
- FOUND: .planning/phases/03-new-market-types/03-03-SUMMARY.md
- FOUND: a65ee30 (Task 1 commit)
- FOUND: 5e0480a (Task 2 commit)
