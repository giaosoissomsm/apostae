# Phase 3: New Market Types - Research

**Researched:** 2026-07-14
**Domain:** Relational schema generalization (binary → N-outcome), server-side validation, IDOR-safe option scoping, generalized fixed-odds resolution/payout, admin+user frontend for dynamic option sets
**Confidence:** HIGH (schema/backend — grounded directly in this repo's own migrations/services/tests); MEDIUM (exact numeric bounds for option count/threshold — not specified anywhere in requirements, flagged as assumptions)

> No `03-CONTEXT.md` exists for this phase — the user explicitly skipped `/gsd-discuss-phase` for this milestone. This research is scoped entirely from `.planning/ROADMAP.md`'s Phase 3 section, `.planning/REQUIREMENTS.md` (MARKET-01..08), `.planning/STATE.md`, `requisitos.txt`, and `prompt.txt`. Where the requirements leave a design decision genuinely open (numeric bounds, repository file layout), this research makes a recommendation and flags it explicitly rather than presenting it as a locked decision — the planner/discuss-phase should treat those as needing confirmation.

## Summary

Phase 3 generalizes ApostaE's binary (Sim/Não) prediction-market schema to support two new fixed-odds market types — Over/Under (freely configurable numeric threshold) and multiple-choice (dynamic option count) — without breaking or rewriting the existing binary market. The current schema is binary-shaped at the database level, not just in application code: `markets.outcome`/`markets.scheduled_outcome` have `CHECK (... IN ('yes','no',NULL))`, `wagers.choice` is `NOT NULL CHECK (choice IN ('yes','no'))`, and `markets.odds_yes`/`markets.odds_no` are two fixed columns. None of this can represent a 3rd, 4th, or 5th outcome, or a per-market variable number of options — so **the only viable design is an additive schema migration**, not a "lighter extension." The recommended shape is a new `market_options` table (one row per selectable outcome, FK'd to `markets`), a `markets.market_type` discriminator (`'binary' | 'over_under' | 'multiple_choice'`, defaulting existing rows to `'binary'`), and a new nullable `wagers.option_id` FK alongside the now-nullable `wagers.choice`, with a DB-level XOR CHECK constraint enforcing exactly one of the two is populated per wager. This is a small, additive migration (005) — it touches zero existing rows' semantics and adds nothing that binary markets must read.

Critically, Phase 2's cashout/payout generalization work (`money.js`, the `remainingFraction`/`cashed_out_amount` payout-scaling fix in `resolveMarket`, and the CR-01/02/03 double-pay fixes in `cancelWager`/`deleteMarket`) is **already market-type-agnostic** — it operates on `wager.amount`, `wager.cashed_out_amount`, and `wager.potential_payout`, none of which reference `choice` or `odds_yes`/`odds_no` directly. The only place a binary assumption is hardcoded is the **win/loss determination** (`wager.choice === outcome` in `resolveMarket`'s loop) — this is a single boolean-swap generalization point, not a rewrite of the surrounding transaction/lock/payout/audit logic. The plan must resist the temptation to duplicate or restructure that loop; it should inject one `isWinner` predicate and leave everything below it (locking order, `money.js` calls, wallet audit, event emission) untouched, exactly matching the "additive-only" pattern Phase 1/2 already established via `domainEvents`.

The frontend is genuinely binary-hardcoded in multiple call sites (`m.odds_yes.toFixed(2)`, `w.choice === 'yes' ? 'Sim' : 'Não'`, two fixed odds buttons per market ticket) — these will visibly break (crash on `.toFixed()` of `undefined`, or silently render nothing) for any market with `market_type !== 'binary'` unless every render path branches on `market.market_type` first. MARKET-08 explicitly requires the admin panel to support creating the new types through the UI, so this phase has a real, non-trivial frontend surface; a `UI-SPEC.md` (via `/gsd-ui-phase`, already enabled in `.planning/config.json`'s `workflow.ui_phase: true`) is recommended before planning the frontend tasks.

**Primary recommendation:** Add migration `005_market_types.js` introducing `market_options` (FK'd, IDOR-scoped via `WHERE id = $1 AND market_id = $2`), `markets.market_type`/`markets.threshold`/`markets.winning_option_id`, and `wagers.option_id` (nullable, XOR with `choice`) — then generalize `marketService.createMarket`/`resolveMarket` and `wagerService.placeWager` with a single `market_type`-branch each, reusing every lock-order/transaction/audit/`money.js` pattern Phase 2 already proved, and reuse the exact ownership-in-WHERE IDOR pattern from `wagerRepository.findByIdForUpdate` for the new `market_options` lookups.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| MARKET-01 | Admin can create an Over/Under market with a freely configurable numeric threshold | `markets.threshold` column + `market_options` (2 rows, Over/Under labels) — see Migration 005, Open Question 2 for form-UX choice |
| MARKET-02 | Admin can create a multiple-choice market with a dynamic number of options, not capped at 3 | `market_options` table (N rows), server-side bound per MARKET-05/Pitfall 7/Assumption A1 |
| MARKET-03 | Existing binary Sim/Não markets continue to work unchanged | Migration 005 is purely additive (`DEFAULT 'binary'`, all binary columns/CHECKs untouched); Pattern 2 requires the binary branch of every generalized function to stay byte-identical to current behavior |
| MARKET-04 | All market-type and option validation happens server-side | `marketService.createMarket` branch-per-type validation (Architecture Patterns, System Diagram "ADMIN CREATES MARKET") — option count, threshold format, duplicate-label dedupe |
| MARKET-05 | Option/outcome count bounded server-side, UI limits not sufficient | Pitfall 7 + Assumption A1 — explicit server-side max-count check independent of any HTML form limit |
| MARKET-06 | Option IDs scoped to their parent market server-side (no IDOR) | Pattern 1 (`findByIdForMarket`, ownership-in-WHERE) applied at both wager placement and market resolution — Security Domain "Known Threat Patterns" |
| MARKET-07 | Payout/resolution logic generalized to N outcomes | Pattern 2 (single `isWinner` branch inside the unchanged Phase 2 payout loop) — Architecture Patterns "ADMIN RESOLVES MARKET" diagram section |
| MARKET-08 | Admin panel UI supports creating both new market types | Pitfall 4 (exact frontend call sites that must branch on `market_type`); Open Question 2 flags the Over/Under form-UX decision for `/gsd-ui-phase` |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Market/option schema (market_options, market_type, threshold) | Database / Storage | — | New relational structure; source of truth for N outcomes |
| Market-type & option validation (count, threshold format, duplicates) | API / Backend | — | `marketService.createMarket` — MARKET-04 requires server-side-only validation |
| Option-scoped IDOR guard (`option_id` must belong to `market_id`) | API / Backend | Database / Storage | Enforced in repository query WHERE clause + DB FK; MARKET-06 |
| N-outcome resolution/payout | API / Backend | — | `marketService.resolveMarket` — reuses Phase 2's already-generalized `money.js`/`cashed_out_amount` math, only the win-check branches |
| Admin market-creation UI (type selector, dynamic option rows) | Browser / Client | API / Backend (validation) | `public/admin.html` + `admin.js` — MARKET-08; client-side UI is convenience only, backend re-validates everything |
| User-facing wager placement UI (N option buttons instead of 2) | Browser / Client | API / Backend | `public/index.html` + `dashboard.js` — must render `market.options[]` dynamically |
| Scheduled auto-reveal (`scheduler.js`) | API / Backend | — | Stays binary-only this phase (see Pitfall 6) — no tier change needed, zero touch |
| Notification text for market resolution | API / Backend | — | `notificationService.js`'s `market.resolved` listener — needs option label, not raw id, for new types (see Pitfall 5) |

## Standard Stack

No new npm dependencies are required for this phase. All generalization is schema (PostgreSQL DDL) plus application code that reuses libraries already installed and already proven in Phase 1/2: `pg` (parameterized queries, transactions), the existing custom error classes (`src/utils/errors.js`), and `src/utils/money.js` (decimal-safe math, already market-type-agnostic).

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pg | ^8.11.3 (already installed) [VERIFIED: package.json] | Parameterized SQL, transactions, `FOR UPDATE` locking | Already the sole DB driver; no reason to introduce anything else for a schema-only generalization |

### Supporting
No new supporting libraries needed.

### Alternatives Considered
| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| `market_options` table (one row per outcome, FK'd) | JSONB `options` column on `markets` | Simpler schema, no join — but breaks MARKET-06 outright: a JSONB array has no queryable/lockable/FK-referenceable row id, so "an option ID can never reference a different market's option" cannot be enforced by the database at all, only by trusting application code to re-derive array indices correctly. Not recommended given the explicit requirement. |
| `wagers.option_id` (nullable FK) + `wagers.choice` (nullable) with a DB XOR CHECK | A single polymorphic `wagers.selection` VARCHAR column holding either `'yes'`/`'no'` or a stringified option id | Avoids one column — but loses FK referential integrity to `market_options` (an invalid/cross-market id could be stored and only caught by app logic, not the database), and forces type-coercion logic (`Number(selection)` vs string compare) scattered through every read site. Not recommended. |
| `markets.market_type` discriminator column | Infer type implicitly from whether `market_options` rows exist / whether `odds_yes` is null | Implicit typing is fragile: every future feature has to re-derive "what kind of market is this" from absence-of-data rather than reading one column, and it gets more error-prone as more types are added. One explicit column removes a whole bug class for negligible cost. |

**Installation:** No new packages — migration + application code only.

**Version verification:** N/A — no new package versions to verify.

## Package Legitimacy Audit

**Not applicable this phase.** No external packages are introduced — all work is schema (migration 005) and application code reusing already-installed dependencies (`pg`) and in-repo utilities (`money.js`, `errors.js`). No `package-legitimacy check` run was needed.

## Architecture Patterns

### System Architecture Diagram

```
ADMIN CREATES MARKET
  Admin panel form (market_type select: binary | over_under | multiple_choice)
        │  POST /api/markets  { question, market_type, odds_yes/odds_no  OR  threshold + options[] }
        ▼
  marketsController.createMarket → marketService.createMarket(body, adminId)
        │  branch on market_type:
        │    binary          → validate odds_yes/odds_no (unchanged, isValidOdds)
        │    over_under      → validate threshold (finite, >0) + exactly 2 options (Over/Under labels+odds)
        │    multiple_choice → validate 2..MAX options, dedupe labels, each odds in [1.01,1000]
        ▼
  transaction(client):  INSERT markets (market_type, threshold, …) → INSERT market_options[] (bulk, market_id FK)
        ▼
  DB: markets row + N market_options rows (0 for binary, 2 for over_under, N for multiple_choice)

USER VIEWS MARKETS
  GET /api/markets → marketRepository.findAll() → single query, LEFT JOIN market_options,
        json_agg per market (avoids N+1, per requisitos.txt "evitar consultas N+1")
        ▼
  dashboard.js renderMarkets() branches on market.market_type:
        binary          → existing 2-button Sim/Não ticket (UNCHANGED)
        over_under/mc   → N buttons rendered from market.options[]

USER PLACES WAGER
  POST /api/wagers { market_id, choice }         (binary, UNCHANGED)
  POST /api/wagers { market_id, option_id }      (new types)
        ▼
  wagerService.placeWager → transaction(client):
        lock market (existing marketRepository.findByIdForUpdate)
        branch on market.market_type:
          binary → choice must be 'yes'/'no', odds from market.odds_yes/odds_no (UNCHANGED)
          other  → option_id validated IDOR-safe (WHERE id=$1 AND market_id=$2), odds from market_options.odds
        INSERT wagers (choice=X, option_id=NULL)  OR  (choice=NULL, option_id=Y)   ← DB XOR CHECK enforces this
        wallet debit + audit (UNCHANGED, money.js)
        ▼
  domainEvents.emit('wager.placed', …)   ← UNCHANGED shape, unchanged chokepoint (NOTIF-09)

ADMIN RESOLVES MARKET
  PUT /api/markets/:id/resolve { outcome: 'yes'|'no' }              (binary, UNCHANGED)
  PUT /api/markets/:id/resolve { winning_option_id }                (new types)
        ▼
  marketService.resolveMarket → transaction(client):
        lock market FOR UPDATE (existing)
        branch on market.market_type:
          binary → markets.outcome = resolution (UNCHANGED marketRepository.resolve)
          other  → validate winning_option_id belongs to THIS market (IDOR, MARKET-06) →
                    markets.winning_option_id = X, markets.status='resolved'
        lock all pending wagers FOR UPDATE (existing wagerRepository.findPendingByMarket, UNCHANGED)
        for each wager:
          isWinner = binary ? (wager.choice === resolution) : (wager.option_id === winningOptionId)
                     ↑ THE ONLY GENERALIZATION POINT — everything below is UNCHANGED Phase 2 code:
          if isWinner: remainingFraction = (amount - cashed_out_amount) / amount
                       remainingPayout = money.multiply(potential_payout, remainingFraction)
                       wallet credit + audit (walletRepository, UNCHANGED)
          else:        wager → 'lost' (UNCHANGED)
        ▼
  domainEvents.emit('market.resolved', { outcome: <label, not raw id for new types> }, …)
        ▼
  notificationService (UNCHANGED chokepoint) → notifies every recipient
```

### Recommended Project Structure

No new top-level folders. Files touched/added:

```
src/
├── migrations/
│   └── 005_market_types.js          # NEW — market_options table + discriminator columns
├── repositories/
│   ├── marketRepository.js          # MODIFIED — findAll() gains options JOIN, create() accepts
│   │                                 #   market_type/threshold + optional client, resolve() gains
│   │                                 #   a sibling resolveWithOption() OR is generalized in-place
│   └── marketOptionRepository.js    # NEW (recommended) — findByMarketId, findByIdForMarket
│                                     #   (IDOR-safe), createMany (bulk insert inside a transaction)
├── services/
│   └── marketService.js             # MODIFIED — createMarket/resolveMarket branch on market_type
├── services/
│   └── wagerService.js              # MODIFIED — placeWager branches on market_type
├── controllers/
│   └── marketsController.js         # MODIFIED — pass through new body fields (still destructure-only,
│                                     #   never spread req.body — mass-assignment guard, MARKET-04)
public/
├── admin.html / admin.js            # MODIFIED — market_type selector, dynamic option rows, resolve
│                                     #   buttons generalized to N options
├── index.html / dashboard.js        # MODIFIED — N-option ticket rendering, option_id wager submit
```

**Repository layout note (Claude's discretion, no CONTEXT.md decision exists):** `market_options` is tightly coupled to `markets` (same lifecycle, same transaction on create, same lock ordering). The codebase's existing precedent for a tightly-coupled child table is `walletRepository.js`, which owns both `wallets` and `wallet_transactions` in one file. Either folding option methods into `marketRepository.js` directly, or a separate `marketOptionRepository.js`, is consistent with the codebase — this research recommends a **separate file** because `cashoutRepository.js` (Phase 2's precedent for a phase-scoped child table) was also split out, and because `marketRepository.js` is already the file every other market-touching module imports, so keeping option-CRUD separate reduces churn on a shared import surface. The planner should treat this as a free choice, not a locked requirement.

### Pattern 1: IDOR-safe option lookup (reuse `wagerRepository.findByIdForUpdate`'s shape)

**What:** Every server-side operation that receives an `option_id` from the client (wager placement, market resolution) must verify that option belongs to the specific `market_id` in play — never trust the pairing.
**When to use:** `wagerService.placeWager` (new-type branch), `marketService.resolveMarket` (new-type branch).
**Example (new repository method, same shape as `wagerRepository.findByIdForUpdate`, `02-RESEARCH.md` Pattern 1):**
```javascript
// Source: pattern extracted from src/repositories/wagerRepository.js:40-46 (Phase 2, already
// reviewed/shipped) — ownership baked into the WHERE clause, not checked after the fact.
async findByIdForMarket(id, marketId, client) {
  const runner = client || { query: require('../config/database').query };
  const result = await runner.query(
    'SELECT * FROM market_options WHERE id = $1 AND market_id = $2 FOR UPDATE;',
    [id, marketId]
  );
  return result.rows[0] || null;
}
```
Use this — not a bare `SELECT * FROM market_options WHERE id = $1`  — at every call site that receives a client-submitted `option_id`. This is the direct MARKET-06 implementation.

### Pattern 2: Single-branch generalization inside `resolveMarket`'s existing loop

**What:** Determine win/loss with one market-type-aware predicate; leave the payout math, locking, and audit logic exactly as Phase 2 shipped it.
**When to use:** `marketService.resolveMarket`.
**Example:**
```javascript
// Source: pattern generalized from src/services/marketService.js:130-169 (current, binary-only)
for (const wager of pendingWagers) {
  const isWinner = market.market_type === 'binary'
    ? wager.choice === resolution
    : wager.option_id === winningOptionId;

  if (isWinner) {
    await wagerRepository.updateStatus(wager.id, 'won', client);
    // UNCHANGED from here down — Phase 2's cashed_out_amount-aware payout scaling
    // (RESEARCH.md 02 Pitfall 2, already reviewed/fixed) applies identically
    // regardless of market type, because it only reads wager.amount/
    // cashed_out_amount/potential_payout, never wager.choice or market.odds_yes.
    const remainingFraction = (Number(wager.amount) - Number(wager.cashed_out_amount)) / Number(wager.amount);
    const remainingPayout = money.multiply(wager.potential_payout, remainingFraction);
    // ... wallet credit + recordTransaction, UNCHANGED ...
  } else {
    await wagerRepository.updateStatus(wager.id, 'lost', client);
    // UNCHANGED
  }
}
```

### Pattern 3: N+1-safe market listing with aggregated options

**What:** `GET /api/markets` must return each market's options without a per-market round-trip (requisitos.txt explicitly requires avoiding N+1 queries).
**When to use:** `marketRepository.findAll()`.
**Example:**
```sql
-- Source: pattern using Postgres json_agg + FILTER, standard technique for
-- one-query parent+children aggregation; no ORM in this codebase to do it for you.
SELECT m.*,
  COALESCE(
    json_agg(
      json_build_object('id', mo.id, 'label', mo.label, 'odds', mo.odds, 'sort_order', mo.sort_order)
      ORDER BY mo.sort_order
    ) FILTER (WHERE mo.id IS NOT NULL),
    '[]'
  ) AS options
FROM markets m
LEFT JOIN market_options mo ON mo.market_id = m.id
GROUP BY m.id
ORDER BY m.created_at DESC;
```
Binary markets get `options: []` (empty array, harmless) — the frontend must check `market.market_type === 'binary'` before ever reading `market.options`, not the other way around.

### Anti-Patterns to Avoid
- **Rewriting `resolveMarket`'s payout loop instead of branching the win-check:** Phase 2's review found 3 critical double-pay bugs (CR-01/02/03) from exactly this kind of scope creep — touching more of a financial function than strictly necessary. Change the `isWinner` determination only; do not restructure the transaction, lock order, or `money.js` calls below it.
- **Trusting `option_id` without a `market_id`-scoped WHERE clause:** a bare `SELECT * FROM market_options WHERE id = $1` is the exact IDOR MARKET-06 exists to prevent — always pair `id` with `market_id` in the same query, matching `wagerRepository.findByIdForUpdate`'s existing precedent.
- **Emitting a raw `option_id` (or unlabeled outcome) into `domainEvents.emit('market.resolved', …)`:** the existing `notificationService` listener interpolates `evt.outcome` directly into user-facing text (`resolvido com resultado "${evt.outcome}"`). For new types this must be the option's **label** ("Time A", "Over 2.5"), not a raw integer id.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Decimal-safe payout math for N-outcome resolution | A new money utility, or inline `Math.round(x*100)/100` | `src/utils/money.js` (`multiply`, `subtract`, `applyFeePercent` — already exists, already market-type-agnostic) | Phase 2 already fixed the IEEE-754 rounding edge case here; a second money utility would reintroduce the exact bug class `money.js` was built to eliminate. |
| Idempotent bulk-insert of options at market creation | A retry/catch-23505 idempotency dance (Phase 2's `cashoutRepository` pattern) | Plain synchronous application-level duplicate-label check (case-insensitive trim compare) before the INSERT, inside one `transaction()` | Options are created once, atomically, inside the same request that creates the market — there is no retry/replay surface here the way there is for `cashoutWager` (no client-submitted idempotency key, no concurrent-actor race). A DB `UNIQUE(market_id, label)` constraint as defense-in-depth is enough; a full idempotency-replay pattern is over-engineering for this write path. |
| Row locking / IDOR-safe ownership checks for the new `market_options` table | A new locking helper or ad-hoc post-lock ownership check | `wagerRepository.findByIdForUpdate`'s existing shape (`WHERE id = $1 AND market_id = $2 ... FOR UPDATE`) | Already reviewed and shipped in Phase 2 as the codebase's IDOR-mitigation convention (stronger than `cancelWager`'s older post-lock check pattern, which the codebase has since moved away from). |
| Admin-only authorization for market creation/resolution | A new permission/role check | Existing `requireAdmin` middleware (already gates `POST /api/markets`, `PUT /api/markets/:id/resolve`) | No new authz surface — the new market-type fields ride the same already-gated routes. |

**Key insight:** Every piece of Phase 3's financial-integrity risk surface (locking, audit trail, decimal math, idempotency) was already built and code-reviewed in Phase 1/2. The only genuinely new logic this phase introduces is (a) the schema to store N options and (b) the win-check branch. Treat everything else as reuse, not new design.

## Common Pitfalls

### Pitfall 1: Binary-only `CHECK` constraints will reject new market types at the database level, not just in application code
**What goes wrong:** `markets.outcome`/`markets.scheduled_outcome` (`CHECK (... IN ('yes','no',NULL))`) and `wagers.choice` (`NOT NULL CHECK (choice IN ('yes','no'))`) are enforced by Postgres itself. Any INSERT/UPDATE that doesn't fit will fail with a raw `23514` (check_violation) error, not a clean `ValidationError`.
**Why it happens:** The original schema (migration 001) was designed for exactly one binary market shape and never anticipated N outcomes.
**How to avoid:** Migration 005 must relax `wagers.choice` to nullable and add the new `option_id` column with a DB-level XOR `CHECK` (`(choice IS NOT NULL AND option_id IS NULL) OR (choice IS NULL AND option_id IS NOT NULL)`) as defense-in-depth — don't rely on application code alone to guarantee exactly one is set.
**Warning signs:** A `23514` or `23502` (not-null violation) surfacing as a raw 500 through `errorHandler.js`'s dead `err.code.startsWith('P')` branch (pre-existing bug, see `02-REVIEW.md` IN-01 — real Postgres SQLSTATEs never start with `P`) instead of a clean `ValidationError`.

### Pitfall 2: Duplicating or restructuring `resolveMarket`'s payout loop instead of branching the win-check
**What goes wrong:** Phase 2's code review (`02-REVIEW.md`) found 3 critical double-pay bugs (CR-01/CR-02/CR-03) precisely because touching "more of a financial function than strictly necessary" let a bug slip past manual review in `cancelWager`/`deleteMarket` even after the same bug class was fixed in `resolveMarket`.
**Why it happens:** N-outcome generalization looks like it needs a bigger rewrite of the resolution function, tempting a full restructure.
**How to avoid:** Change only the win/loss predicate (`wager.choice === outcome` → `isWinner(wager, resolution, market)`); leave the `remainingFraction`/`money.multiply`/wallet-audit code completely untouched, character-for-character.
**Warning signs:** A diff to `resolveMarket` that touches lines outside the win-check condition and the resolve-write (`marketRepository.resolve` vs new option-based write) — that's a signal the change has grown beyond the generalization point.

### Pitfall 3: Missing IDOR scoping on `option_id` at either wager placement or market resolution
**What goes wrong:** A user submits `option_id` from Market A while wagering on Market B; or an admin resolves Market A with a `winning_option_id` that actually belongs to Market B. Without a `market_id`-scoped WHERE, both succeed silently, corrupting payout logic.
**Why it happens:** It's easy to validate "does this option_id exist" and forget "does it belong to *this* market."
**How to avoid:** Every `market_options` lookup driven by client input uses `WHERE id = $1 AND market_id = $2` (Pattern 1 above) — never a bare `WHERE id = $1`. This is the direct implementation of MARKET-06.
**Warning signs:** A repository method named `findById` (not `findByIdForMarket`) being called with a client-submitted id in a security-sensitive path.

### Pitfall 4: Frontend hardcodes 'Sim'/'Não' and two fixed odds fields in multiple render paths — will crash or blank-render for new market types
**What goes wrong:** `public/js/admin.js`'s `loadMarkets()` does `m.odds_yes.toFixed(2)}x / ${m.odds_no.toFixed(2)}x` unconditionally — `.toFixed()` on `undefined` throws for any market without those columns populated. `public/js/dashboard.js`'s `ticketTemplate()` renders exactly 2 hardcoded odd-buttons (`data-choice="yes"`/`"no"`); `loadMyWagers()` and `showUserWagers()` both do `w.choice === 'yes' ? 'Sim' : 'Não'` on every row.
**Why it happens:** The entire frontend was written before any market type but binary existed; nothing about the current code anticipates a discriminator.
**How to avoid:** Every one of these four call sites must branch on `market.market_type` (or, for wager rows, on whether `w.option_id`/`w.option_label` is present) before rendering odds/choice — MARKET-08 explicitly requires the admin UI to functionally support the new types, not just the API.
**Warning signs:** `NaN`, blank cells, or a thrown `TypeError` in the browser console when a non-binary market is listed.

### Pitfall 5: Emitting a raw `option_id` (or a changed string) into the existing `market.resolved` domain event breaks/degrades an unrelated feature (notifications)
**What goes wrong:** `notificationService.js`'s `market.resolved` listener interpolates `evt.outcome` directly into user-facing notification text. If `resolveMarket` starts passing a raw integer `option_id` for new types, the notification reads like `resolvido com resultado "14"` — meaningless to the user.
**Why it happens:** The event payload's `outcome` field was always a display-ready value ('yes'/'no') for binary; nothing forces the new code to resolve a label before emitting.
**How to avoid:** For non-binary types, resolve the winning option's `label` (already fetched by the IDOR-safe lookup in Pattern 1) before building the event payload, and pass that string as `outcome`. For binary, keep emitting the exact same raw value as today (don't "improve" it to a Portuguese label in the same change — that would be an unrequested behavior change to an already-shipped, already-reviewed event shape).
**Warning signs:** A notification body containing a bare number instead of a market-relevant label.

### Pitfall 6: Scheduler auto-reveal (`scheduler.js` / `scheduled_outcome`) is binary-only — must be scoped, not silently broken or silently extended
**What goes wrong:** `scheduler.js`'s `tick()` calls `marketService.resolveMarket(m.id, m.scheduled_outcome)` for any market matching `findDueToReveal()` (`WHERE scheduled_outcome IS NOT NULL`). Nothing in MARKET-01..08 requires scheduled auto-reveal for the new types.
**Why it happens:** It's tempting to either (a) accidentally let a non-binary market's `scheduled_outcome` column exist and get misread as a `winning_option_id`, or (b) feel obligated to build scheduling support for the new types that wasn't asked for.
**How to avoid:** Do not add a `scheduled_outcome`-equivalent column for `over_under`/`multiple_choice` markets this phase. The admin creation form for new types should not expose scheduling fields. `findDueToReveal()`'s existing query (`scheduled_outcome IS NOT NULL`) will then naturally never match a new-type market (since that column stays `NULL` for them), requiring **zero changes to `scheduler.js`**. New market types are admin-resolved manually only, this milestone — confirmed safe by re-reading the actual query, not just assumed.
**Warning signs:** Any code path in migration 005 or `marketService.createMarket` that writes a non-null `scheduled_outcome` for a non-binary market.

### Pitfall 7: Unbounded option count is a DoS vector even though the requirement explicitly forbids capping at 3
**What goes wrong:** `prompt.txt`'s "não limitar a apenas três alternativas" (don't cap at 3) does not mean *unlimited* — MARKET-05 explicitly requires the count be "bounded server-side to prevent unbounded-list DoS," and separately warns "UI limits alone are not sufficient."
**Why it happens:** Reading "don't cap at 3" as "no cap at all" is an easy misinterpretation.
**How to avoid:** Pick a generous-but-finite server-side maximum (this research does not have a number from the requirements — flagged as Assumption A1 below) and enforce it in `marketService.createMarket` before any DB write, independent of whatever the admin form's UI happens to allow.
**Warning signs:** A market-creation request with hundreds/thousands of options succeeding, or the only limit being a `<select>` element's option count in the HTML.

## Code Examples

### Migration 005 — additive schema (verified against migrations 001-004's exact style/conventions)
```javascript
// Source: pattern matches src/migrations/004_cashout.js's module shape exactly
// (id, up: array of SQL strings, down: reverse-order array)
const migrations = [
  // Discriminador de tipo de mercado. Mercados existentes recebem 'binary'
  // via DEFAULT — nenhum backfill necessário, migração puramente aditiva (MARKET-03).
  `ALTER TABLE markets ADD COLUMN IF NOT EXISTS market_type VARCHAR(20) NOT NULL DEFAULT 'binary'
     CHECK (market_type IN ('binary', 'over_under', 'multiple_choice'));`,

  // Limite livre do admin para mercados Over/Under (MARKET-01). NULL pros outros tipos.
  `ALTER TABLE markets ADD COLUMN IF NOT EXISTS threshold NUMERIC(10, 2);`,

  // Opções selecionáveis — uma linha por alternativa. odds usa a mesma faixa de
  // isValidOdds() (1.01-1000) já aplicada a odds_yes/odds_no.
  `CREATE TABLE IF NOT EXISTS market_options (
    id SERIAL PRIMARY KEY,
    market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    label VARCHAR(200) NOT NULL,
    odds NUMERIC(10, 2) NOT NULL CHECK (odds >= 1.01 AND odds <= 1000),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (market_id, label)
  );
  CREATE INDEX IF NOT EXISTS idx_market_options_market_id ON market_options(market_id);`,

  // Resultado vencedor pra mercados N-outcome. NULL pra binary (que continua
  // usando markets.outcome, intocado).
  `ALTER TABLE markets ADD COLUMN IF NOT EXISTS winning_option_id INTEGER REFERENCES market_options(id);`,

  // Cada aposta referencia OU choice (binary) OU option_id (novos tipos), nunca os dois.
  `ALTER TABLE wagers ALTER COLUMN choice DROP NOT NULL;`,
  `ALTER TABLE wagers ADD COLUMN IF NOT EXISTS option_id INTEGER REFERENCES market_options(id);`,
  `ALTER TABLE wagers ADD CONSTRAINT wagers_choice_xor_option CHECK (
     (choice IS NOT NULL AND option_id IS NULL) OR (choice IS NULL AND option_id IS NOT NULL)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_wagers_option_id ON wagers(option_id);`,
];

module.exports = {
  id: '005_market_types',
  up: migrations,
  down: [
    // NOTE: lossy for any row that used option_id (choice cannot be recovered) —
    // acceptable per this codebase's existing down-migration convention
    // (002_wallet.js's down also doesn't attempt to preserve data).
    'ALTER TABLE wagers DROP CONSTRAINT IF EXISTS wagers_choice_xor_option;',
    'ALTER TABLE wagers DROP COLUMN IF EXISTS option_id;',
    'ALTER TABLE wagers ALTER COLUMN choice SET NOT NULL;',
    'ALTER TABLE markets DROP COLUMN IF EXISTS winning_option_id;',
    'DROP TABLE IF EXISTS market_options;',
    'ALTER TABLE markets DROP COLUMN IF EXISTS threshold;',
    'ALTER TABLE markets DROP COLUMN IF EXISTS market_type;',
  ],
};
```

### `wagerService.placeWager` generalization (branch point only — rest unchanged)
```javascript
// Source: generalized from src/services/wagerService.js:15-63 (current, binary-only)
const market = await marketRepository.findByIdForUpdate(marketId, client); // reuse Phase 2 helper
// ... existing status/closes_at checks, UNCHANGED ...

let odds, chosenChoice = null, chosenOptionId = null;
if (market.market_type === 'binary') {
  if (choice !== 'yes' && choice !== 'no') throw new ValidationError("choice precisa ser 'yes' ou 'no'.");
  odds = choice === 'yes' ? Number(market.odds_yes) : Number(market.odds_no);
  chosenChoice = choice;
} else {
  const optionId = Number(option_id);
  if (!Number.isFinite(optionId)) throw new ValidationError('option_id inválido.');
  const option = await marketOptionRepository.findByIdForMarket(optionId, marketId, client); // Pattern 1
  if (!option) throw new ValidationError('Opção inválida para esse mercado.');
  odds = Number(option.odds);
  chosenOptionId = optionId;
}
const potentialPayout = money.multiply(wagerAmount, odds); // money.js — also fixes the pre-existing
                                                             // raw Math.round anti-pattern at this line
```

### Existing `wagerRepository`'s `SELECT_WITH_MARKET` extended for option display
```sql
-- Source: extends src/repositories/wagerRepository.js:3-9 (current)
SELECT w.id, w.user_id, w.market_id, w.choice, w.option_id, w.amount, w.odds_at_time, w.potential_payout,
       w.status, w.created_at, w.resolved_at,
       m.question, m.status AS market_status, m.outcome AS market_outcome, m.market_type,
       mo.label AS option_label
FROM wagers w
JOIN markets m ON m.id = w.market_id
LEFT JOIN market_options mo ON mo.id = w.option_id
```

## Runtime State Inventory

Not applicable — this is a greenfield/additive schema phase (new tables/columns), not a rename, rebrand, or string-migration phase. No existing runtime state (Redis keys, external service config, OS-registered tasks, secrets) references anything being renamed. `market_type` for all pre-existing rows defaults to `'binary'` via the migration's `DEFAULT`, which is a data-shape backfill handled entirely by the migration itself, not a separate runtime-state concern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Server-side max option count recommended at a generous-but-finite bound (e.g. 20) — no exact number is given anywhere in REQUIREMENTS.md/ROADMAP.md/requisitos.txt/prompt.txt, only "don't cap at 3" and "must be bounded" | Common Pitfalls (Pitfall 7), MARKET-05 | If the planner picks a bound that's too low, a legitimate real-world multiple-choice market (e.g., a large tournament bracket) could be rejected; too high and the DoS protection is weaker. Low risk either way since any finite bound satisfies MARKET-05 literally — but the exact number should be confirmed with the user before being treated as final. |
| A2 | Multiple-choice markets require a minimum of 2 options (not 3) — inferred from "não limitar a apenas três," which forbids a *cap* at 3 but says nothing about a *floor* | Architecture Patterns (creation validation) | If the real intent was "multiple-choice must have 3+ distinct from binary's 2," a 2-option multiple-choice market would be indistinguishable from a binary market by option count alone — low functional risk since `market_type` still discriminates it correctly, but worth confirming UX intent. |
| A3 | Over/Under threshold validation requires only `Number.isFinite(threshold) && threshold > 0` — no enforcement that it end in `.5` (the convention that avoids exact-tie pushes in the prompt.txt examples, 2.5/3.5) is treated as a UX nicety, not a hard requirement, since requisitos.txt never mandates it | Common Pitfalls / Standard Stack | If an admin creates "Over 3" (a whole number), a tied outcome (exactly 3) is ambiguous under a fixed-odds Over/Under model — this is a real product-logic gap, not just a formatting one. Recommend the planner add a discretionary `.5`-suffix validation, or explicitly defer tie-handling as an admin's responsibility (out of this phase's scope per "Pari-mutuel"/scope notes in REQUIREMENTS.md). |
| A4 | Repository file layout: separate `marketOptionRepository.js` (vs. folding into `marketRepository.js`) — no existing convention definitively settles this, reasoned by analogy to `cashoutRepository.js` | Recommended Project Structure | Low risk — either choice is internally consistent with the codebase; picking wrong only costs a later refactor, not a functional bug. |

**None of these are financial-integrity, security, or concurrency assumptions** — all of Phase 2's proven money/locking/audit patterns are reused verbatim, not re-derived. The assumptions above are strictly UX/bound-tuning decisions.

## Open Questions

1. **Exact numeric bound for max options per market (MARKET-05)**
   - What we know: Must be bounded server-side; UI limits alone are insufficient; must not cap at 3 (the old binary-adjacent ceiling).
   - What's unclear: The exact number.
   - Recommendation: Planner/discuss-phase should confirm with the user; absent a stated preference, default to something like 20 — generous enough for the "Qual será o primeiro gol?" 5-option example plus real headroom, small enough to bound worst-case row/JSON-payload size trivially.

2. **Does Over/Under need its own admin form fields (2 fixed odds inputs, like odds_yes/odds_no) or the same freeform "N labeled options" UI as multiple-choice?**
   - What we know: Over/Under is conceptually always exactly 2 outcomes (Over X / Under X) with admin-set odds each — structurally identical to binary's odds_yes/odds_no pair, just with a threshold and different labels.
   - What's unclear: Whether treating Over/Under as "multiple_choice with exactly 2 auto-labeled options" is simpler to build than a 3rd bespoke form, or whether a dedicated 2-input form (mirroring the existing binary form almost exactly) gives a better admin UX.
   - Recommendation: This is a genuine UI-SPEC decision — flag for `/gsd-ui-phase` rather than deciding unilaterally here. Both are compatible with the `market_options` schema underneath.

3. **Should `wagerService.placeWager`'s pre-existing `Math.round(wagerAmount * odds * 100) / 100` (line 42, the exact anti-pattern `money.js`'s own header comment calls out) be swapped for `money.multiply()` while this function is being touched anyway for the market_type branch?**
   - What we know: `money.js`'s own documentation comment explicitly names this line as "the anti-pattern this file replaces" — it was left untouched in Phase 2 because Phase 2 didn't need to modify `placeWager`.
   - What's unclear: Whether fixing it now is in-scope "while you're here" cleanup or unwanted scope creep for a market-types phase.
   - Recommendation: Low-risk, purely additive-quality fix (same output for all binary cases, since `money.multiply` is designed to reduce to the same rounding behavior) — recommend doing it since `placeWager` must be touched anyway for the market_type branch either way, but flag it as an explicit, isolated line-level change in the plan so a reviewer can verify it's not entangled with the market-type logic.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v22.23.1 [VERIFIED: `node --version`] | — |
| npm | Package management | ✓ | 10.9.8 [VERIFIED: `npm --version`] | — |
| PostgreSQL (live instance) | Migration 005 execution + all integration tests | ✗ in this sandbox | — | Same carried-forward blocker as Phase 1/2 (STATE.md): no `*test*`-named Postgres database is reachable from this environment (`pg_hba`/proxy rejects everything but the `apostae` dev/prod DB). Migration 005 and all new integration-style tests must be structurally correct (load, run up to `assertTestDatabase()`) and verified against real Postgres by a human/CI environment, exactly as Phase 2's `02-REVIEW-FIX.md` documents for CR-01/02/03. |
| Redis | Session/cache (unrelated to this phase's writes, but `requireAuth` depends on it for every request) | Not probed (`redis-cli` not installed in sandbox) | — | No fallback needed — this phase does not touch Redis-backed functionality; Redis availability is an existing infra concern, not new to Phase 3. |
| Jest | Test execution | ✓ (devDependency, already installed) | ^30.4.2 [VERIFIED: package.json] | — |

**Missing dependencies with no fallback:**
- Live Postgres test database — blocks *execution* of new integration tests in this sandbox, but does not block writing correct migration/test code (same situation Phase 2 shipped through, with the caveat that Phase 2's un-executed tests found real bugs in code review — the human/CI verification step is not optional).

**Missing dependencies with fallback:**
- None beyond the above — Redis is out of this phase's write path entirely.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest ^30.4.2 [VERIFIED: package.json] |
| Config file | `jest.config.js` (repo root) — `testMatch: ['**/tests/**/*.test.js']`, `testEnvironment: 'node'` |
| Quick run command | `npx jest tests/markets.<name>.test.js` |
| Full suite command | `npm test` (== `jest --runInBand`, serialized because integration tests share one Postgres test DB — see `tests/helpers/testDb.js`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MARKET-01 | Admin creates Over/Under market with freeform threshold | integration | `npx jest tests/markets.creation.test.js -x` | ❌ Wave 0 |
| MARKET-02 | Admin creates multiple-choice market, dynamic option count | integration | `npx jest tests/markets.creation.test.js -x` | ❌ Wave 0 |
| MARKET-03 | Existing binary markets unaffected (regression) | integration | `npx jest tests/markets.creation.test.js -x` (binary case) + rerun Phase 2's existing `tests/cashout.*.test.js` unmodified | ❌ Wave 0 (new file); Phase 2 files already exist |
| MARKET-04 | Server-side validation (count/threshold/duplicates) rejects bad input | unit + integration | `npx jest tests/markets.validation.test.js -x` | ❌ Wave 0 |
| MARKET-05 | Option count bounded server-side regardless of UI | integration | `npx jest tests/markets.validation.test.js -x` (over-max-options case) | ❌ Wave 0 |
| MARKET-06 | option_id cannot cross-reference another market's option (IDOR) | integration | `npx jest tests/markets.idor.test.js -x` | ❌ Wave 0 |
| MARKET-07 | N-outcome resolution pays out correctly for all 3 market types | integration | `npx jest tests/markets.resolution.test.js -x` | ❌ Wave 0 |
| MARKET-08 | Admin panel UI creates both new types | manual-only (justification: no browser-automation framework in this repo — Jest is Node-only, no Playwright/Cypress present) | N/A — human verification via `checkpoint:human-verify` | N/A |

### Sampling Rate
- **Per task commit:** relevant single test file (`npx jest tests/markets.<name>.test.js`)
- **Per wave merge:** `npm test` (full suite, includes Phase 1/2 regression coverage)
- **Phase gate:** Full suite green (against real Postgres, not mocks — per Phase 2's own review lesson) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/markets.creation.test.js` — covers MARKET-01, MARKET-02, MARKET-03
- [ ] `tests/markets.validation.test.js` — covers MARKET-04, MARKET-05
- [ ] `tests/markets.idor.test.js` — covers MARKET-06
- [ ] `tests/markets.resolution.test.js` — covers MARKET-07 (all 3 market types, plus a cashed-out-then-resolved regression reusing Phase 2's `seedWager({ cashedOutAmount })` pattern to confirm the payout-scaling fix still holds under the new branch)
- [ ] `tests/helpers/testDb.js` extension: `applyMarketTypesMigration()` (mirrors `applyCashoutMigration()`), `seedMarketOptions(marketId, options[])`, extend `seedOpenMarket()` to accept `marketType`/`threshold`, extend `seedWager()` to accept `optionId`
- [ ] Framework install: none — Jest already present

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | no | No new auth surface this phase |
| V3 Session Management | no | No new session surface this phase |
| V4 Access Control | yes | `requireAdmin` (existing, unchanged) gates market creation/resolution; new IDOR-scoped `market_options` lookups (Pattern 1) gate option/market pairing — MARKET-06 |
| V5 Input Validation | yes | Server-side-only validation of `market_type` enum, option count bound, duplicate-label rejection, threshold numeric bound, odds range reuse of existing `isValidOdds()` — MARKET-04 |
| V6 Cryptography | no | Not applicable — no new secrets/crypto this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| IDOR via mismatched `option_id`/`market_id` pairing | Tampering / Information Disclosure | `WHERE id = $1 AND market_id = $2` ownership-in-query pattern (Pattern 1), applied at both wager placement and market resolution |
| Mass assignment (client submitting `market_type`, `winning_option_id`, or `odds` fields it shouldn't control on a wager/resolve request) | Tampering | Controllers destructure only expected fields from `req.body` (existing convention, e.g. `wagersController.cashoutWager`'s `{ amount, idempotency_key }` destructure) — never spread `req.body` into a repository call |
| Unbounded option array → resource exhaustion | Denial of Service | Server-side max-option-count check in `marketService.createMarket`, independent of any client-side UI cap (MARKET-05) |
| SQL injection via option labels / dynamic bulk insert | Injection | Parameterized multi-row `INSERT ... VALUES ($1,$2),($3,$4),...` (never string-concatenated labels) — same convention already used throughout the codebase |
| Race condition: concurrent market resolution vs. concurrent wager placement on a market mid-resolve | Race Condition | Reuse the existing fixed lock order (market `FOR UPDATE` locked before any wager/option read), matching `resolveMarket`'s current, already-reviewed locking sequence — no new race surface introduced as long as the win-check branch is inserted inside the existing lock scope, not outside it |

## Sources

### Primary (HIGH confidence)
- `src/migrations/001_initial.js`, `002_wallet.js`, `003_notifications.js`, `004_cashout.js` — full current schema, read directly [VERIFIED: repo source]
- `src/services/marketService.js`, `src/services/wagerService.js` — full current business logic, read directly [VERIFIED: repo source]
- `src/repositories/marketRepository.js`, `wagerRepository.js`, `walletRepository.js` — full current data access, read directly [VERIFIED: repo source]
- `src/controllers/marketsController.js`, `wagersController.js`, `src/routes/markets.js`, `wagers.js`, `src/scheduler.js` — full current API surface, read directly [VERIFIED: repo source]
- `public/admin.html`, `public/js/admin.js`, `public/index.html`, `public/js/dashboard.js` — full current frontend, read directly [VERIFIED: repo source]
- `.planning/phases/02-partial-cashout/02-REVIEW.md`, `02-REVIEW-FIX.md`, `02-PATTERNS.md` — Phase 2's shipped patterns and the 3 critical double-pay bugs found/fixed, read directly [VERIFIED: repo source]
- `requisitos.txt`, `prompt.txt` — source requirements (Section 3, "Novos tipos de mercado" / "Over/Under" + "Múltipla escolha") [VERIFIED: repo source]
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` — MARKET-01..08, Phase 3 goal/success criteria, carried-forward blockers [VERIFIED: repo source]
- `tests/helpers/testDb.js` — existing test-DB helper conventions to extend [VERIFIED: repo source]
- `jest.config.js`, `package.json` — test framework/dependency versions [VERIFIED: repo source]

### Secondary (MEDIUM confidence)
None — no external web sources were needed for this phase; the entire design is grounded in this repo's own existing, already-reviewed code.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, zero ambiguity
- Architecture (schema/backend generalization): HIGH — directly grounded in reading every relevant existing file, not inferred
- Architecture (exact numeric bounds, Over/Under form UX): MEDIUM — genuinely unspecified by requirements, flagged as Assumptions/Open Questions rather than asserted
- Pitfalls: HIGH — every pitfall traces to either a real existing code line (frontend hardcoding, CHECK constraints) or a documented Phase 2 review finding (double-pay bug class)

**Research date:** 2026-07-14
**Valid until:** No external dependency — valid until the underlying source files change (i.e., effectively until this phase is planned/executed, since this research reads the codebase's current committed+uncommitted state directly)
