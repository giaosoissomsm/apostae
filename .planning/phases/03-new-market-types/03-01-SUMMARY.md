---
phase: 03-new-market-types
plan: 01
subsystem: database
tags: [postgresql, migrations, schema, jest, testDb]

# Dependency graph
requires:
  - phase: 02-partial-cashout
    provides: wagers.cashed_out_amount, wager_cashouts table, money.js decimal-safe math, tests/helpers/testDb.js seed conventions
provides:
  - "markets.market_type discriminator ('binary'|'over_under'|'multiple_choice'), markets.threshold, markets.winning_option_id"
  - "market_options table (FK ON DELETE CASCADE, odds CHECK 1.01-1000, UNIQUE market_id+label)"
  - "wagers.option_id (nullable FK) + DB-level XOR CHECK against wagers.choice"
  - "tests/helpers/testDb.js: applyMarketTypesMigration(), seedMarketOptions(), generalized seedOpenMarket()/seedWager()"
affects: [03-02, 03-03, 03-04, 03-05, 03-06, 03-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-only migration module shape (id/up/down arrays of SQL strings), matching 004_cashout.js exactly"
    - "DB-level XOR CHECK constraint as defense-in-depth for mutually-exclusive columns (choice vs option_id)"
    - "Ownership-in-WHERE FK pattern (market_options.market_id FK ON DELETE CASCADE) as the storage-layer basis for IDOR-safe lookups downstream"
    - "Test-helper backward-compat branching: default-argument code path emits byte-identical SQL to the pre-existing query, new-argument path emits the extended query"

key-files:
  created:
    - src/migrations/005_market_types.js
  modified:
    - tests/helpers/testDb.js

key-decisions:
  - "seedOpenMarket()/seedWager() branch internally on whether new optional params were passed, so the default-argument SQL text is byte-identical to the pre-existing queries — this lets every Phase 1/2 test keep working even in a test DB that has not run applyMarketTypesMigration() yet"
  - "seedMarketOptions() returns id+sort_order per inserted row, ordered by sort_order, via one parameterized multi-row INSERT (never string-concatenated labels)"

patterns-established:
  - "Migration 005 down() is the exact reverse of up() (constraint drop before column drop before table drop), matching every prior migration's convention in this repo"

requirements-completed: [MARKET-01, MARKET-02, MARKET-03, MARKET-06]

coverage:
  - id: D1
    description: "Migration 005 module loads and defines all 7 additive schema changes (market_type, threshold, market_options table + index, winning_option_id, wagers.option_id, XOR CHECK, wagers.option_id index)"
    requirement: "MARKET-01"
    verification:
      - kind: unit
        ref: "node -e module-shape assertion (id/up/down array checks, SQL content checks) — see Task 1 verify block"
        status: pass
    human_judgment: false
  - id: D2
    description: "market_options table storage supports N selectable outcomes per market, FK'd with ON DELETE CASCADE, backing multiple-choice market creation"
    requirement: "MARKET-02"
    verification:
      - kind: unit
        ref: "node -e module-shape assertion (market_options presence, ON DELETE CASCADE presence) — see Task 1 verify block"
        status: pass
    human_judgment: false
  - id: D3
    description: "Migration is purely additive — market_type defaults existing rows to 'binary', all existing binary columns/CHECKs untouched, no backfill required"
    requirement: "MARKET-03"
    verification:
      - kind: unit
        ref: "node -e module-shape assertion (DEFAULT 'binary' presence) — see Task 1 verify block"
        status: pass
      - kind: other
        ref: "Live-DB execution of migration 005 against real Postgres — deferred to phase gate 03-07 per carried-forward no-test-DB blocker (STATE.md)"
        status: unknown
    human_judgment: true
    rationale: "No live *test*-named Postgres database is reachable in this sandbox (carried-forward blocker from Phase 1/2). Migration correctness was verified structurally (module shape, SQL content) but actual DDL execution against Postgres — confirming no existing binary row breaks and the migration applies cleanly — requires a human/CI environment with DB access, deferred to the 03-07 phase gate per this plan's own verification section."
  - id: D4
    description: "market_options.market_id FK establishes the parent-ownership relationship the MARKET-06 IDOR guard (WHERE id=$1 AND market_id=$2) will query against in downstream plans"
    requirement: "MARKET-06"
    verification:
      - kind: unit
        ref: "node -e module-shape assertion (market_options FK REFERENCES markets(id) ON DELETE CASCADE) — see Task 1 verify block"
        status: pass
    human_judgment: false
  - id: D5
    description: "tests/helpers/testDb.js extended with applyMarketTypesMigration(), seedMarketOptions(), and generalized seedOpenMarket()/seedWager() that stay byte-identical on default args"
    verification:
      - kind: unit
        ref: "node -e require+typeof assertion (applyMarketTypesMigration, seedMarketOptions, seedOpenMarket, seedWager all functions) — see Task 2 verify block"
        status: pass
      - kind: other
        ref: "node --check tests/helpers/testDb.js"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-14
status: complete
---

# Phase 03 Plan 01: Market-Types Storage Foundation Summary

**Additive migration 005 adding market_type/threshold/market_options/winning_option_id/wagers.option_id with a DB-level XOR CHECK, plus generalized testDb.js seed helpers that stay byte-identical for existing binary-market tests.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-14T22:20:00-03:00 (approx)
- **Completed:** 2026-07-14T22:29:09-03:00
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Migration `005_market_types.js` — purely additive schema: `markets.market_type` discriminator (defaulting existing rows to `'binary'`), `markets.threshold`, `market_options` table (FK `ON DELETE CASCADE`, `odds CHECK (1.01-1000)`, `UNIQUE(market_id, label)`, indexed), `markets.winning_option_id`, `wagers.option_id` (nullable FK), and a DB-level XOR `CHECK` guaranteeing every wager references exactly one of `choice`/`option_id`
- Migration's `down` array reverses `up` in exact opposite order (constraint → column → table → column), matching every prior migration's convention in this repo
- `tests/helpers/testDb.js` extended with `applyMarketTypesMigration()`, `seedMarketOptions(marketId, options)` (parameterized multi-row INSERT, never string-concatenated), and generalized `seedOpenMarket()`/`seedWager()` that accept optional `marketType`/`threshold`/`optionId` while emitting byte-identical SQL to the pre-existing queries when those new params are omitted

## Task Commits

Each task was committed atomically:

1. **Task 1: Create additive migration 005_market_types.js** - `a7d9cb8` (feat)
2. **Task 2: Extend tests/helpers/testDb.js with market-types seed helpers** - `4e6f839` (feat)

_No plan-metadata-only commit — final docs/state commit follows this summary._

## Files Created/Modified
- `src/migrations/005_market_types.js` - Additive migration: market_type/threshold/market_options/winning_option_id/wagers.option_id + XOR CHECK, auto-discovered by `scripts/migrate.js`'s `readdirSync`+`sort`
- `tests/helpers/testDb.js` - Added `applyMarketTypesMigration()`, `seedMarketOptions()`; generalized `seedOpenMarket()`/`seedWager()` with backward-compat branching

## Decisions Made
- **Backward-compat branching in test helpers, not unconditional new columns.** The plan's task 2 description could be read as "always add marketType/threshold/optionId to the INSERT column list," but that would break every Phase 1/2 test that calls `seedOpenMarket()`/`seedWager()` with no new args against a test DB that hasn't run `applyMarketTypesMigration()` yet (those columns wouldn't exist). Implemented an explicit `if` branch: when the new optional params are at their defaults (`marketType === 'binary' && threshold === null`, or `optionId === null`), the exact pre-existing SQL string runs; only when a caller opts into the new fields does the extended SQL (referencing the new columns) run. This satisfies the plan's own done-criterion ("Default-argument calls... produce the identical SQL the current helpers produce") literally, not just semantically.
- **`seedMarketOptions` returns `{id, sort_order}` rows, not full rows.** Sufficient for downstream tests to reference inserted option ids in order; matches the plan's explicit ask ("returning the inserted rows' ids in order").

## Deviations from Plan

None - plan executed exactly as written. The backward-compat branching above is an interpretation of the plan's own explicit done-criteria (byte-identical default-arg SQL), not a deviation from it.

## Issues Encountered

None. Migration module and testDb.js extensions were verified structurally (module shape, exported function presence, `node --check` syntax validation) since no live `*test*`-named Postgres database is reachable in this sandbox — same carried-forward limitation documented in STATE.md for Phase 1/2. Live-DB execution of migration 005 (confirming it applies cleanly and every pre-existing binary row keeps working) is deferred to the Phase 3 gate (03-07), per this plan's own `<verification>` section and 03-VALIDATION.md's "Known Environment Constraint."

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Storage foundation is ready for 03-02 onward: `marketOptionRepository.js` can be built directly against `market_options` (IDOR-safe `findByIdForMarket` per RESEARCH.md Pattern 1), `marketRepository.create`/`findAll` can be generalized to write/read the new columns, and `wagerRepository.create`/`SELECT_WITH_MARKET` can reference `wagers.option_id`.
- Every downstream Phase 3 integration test can now call `applyMarketTypesMigration()` in its `beforeAll`, then `seedOpenMarket({ marketType: 'over_under', threshold: 2.5 })` / `seedMarketOptions(marketId, [...])` / `seedWager({ optionId })` without re-implementing schema setup.
- Blocker carried forward unchanged: no live `*test*`-named Postgres database reachable in this sandbox. Migration 005 and the new test helpers are structurally correct and ready to run, but need real-DB execution (human/CI) before the 03-07 phase gate.

---
*Phase: 03-new-market-types*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: src/migrations/005_market_types.js
- FOUND: tests/helpers/testDb.js
- FOUND: .planning/phases/03-new-market-types/03-01-SUMMARY.md
- FOUND: a7d9cb8 (Task 1 commit)
- FOUND: 4e6f839 (Task 2 commit)
