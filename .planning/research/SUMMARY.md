# Project Research Summary

**Project:** ApostaE — feature-expansion milestone (notifications, partial cashout, new market types, paid cancellation)
**Domain:** Real-money betting/wagering platform (fixed-odds, admin-resolved, no live odds feed)
**Researched:** 2026-07-13
**Confidence:** MEDIUM-HIGH (codebase-grounded findings are HIGH; industry-pattern cross-checks are MEDIUM)

## Executive Summary

ApostaE is a fixed-odds betting platform (Express + PostgreSQL + Redis) resolved by admin action or a scheduler, not a live in-play sportsbook — this constraint reshapes every "industry standard" pattern researched. This milestone adds four features in a fixed build order (Notifications -> Partial Cashout -> New Market Types -> Cancellation v2), and the research strongly confirms that order is correct: notifications must exist before the "cashout-available" alert type, cashout must be market-type-agnostic before market types diversify, and cancellation v2's "block if already cashed out" guard requires cashout's schema to exist first.

The recommended approach adds zero new core dependencies -- every feature is a data-modeling and service-layer extension of patterns already in the codebase (the `transaction()` helper, `SELECT ... FOR UPDATE` row locking, the Controller->Service->Repository layering, the `wallet_transactions` append-only ledger convention). Notifications get a hand-rolled table plus a single `domainEvents` EventEmitter chokepoint (so a future realtime upgrade is additive, not a rewrite). Partial cashout must use a stake-proportional, non-live-odds formula (no live probability signal exists to price a "real" cash-out), backed by an immutable `wager_cashouts` ledger. New market types (Over/Under, multiple-choice) need a `market_type` discriminator column plus a new `market_options` table -- a normalized approach since option count is explicitly unbounded. Cancellation v2 replaces the existing cancel logic in place (no versioning/flags -- this is pre-production code with no live traffic to protect).

The dominant risk category, by far, is concurrency and financial-integrity bugs, not feature complexity. The codebase already has a documented, unfixed scheduler race (no distributed lock coordinating resolution with other mutations) and no idempotency keys on financial mutations -- both become materially more dangerous once cashout and cancellation add two new concurrent actors racing against resolution on the same wager/market rows. Every new financial code path must: lock rows in a consistent order (markets -> wagers -> wallets) inside `transaction()`, re-validate state after the lock (never before), recompute money server-side (never trust client-submitted amounts), use decimal-safe rounding (not the existing float-based `Math.round` shim), and carry a client-supplied idempotency key enforced via a DB unique constraint. The scheduler locking gap should be treated as an in-scope blocker for the Partial Cashout phase, not deferred technical debt.

## Key Findings

### Recommended Stack

No new dependencies. Reuse `pg`, Redis, Joi, and Express exactly as they exist today; the "library" for each new feature is really "a migration plus a repository/service following existing conventions." The one adjacent, optional addition is `helmet` for security headers (unrelated to this milestone's four features but cheap since `server.js` middleware is already being touched). See STACK.md for full detail, including the Option A vs Option B cashout-formula decision (Option A -- stake-proportional -- is the safe default; Option B -- probability-weighted -- requires explicit product sign-off and is not a default).

**Core technologies:**
- `pg` (existing): new `notifications`, `wager_cashouts`, `market_options` tables and columns -- raw SQL/prepared statements, matching existing convention
- Redis (existing): optional unread-count cache now; ready-made pub/sub (`client.duplicate()`) for a future realtime upgrade, no new package needed
- Joi (existing): validate every new endpoint's input -- an existing gap ("imported but not consistently applied") this milestone should close
- In-process `EventEmitter` (new, zero-dependency): single `domainEvents` chokepoint decoupling notification writes from wager/market services

### Expected Features

Full detail in FEATURES.md. All four in-scope features are P1/must-ship per PROJECT.md; there is no larger backlog to trim from -- the MVP question here is sequencing and depth, not feature selection.

**Must have (table stakes):**
- Bet status notifications (closed, resolved, won, lost, status change, cashout-available) -- structure-only (DB + read/unread + paginated API), no push transport this milestone
- Partial cashout -- deterministic, backend-computed, minimum-amount enforced, disabled once market closed/wager resolved
- Over/Under market type -- admin-set numeric threshold, reuses existing binary payout mechanics
- Multiple-choice market type -- dynamic/unbounded option count, dedicated `market_options` table
- Fee-based cancellation (5%/95%) -- blocked once market closed, wager resolved, or a cashout already occurred; full audit trail

**Should have (competitive):**
- Cashout-available notification (proactive) -- cheap once notification infra exists
- Transparent, documented (non-opaque) cashout formula -- a genuine differentiator given no live-odds engine exists to hide behind

**Defer (v2+):**
- Real-time push delivery (WebSocket/SSE) -- build only the `notify()` chokepoint now
- Full (100%) cashout -- validate partial cashout's concurrency patterns in production first
- Promotional notifications -- explicitly an anti-feature (dilutes signal, consumer-protection concern)
- Live/dynamic odds -- would require an entirely new pricing engine, out of scope

### Architecture Approach

All four features slot into the existing `Routes -> Controllers -> Services -> Repositories -> PostgreSQL/Redis` layering with no new architectural layer except a tiny `src/events/domainEvents.js` singleton. Financial mutations (cashout, cancellation) reuse the exact `transaction()` + `SELECT ... FOR UPDATE` + re-validate-after-lock pattern already used by `placeWager`/`resolveMarket`; notification writes go through a decoupled event-emit-after-commit path so they never risk the financial transaction's atomicity. New market types use a `market_type` discriminator column on `markets` plus a new `market_options` table (not flattened columns, since option count is unbounded) -- the binary market's existing code path stays byte-for-byte unchanged.

**Major components:**
1. `domainEvents` (new) -- in-process EventEmitter; services emit after transactions commit, `notificationService` is the sole subscriber/writer
2. `notificationService` + `notificationRepository` (new) -- paginated, read/unread, per-user-scoped CRUD
3. `wagerService.cashoutWager()` (extends existing service) -- lock market->wager->wallet in order, re-validate, compute server-side, write `wager_cashouts` audit row
4. `market_options` schema + `marketOptionRepository` (new) -- normalized child table for Over/Under and multiple-choice, dispatched by `market_type` in the service layer
5. `wagerService.cancelWager()` (body replaced in place, no versioning) -- fee computed from remaining stake post-cashout, same lock-then-revalidate shape

### Critical Pitfalls

Full detail (9 pitfalls) in PITFALLS.md. Top risks:

1. **Double cashout via concurrent requests (TOCTOU)** -- lock the wager row `FOR UPDATE` first, re-validate status after the lock, and enforce a client-supplied idempotency key via a DB unique constraint.
2. **Trusting client-submitted cashout amounts** -- the confirm endpoint must recompute value server-side from the locked wager row; reject any request that carries an amount/value field.
3. **Cashout/cancellation racing market resolution** -- all three code paths (resolution, cashout, cancellation) must lock the market row first, then the wager row, in the same global order, and re-check status after each lock; the existing unfixed scheduler race must be closed no later than the Partial Cashout phase.
4. **Floating-point rounding drift in proportional math** -- partial-cashout and cancellation-fee math must use integer-cents or a decimal library, not the existing `Math.round(x*100)/100` float shim; add a reconciliation check that `wallet.balance` equals the sum of `wallet_transactions`.
5. **Cancellation fee computed from stale/original amount** -- once cashout exists, "cancellable amount" is `wager.amount - cashed_out_amount`, always read under lock, never the original stored amount.

Also flagged: unbounded market-option counts need a hard server-side max (DoS/payout-loop risk); option IDs must always be scoped by `market_id` (IDOR); every notification route (including by-ID) must filter by `user_id`, not just the list endpoint.

## Implications for Roadmap

Research strongly validates PROJECT.md's mandated build order -- treat it as confirmed, not just assumed. Suggested phase structure:

### Phase 1: Notifications (structure-only)
**Rationale:** No dependencies on other new features; establishes the `domainEvents` chokepoint and the per-user ownership-check pattern that every later notification type (cashout-available, resolution alerts) must inherit correctly.
**Delivers:** `notifications` table, `notificationRepository`/`notificationService`, paginated read/unread REST API, `domainEvents` singleton wired into `marketService`.
**Addresses:** Bet status notifications (closed/resolved/won/lost/status-change) from FEATURES.md.
**Avoids:** Pitfall 8 (IDOR/enumeration on notifications) -- bake `WHERE user_id = current_user` into every route (list, get-by-id, mark-read, delete) from the start.

### Phase 2: Partial Cashout
**Rationale:** Must come before New Market Types so the cashout schema/formula is designed market-type-agnostically from day one (avoiding rework once Over/Under and multiple-choice exist); also the first feature to introduce a new concurrent actor racing against market resolution, so the scheduler locking gap must be closed here.
**Delivers:** `wager_cashouts` ledger table, `cashed_out_amount` column on `wagers`, `cashoutWager()` service method (stake-proportional formula, Option A), idempotency-key enforcement, cashout-available notification (reuses Phase 1 infra).
**Uses:** Existing `transaction()` + `FOR UPDATE` pattern; existing `wallet_transactions` ledger convention.
**Implements:** Lock-then-revalidate pattern (markets -> wagers -> wallets ordering) as the shared template for Phase 4.
**Avoids:** Pitfalls 1-4 and 9 (double cashout, client-trusted amounts, resolution race, rounding drift, wallet TOCTOU) -- this phase carries the highest concurrency risk in the milestone and needs explicit concurrency/attack-vector tests before being marked done.

### Phase 3: New Market Types (Over/Under, Multiple-Choice)
**Rationale:** Depends on nothing from Phase 2's cashout logic (cashout is designed generically), but must land before Cancellation v2 is finalized only in the sense that both need to coexist cleanly; primarily gated by needing its own schema work (`market_options` table).
**Delivers:** `market_type` discriminator column, `market_options` table, `marketOptionRepository`, per-type resolution dispatch (`marketResolution/{binary,overUnder,multipleChoice}.js`), admin market-creation validation.
**Addresses:** Over/Under and Multiple-Choice market types from FEATURES.md (the highest data-modeling complexity item in the milestone).
**Avoids:** Pitfall 6 (unbounded option counts -- enforce a hard server-side max) and Pitfall 7 (IDOR on option IDs -- always scope by `market_id`).

### Phase 4: Cancellation v2 (fee-based)
**Rationale:** Explicitly depends on Phase 2's cashout schema (the "block if already cashed out" guard needs `cashed_out_amount` to exist) -- this dependency is confirmed by architecture analysis, not just asserted by PROJECT.md's ordering.
**Delivers:** Replaced `wagerService.cancelWager()` body (same route/method, no flag/versioning), 5%/95% fee split computed from remaining stake, expanded guard clauses (market open, wager pending, no prior cashout).
**Addresses:** Fee-based cancellation with clear disclosure from FEATURES.md.
**Avoids:** Pitfall 5 (fee computed on stale/original amount instead of post-cashout remaining stake) -- requires an explicit partial-cashout-then-cancel test.

### Phase Ordering Rationale

- Notifications first because it has zero dependencies and everything else optionally emits into it.
- Cashout before Market Types because Market Types would otherwise force a rework of a cashout formula/schema built against binary-only assumptions.
- Market Types before Cancellation v2 only incidentally (no hard dependency between them) -- Cancellation v2's real hard dependency is on Cashout (phase 2), not Market Types (phase 3).
- The scheduler race (pre-existing, documented gap) must be fixed inside Phase 2, since that is the first phase to introduce a second concurrent actor against market resolution -- deferring it multiplies risk across every subsequent financial phase.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Partial Cashout):** needs research-phase attention specifically for the concurrency test harness design and the exact decimal-safe money-math utility to standardize on (integer-cents vs. a library like `decimal.js`) -- this utility should be built once and shared with Phase 4.
- **Phase 3 (New Market Types):** needs research-phase attention for the resolution-dispatch module structure and the exact min/max option-count bounds (a product decision, not purely technical).

Phases with standard patterns (skip research-phase):
- **Phase 1 (Notifications):** well-documented hand-rolled pattern, directly mirrors existing repository/service conventions -- low ambiguity.
- **Phase 4 (Cancellation v2):** structurally a straight replacement of existing logic using patterns already proven in Phase 2 -- low ambiguity once Phase 2 ships.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | No-new-dependency conclusion and schema recommendations are grounded directly in reading the actual codebase (migrations, services); cash-out formula guidance is cross-verified web research adapted to a platform-specific constraint (no live odds) |
| Features | MEDIUM | Cross-corroborated across multiple real sportsbook sources, but every pattern required explicit adaptation since ApostaE has no live odds feed -- adaptation judgment is sound but less externally verifiable than a direct citation |
| Architecture | HIGH for integration patterns (directly read `database.js`, `wagerService.js`, `marketService.js`, migrations) / MEDIUM-LOW for the generic industry-pattern citations used only to validate those codebase-derived choices |
| Pitfalls | HIGH | Verified against OWASP references, PostgreSQL concurrency literature, and direct inspection of the actual codebase's existing gaps (CONCERNS.md cross-referenced directly) |

**Overall confidence:** MEDIUM-HIGH -- the four-feature build order and the "no new dependencies, extend existing patterns" thesis are strongly supported; the areas of genuine product ambiguity (cashout formula Option A vs B, exact option-count bounds) are explicitly flagged rather than silently resolved.

### Gaps to Address

- **Cashout formula (Option A vs Option B):** research recommends Option A (stake-proportional) as the safe default but this is a product decision, not purely technical -- confirm with the roadmap owner before Phase 2 planning locks it in.
- **Scheduler distributed-lock fix:** an existing, previously-flagged gap (no lock coordinating scheduler resolution with admin/manual actions) that this research treats as an in-scope blocker for Phase 2 -- confirm this is accepted into the milestone's scope rather than deferred, since it's technically pre-existing debt being pulled forward.
- **`locked_balance` column (existing, unused):** decide explicitly whether Phase 2's cashout quote step needs a hold/pending state (requiring `locked_balance` to finally be implemented) or can remain stateless (compute-and-confirm in one request) -- affects wallet-locking design.
- **Regulatory/responsible-gambling scope:** FEATURES.md flags that real-money betting platforms typically need responsible-gambling tooling (limits, self-exclusion) and PROJECT.md doesn't mention regulatory/licensing status -- out of scope for this milestone but worth raising with the project owner if ApostaE is headed to real-money production.
- **Test framework:** package.json currently has no test framework installed at all (a discrepancy from milestone context referencing Mocha+Chai/Sinon) -- must be resolved before the concurrency/attack-vector tests mandated by PITFALLS.md and requisitos.txt can be written.

## Sources

### Primary (HIGH confidence -- direct codebase inspection)
- `/srv/www/apostas/src/config/database.js`, `src/services/wagerService.js`, `src/services/marketService.js`, `src/repositories/walletRepository.js`, `src/migrations/001_initial.js`, `002_wallet.js`, `package.json`
- `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `.planning/codebase/CONCERNS.md`

### Secondary (MEDIUM confidence -- cross-verified web research)
- Cash-out mechanics: Betfair, bet365, FanDuel, William Hill, Bovada support docs; wizardslots.com, bet442.co.uk, bookmakers.bet, betcalcul.com, boydsbets.com
- Notification schema/pagination: oneuptime.com, dev.to (polliog), pedroalonso.net
- Ledger/partial-withdrawal patterns: formance.com, dashdevs.com, sdk.finance
- Domain events / architecture: khalilstemmler.com, dev.to (horse_patterns)
- Concurrency/locking: PostgreSQL official docs (Explicit Locking), nemanjatanaskovic.com, firehydrant.com

### Tertiary (LOW confidence -- single-source or needs validation)
- pg-listen as a future alternative to Redis pub/sub -- documented for future reference only, not needed this milestone
- Option B (probability-weighted cashout) formula shape -- explicitly flagged as needing product sign-off before use

---
*Research completed: 2026-07-13*
*Ready for roadmap: yes*
