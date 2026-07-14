---
phase: 01-notifications-infrastructure
plan: 04
subsystem: notifications
tags: [eventemitter, postgres, transactions, node, wagers, markets]

requires:
  - phase: 01-notifications-infrastructure (Plan 02)
    provides: domainEvents EventEmitter singleton, notificationService with all 7 catalog-event listeners already registered and idempotent
provides:
  - wagerService.placeWager/cancelWager now emit wager.placed/wager.cancelled on domainEvents strictly after their transaction() commits
  - marketService.closeMarket/resolveMarket/deleteMarket now emit market.closed/market.resolved/market.deleted (+ per-wager wager.won/wager.lost) strictly after commit
  - tests/notifications.emission.test.js — real, DB-backed tests asserting emission payloads and rollback-emits-nothing for all 5 call sites
  - tests/helpers/testDb.js extended with applyWalletSchema()/seedWallet() (needed by the emission tests to exercise the real wallets schema)
affects: [01-notifications-infrastructure, notifications-api, partial-cashout, market-types, cancellation-v2]

tech-stack:
  added: []
  patterns:
    - "Producer-side emit-after-commit: every domainEvents.emit(...) call site captures its payload fields from rows already read/written inside the transaction() closure, then emits strictly after the awaited transaction() promise resolves — never from inside the closure (D-01). A rollback (thrown error) short-circuits before the emit line is ever reached, so no event fires without a committed row."
    - "Non-transactional closeMarket reads recipients via a fresh parameterized query executed right after the UPDATE (not inside any transaction), still honoring 'no re-query after the emit' — the read happens once, before the single emit call."

key-files:
  created:
    - tests/notifications.emission.test.js
  modified:
    - src/services/wagerService.js
    - src/services/marketService.js
    - tests/helpers/testDb.js

key-decisions:
  - "Extended tests/helpers/testDb.js with applyWalletSchema() (migration 002) and seedWallet() (idempotent upsert), beyond the plan's files_modified list. wagerService.placeWager/cancelWager and marketService.resolveMarket/deleteMarket all read/write the wallets table inside their financial transaction; without these tables and a funded wallet, every emission test would fail on a missing-table or insufficient-balance error rather than exercising emission behavior. Same precedent as Plan 02's testDb.js extension (Rule 3, test-infra only)."
  - "resolveMarket/deleteMarket restructured to destructure { resolved, question, wagerOutcomes } / { question, refunds } from the transaction()'s return value, then emit from that destructured data outside the closure, while the method itself still returns only the original bare value (resolved market row / { ok, message }) so controllers (which do res.json(...) directly on these) never see the internal wagerOutcomes/refunds/question fields leak into the HTTP response."
  - "Verified all 5 emission call sites' runtime behavior (emit-after-commit ordering, exact payload shape, rollback-emits-nothing) via two temporary jest files that mocked src/config/database's transaction()/query() with a fake Postgres client, driving the real, committed wagerService.js/marketService.js modules — deleted before committing, not part of the deliverable. Necessary because no live Postgres test database is reachable from this sandbox (see Issues Encountered); same limitation and same compensating pattern as Plans 01-02 and 01-03."

patterns-established: []

requirements-completed: [NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, NOTIF-05]

coverage:
  - id: D1
    description: "wagerService.placeWager emits wager.placed { wagerId, userId, marketId, question, choice, amount } strictly after its transaction() commits; no emit on rollback"
    requirement: "NOTIF-01"
    verification:
      - kind: other
        ref: "grep -c \"domainEvents.emit('wager.placed'\" src/services/wagerService.js == 1; script confirming no domainEvents.emit textually inside the transaction(async (client) => {...}) closure == 0 violations"
        status: pass
      - kind: unit
        ref: "temporary mock-backed jest dry run (deleted before commit) — placeWager emits exactly once, with the exact expected payload, strictly after the last mocked client.query call; rollback (market not open) emits nothing"
        status: pass
      - kind: integration
        ref: "tests/notifications.emission.test.js — 'wagerService.placeWager emite wager.placed com o payload correto após o commit' / '...não emite wager.placed quando a transação sofre rollback'"
        status: unknown
    human_judgment: true
    rationale: "Source-level grep/AST-style checks and a mock-backed dry run against the real, committed module both pass, giving high confidence. The plan's actual required deliverable test (tests/notifications.emission.test.js) is written to the exact interface_context payload contract and is ready to run, but could not be executed against a live Postgres in this sandbox — no reachable *test*-named database exists here (pg_hba.conf/proxy allowlist only permits the 'apostae' dev/prod db, confirmed again this session). A human should run it against a real test database before treating this fully proven."
  - id: D2
    description: "wagerService.cancelWager emits wager.cancelled { wagerId, userId, marketId, question, amount } strictly after commit, keeps returning { ok: true }; no emit on rollback"
    requirement: "NOTIF-01"
    verification:
      - kind: other
        ref: "grep -c \"domainEvents.emit('wager.cancelled'\" src/services/wagerService.js == 1; grep -c 'return { ok: true };' src/services/wagerService.js == 1; no emit inside the transaction closure"
        status: pass
      - kind: unit
        ref: "temporary mock-backed jest dry run (deleted before commit) — cancelWager emits exactly once with the exact expected payload after all mocked queries, returns { ok: true }; rollback (not owner) emits nothing"
        status: pass
      - kind: integration
        ref: "tests/notifications.emission.test.js — 'wagerService.cancelWager emite wager.cancelled...' / '...não emite wager.cancelled quando a transação sofre rollback'"
        status: unknown
    human_judgment: true
    rationale: "Same as D1 — statically and dry-run verified against the real module; the real DB-backed test is written and ready but unexecutable in this sandbox."
  - id: D3
    description: "marketService.closeMarket emits market.closed { marketId, question, recipients } after the status write (idempotent no-op/no-emit if already non-open)"
    requirement: "NOTIF-02"
    verification:
      - kind: other
        ref: "grep -c \"domainEvents.emit('market.closed'\" src/services/marketService.js == 1"
        status: pass
      - kind: unit
        ref: "temporary mock-backed jest dry run (deleted before commit) — closeMarket emits exactly once with distinct pending-wager recipients strictly after the UPDATE+recipients query; already-closed market emits nothing (idempotent path)"
        status: pass
      - kind: integration
        ref: "tests/notifications.emission.test.js — 'marketService.closeMarket emite market.closed...' / '...não emite nada quando já não está aberto (idempotente)'"
        status: unknown
    human_judgment: true
    rationale: "Same DB-access limitation as D1/D2 — statically and dry-run verified against the real module; the real DB-backed test is written and ready but unexecutable in this sandbox."
  - id: D4
    description: "marketService.resolveMarket emits market.resolved { marketId, question, outcome, recipients } plus one wager.won/wager.lost per pending wager, all strictly after commit; external return shape unchanged (bare market row, no wagerOutcomes leak); no emit on rollback"
    requirement: "NOTIF-03"
    verification:
      - kind: other
        ref: "grep -c for market.resolved/wager.won/wager.lost each == 1; script confirming zero domainEvents.emit calls textually inside any transaction(async (client) => {...}) block; grep 'return resolved;' present"
        status: pass
      - kind: unit
        ref: "temporary mock-backed jest dry run (deleted before commit) — resolveMarket emits market.resolved + one wager.won + one wager.lost with exact payloads strictly after the last mocked query; returned value has no wagerOutcomes field; already-resolved rollback emits nothing"
        status: pass
      - kind: integration
        ref: "tests/notifications.emission.test.js — 'marketService.resolveMarket emite market.resolved + wager.won/wager.lost...' / '...não emite nada quando a transação sofre rollback (já resolvido)'"
        status: unknown
    human_judgment: true
    rationale: "Same DB-access limitation as D1-D3 — statically and dry-run verified against the real module; the real DB-backed test is written and ready but unexecutable in this sandbox."
  - id: D5
    description: "marketService.deleteMarket emits market.deleted { marketId, question, refunds } strictly after commit; still returns { ok: true, message: 'Mercado deletado.' }; no emit on rollback"
    requirement: "NOTIF-04"
    verification:
      - kind: other
        ref: "grep -c \"domainEvents.emit('market.deleted'\" src/services/marketService.js == 1; grep \"return { ok: true, message: 'Mercado deletado.' };\" present; no emit inside transaction closure"
        status: pass
      - kind: unit
        ref: "temporary mock-backed jest dry run (deleted before commit) — deleteMarket emits exactly once with the exact refunds array strictly after the last mocked query, returns { ok, message }; market-not-found rollback emits nothing"
        status: pass
      - kind: integration
        ref: "tests/notifications.emission.test.js — 'marketService.deleteMarket emite market.deleted...' / '...não emite nada quando a transação sofre rollback (mercado inexistente)'"
        status: unknown
    human_judgment: true
    rationale: "Same DB-access limitation as D1-D4 — statically and dry-run verified against the real module; the real DB-backed test is written and ready but unexecutable in this sandbox."

duration: ~25min
completed: 2026-07-14
status: complete
---

# Phase 1 Plan 4: Financial Event Emitters Summary

**Wired all 5 real call sites (placeWager, cancelWager, closeMarket, resolveMarket, deleteMarket) to emit the D-05 catalog events on `domainEvents` strictly after their financial transaction commits, completing the notifications producer chain without altering any transaction boundary, lock, or balance-mutation logic.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-14
- **Completed:** 2026-07-14
- **Tasks:** 2/2
- **Files modified:** 1 created (tests/notifications.emission.test.js), 3 modified (wagerService.js, marketService.js, tests/helpers/testDb.js)

## Accomplishments

- `wagerService.placeWager` captures `market.question` from the row already loaded inside its transaction and emits `wager.placed` with the exact interface_context payload strictly after `transaction()` resolves; external return value (the wager row) unchanged
- `wagerService.cancelWager` captures `wager.market_id`/`wager.amount`/`market.question` inside the closure, emits `wager.cancelled` after commit, still returns `{ ok: true }`
- `marketService.closeMarket` (not transactional) reads distinct pending-wager `user_id`s right after the status UPDATE and emits `market.closed` with `recipients`; the existing idempotent early-return (`status !== 'open'`) still emits nothing
- `marketService.resolveMarket` collects a `wagerOutcomes` array (won/lost, amount, payout) as its existing per-wager payout loop runs, returns it out of the transaction closure alongside `question`, then emits `market.resolved` plus one `wager.won`/`wager.lost` per pending wager after commit — the method itself still returns only the bare resolved-market row (`resolved.wagerOutcomes` is `undefined` for callers)
- `marketService.deleteMarket` collects a `refunds` array as its existing refund loop runs, emits `market.deleted` after commit, still returns `{ ok: true, message: 'Mercado deletado.' }`
- New `tests/notifications.emission.test.js`: 10 real, Postgres-backed tests (one per emission behavior + one rollback-emits-nothing test per call site, plus the idempotent-closeMarket and already-resolved-resolveMarket cases) driving the actual service methods and asserting exact payload shapes and emit timing
- `tests/helpers/testDb.js` extended with `applyWalletSchema()`/`seedWallet()` so the emission tests can exercise the real `wallets` table these financial operations read/write

## Task Commits

Each task was committed atomically:

1. **Task 1: wagerService — emit wager.placed and wager.cancelled after transaction commit** - `97a1f77` (feat)
2. **Task 2: marketService — emit market.closed/resolved/deleted + per-wager won/lost after commit** - `478b852` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `src/services/wagerService.js` - added `domainEvents` require; `placeWager`/`cancelWager` now emit `wager.placed`/`wager.cancelled` strictly after their `transaction()` resolves, with payload data captured from rows already read inside the closure
- `src/services/marketService.js` - added `domainEvents` + `query` (destructured from `../config/database`) requires; `closeMarket`/`resolveMarket`/`deleteMarket` now emit `market.closed`/`market.resolved`+`wager.won`/`wager.lost`/`market.deleted` strictly after their writes commit
- `tests/notifications.emission.test.js` - new: 10 real integration tests (wager: 4, market: 6) proving after-commit emission with contract-correct payloads and rollback-emits-nothing for all 5 call sites
- `tests/helpers/testDb.js` - added `applyWalletSchema()` (migration 002) and `seedWallet(userId, balance)` (idempotent upsert), needed because the emission tests exercise real wallet reads/writes inside the financial transactions

## Decisions Made

- Extended `tests/helpers/testDb.js` beyond the plan's `files_modified` list with `applyWalletSchema()`/`seedWallet()` — required because `wagerService`/`marketService`'s transactions read and write the `wallets` table; without it every emission test would fail on a missing table or `Créditos insuficientes` rather than exercising emission behavior. Minimal, non-architectural test-infra glue (Rule 3), same precedent as Plan 02.
- Restructured `resolveMarket`/`deleteMarket` to destructure internal-only fields (`wagerOutcomes`, `refunds`, `question`) out of the transaction's return value in a local variable, then emit from that data, while the method's own `return` statement still yields exactly the original external shape — verified by an explicit `resolved.wagerOutcomes` `toBeUndefined()` assertion in the emission test, since both controllers do `res.json(...)` directly on these return values (a leaked internal field would silently become part of the public API response).
- Verified all 5 call sites' runtime behavior via two temporary jest files (one per task) that mocked `src/config/database`'s `transaction()`/`query()` with a fake Postgres client keyed by SQL pattern, driving the real, committed service modules through success and rollback paths — deleted before each task's commit, not part of the deliverable. Necessary because no live Postgres test database is reachable in this sandbox (see Issues Encountered).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended tests/helpers/testDb.js with wallet schema and wallet seeding**
- **Found during:** Task 1 (writing the wager-side emission tests)
- **Issue:** `wagerService.placeWager`/`cancelWager` (and later `marketService.resolveMarket`/`deleteMarket`) read/write the `wallets` table inside their financial transaction. `testDb.js` (from Plans 01/02) only applied migration 001 (base schema) — no `wallets`/`wallet_transactions` tables and no way to fund a test wallet, so every emission test touching a real wager would fail on `Créditos insuficientes.` or a missing-table error before ever exercising the emit logic under test.
- **Fix:** Added `applyWalletSchema()` (applies migration 002's `up` array, safe to call repeatedly) and `seedWallet(userId, balance = 1000)` (idempotent `INSERT ... ON CONFLICT (user_id) DO UPDATE ... RETURNING id`).
- **Files modified:** `tests/helpers/testDb.js`
- **Verification:** `node -c` syntax check passed; the helpers are called (not merely defined) by every emission test's `beforeAll`/setup code.
- **Committed in:** `97a1f77` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking, test-infra only — no production code touched beyond what the plan specified for `wagerService.js`/`marketService.js`)
**Impact on plan:** Necessary to make the plan's required `tests/notifications.emission.test.js` functionally correct against the real schema these financial operations depend on. No scope creep into `wagerService.js`/`marketService.js` beyond the plan's exact emission points.

## Issues Encountered

**No live Postgres test database reachable in this sandbox (same limitation as Plans 01-02/01-03, re-confirmed this session).** `DB_NAME` resolves to `apostae` (the existing dev/prod database) by default; pointing at `apostae_test` fails at the network layer:

```
no pg_hba.conf entry for host "172.16.60.3", user "apostae", database "apostae_test", no encryption
```

Running `DB_NAME=apostae_test NODE_ENV=test npx jest tests/notifications.emission.test.js` in this environment fails on the very first `applyBaseSchema()` call with exactly this connection error — confirmed for both the wager-tagged and market-tagged subsets. This is an infrastructure/network-level constraint (the DB host's `pg_hba.conf` or a proxy in front of it only allows the `apostae` database name from this host), not something resolvable by application code changes.

To compensate, verification for this plan relied on three independent layers instead of one live-DB run:
1. The plan's own grep/AST-style source acceptance criteria (all pass — see `coverage` above): exactly one `domainEvents.emit(...)` call per catalog event in each file, zero emit calls textually inside any `transaction(async (client) => {...})` block (verified with a brace-depth-counting script, not just a line-range grep), and unchanged external return shapes (`return wager;`, `return { ok: true };`, `return resolved;`, `return { ok: true, message: 'Mercado deletado.' };`).
2. `node -c` syntax checks on every changed/created file.
3. Two temporary jest files (deleted before commit, not part of the deliverable) that mocked `src/config/database`'s `transaction()`/`query()` with a fake Postgres client pattern-matched by SQL text, driving the real, committed `wagerService.js`/`marketService.js` through all 5 call sites' success and rollback paths — 10 assertions total, all passing, including explicit "emit index is after the last query index" ordering checks and exact payload equality per the `interface_context` contract.

**Action needed:** once a genuinely reachable `*test*`-named Postgres database is available, run `DB_NAME=<test-db-name> NODE_ENV=test npm test` (or `npx jest tests/notifications.emission.test.js`) to get the real, SQL-level pass/fail signal. The test file is written to the plan's exact payload spec and is ready to run as-is — this is the same carried-forward blocker documented in Plan 02's and Plan 03's summaries.

## User Setup Required

**A reachable Postgres test database is required to fully verify this plan** (and Plans 02/03's still-unexecuted integration tests). See "Issues Encountered" above — this is an infrastructure/network-level constraint (the DB host's `pg_hba.conf` or a proxy in front of it only allows the `apostae` database name from this host), not something resolvable by application code changes. No other external service configuration is needed.

## Next Phase Readiness

- Phase 1 (notifications-infrastructure) is now functionally complete: `notificationService` (Plan 02) listens for all 7 catalog events, `notificationsController`/routes (Plan 03) expose them to users, and this plan wires the real financial call sites to actually emit them. A real user action (place a wager, cancel it, or an admin closing/resolving/deleting a market) now produces a corresponding notification row end-to-end, pending live-DB verification.
- **Blocker carried forward:** the unreachable test database (see Issues Encountered) still blocks *live* verification of this plan's and prior plans' integration tests, until infrastructure access is resolved (DB host `pg_hba.conf`/proxy allowlist, or a separate local test Postgres).
- Later milestone features (partial cashout, new market types, cancellation v2) that touch `wagerService.js`/`marketService.js` should preserve the emit-after-commit pattern established here — payload data captured inside the transaction closure, `domainEvents.emit(...)` called only after the `await transaction(...)` line, and any new financial method should return only its original external shape (no internal collector arrays leaking to controllers).

---
*Phase: 01-notifications-infrastructure*
*Completed: 2026-07-14*
