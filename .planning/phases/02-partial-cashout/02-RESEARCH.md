# Phase 2: Partial Cashout - Research

**Researched:** 2026-07-14
**Domain:** PostgreSQL transactional money-movement (row-locking, decimal-safe arithmetic, idempotent financial writes) inside an existing Express/Controller-Service-Repository app
**Confidence:** HIGH (grounded almost entirely in the actual working-tree source, not external docs — this is an internal-consistency problem, not a new-framework problem)

## Summary

Partial Cashout is not a new subsystem — it is a fourth financial state-machine transition (alongside `placeWager`, `cancelWager`, `resolveMarket`) that must reuse the exact transactional, lock-then-revalidate, emit-after-commit shape already proven by `wagerService.js`/`marketService.js` in this codebase, and the exact chokepoint-emission shape already proven by Phase 1's `domainEvents`/`notificationService`. The hard part is not "how do I write a cashout endpoint" — it is three specific, codebase-grounded correctness risks this research identifies directly from reading the current source:

1. **A real, pre-existing lock-ordering deadlock class.** `cancelWager()` locks `wagers` FOR UPDATE **then** `markets` FOR UPDATE (wager→market). `resolveMarket()`/`deleteMarket()` lock `markets` FOR UPDATE **then** `wagers` FOR UPDATE via `findPendingByMarket` (market→wager). Two transactions taking opposite lock orders on the same two rows is a textbook deadlock (Postgres error `40P01`, auto-aborts one side). This is almost certainly the "pre-existing, undocumented scheduler race" flagged in STATE.md. Cashout is a **third** actor into this same lock graph and must pick a side — this research recommends **market→wager→wallet** (matching `resolveMarket`/`deleteMarket`/`placeWager`, i.e. 3 of the 4 existing flows), which also means cashout is safe against `resolveMarket` but remains theoretically deadlock-prone against `cancelWager`'s outlier ordering (pre-existing risk, not fully closable without touching `cancelWager`, which is Phase 4's job).
2. **A schema gap.** `wagers.amount`/`odds_at_time`/`potential_payout` are documented in CLAUDE.md as *immutable once created*. Partial cashout cannot mutate them — it needs a new cumulative-tracking column (`cashed_out_amount`) plus a new append-only `wager_cashouts` table, and **`marketService.resolveMarket()`'s existing payout line must change** to pay out only the *remaining* (post-cashout) stake, not the full `potential_payout`. This is a required edit to already-shipped, security-reviewed financial code — the planner must scope it explicitly, not treat cashout as purely additive.
3. **An idempotency-key collision with Phase 1's existing UNIQUE constraint.** `notifications` has `UNIQUE(user_id, type, related_entity, related_id)`. A wager can be cashed out more than once (partial, repeated). If a new `wager.cashed_out` listener reuses `related_id = wagerId` (like the other 7 events do), the second cashout's notification silently no-ops via the existing `23505`-catch idempotency logic — a real notification-loss bug, not a hypothetical one. `related_id` must be the new cashout row's own id.

No new runtime infrastructure is needed (no Redis locks, no advisory locks, no message queue) — PostgreSQL row-level `SELECT ... FOR UPDATE` inside `transaction()` is sufficient and is what every existing financial flow in this codebase already uses.

**Primary recommendation:** Add migration `004_cashout.js` (new `wager_cashouts` table + `wagers.cashed_out_amount` column), a new `cashoutRepository.js`/extend `wagerRepository.js` with `findByIdForUpdate`, a new `cashoutService.js` (or a `cashoutWager()` method added to `wagerService.js` — see Architecture Patterns) that locks **market → wager → wallet** in that order inside one `transaction()`, computes the payout using a new shared `src/utils/money.js` (integer-cents-safe, zero new dependencies), writes the `wager_cashouts` row + `wallet_transactions` row, and emits `wager.cashed_out` (with `relatedId = cashout.id`) after commit. Update `marketService.resolveMarket()`'s payout calculation to scale by remaining stake.

## User Constraints

No CONTEXT.md exists for this phase — user explicitly opted to skip `/gsd-discuss-phase`. The constraints below are therefore sourced from ROADMAP.md, REQUIREMENTS.md, STATE.md, PROJECT.md, and CLAUDE.md (all binding), not from a discussion transcript.

### Locked Decisions (from PROJECT.md Key Decisions / REQUIREMENTS.md, confirmed by project owner)

- Cashout formula is **stake-proportional** (`stake × odds_at_time × fraction`, minus fee) — NOT probability-weighted/live-odds — explicitly confirmed by the project owner in PROJECT.md because ApostaE has no live-odds feed to ground a "fair value" formula. Do not propose a probability-weighted alternative.
- Only **partial** cashout is in scope. Full (100%) cashout is explicitly deferred to v2 (`CASHOUT-V2-01`, Out of Scope table). A wager's remaining stake must never be allowed to reach exactly zero via cashout in this milestone.
- Build order is strictly sequential: Notifications (done) → **Partial Cashout** → New Market Types → Cancellation v2. Phase 2 must not implement or assume Phase 3's generalized market-type schema, but must not hardcode `choice IN ('yes','no')` anywhere in new cashout code either (CASHOUT-09).
- Every money-touching operation must run inside a PostgreSQL transaction with a corresponding audit/movement record (requisitos.txt, CLAUDE.md Constraints) — non-negotiable, applies to cashout exactly as it applied to Phase 1's wager/market flows.
- Architecture must follow the existing Controller/Service/Repository layering (CLAUDE.md).

### Claude's Discretion (no explicit user decision found — this research makes a concrete recommendation for each, flagged `[ASSUMED]`)

- Exact platform fee percentage for cashout (never specified anywhere in prompt.txt/REQUIREMENTS.md/PROJECT.md — unlike Cancellation's explicit 5%).
- Exact minimum cashout amount (CASHOUT-04 requires *a* minimum but never states the value).
- Whether "cashout quote" (CASHOUT-01 wording) means a separate quote-then-confirm two-step flow, or a single endpoint that computes-and-executes atomically.
- Idempotency-key transport (request header vs. body field) and storage shape.
- Whether to introduce `decimal.js` as a new production dependency, or implement `src/utils/money.js` as an integer-cents utility with zero new dependencies.
- Exact wording/placement of `cashed_out_amount <= amount` guard (must remaining stake stay strictly `> 0`, or is a small minimum-remaining-stake floor also required).

### Deferred Ideas (OUT OF SCOPE — do not implement)

- Full (100%) cashout (`CASHOUT-V2-01`) — v2.
- Live-odds/"fair value" cashout pricing — explicitly rejected by the project owner; stake-proportional only.
- Any change to existing binary Sim/Não market *resolution semantics* beyond the payout-scaling edit required by cashout itself.
- Real-time push delivery of the `wager.cashed_out` notification (no WebSocket/SSE exists; Phase 1 structure-only pattern continues).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CASHOUT-01 | User can request a cashout quote for part of an open, pending wager's value | Single-endpoint compute-and-execute design (Architecture Patterns); no live-odds staleness risk since `odds_at_time` is fixed at wager placement, so a separate quote step adds no safety value — flagged `[ASSUMED]`, confirm with user before/при planning if a strict two-step UX is actually wanted. |
| CASHOUT-02 | Cashout value computed backend-only via stake × odds_at_time × fraction, minus fee — never from frontend | `src/utils/money.js` + `cashoutService` design (Architecture Patterns, Code Examples); request body carries only the *stake amount to cash out* (untrusted input, validated), never a payout number. |
| CASHOUT-03 | Remaining stake stays active, still eligible for resolution/payout | New `wagers.cashed_out_amount` column (Common Pitfall 2) + required edit to `marketService.resolveMarket()`'s payout line (Architecture Patterns). |
| CASHOUT-04 | Minimum cashout amount enforced | `CASHOUT_MIN_AMOUNT` env var, `[ASSUMED]` default — see Assumptions Log A2. |
| CASHOUT-05 | Rejected once market closed or wager resolved | Same lock-then-revalidate pattern as `placeWager`/`cancelWager` — re-check `market.status === 'open'` and `wager.status === 'pending'` *after* acquiring locks, not before (Common Pitfall 1, Code Examples). |
| CASHOUT-06 | Concurrent cashouts on same wager cannot both succeed | Market→wager→wallet lock ordering (Common Pitfall 1); `SELECT ... FOR UPDATE` reused exactly as `placeWager`/`resolveMarket` already do. |
| CASHOUT-07 | Idempotent retries (same idempotency key) never double-apply | `UNIQUE(wager_id, idempotency_key)` on `wager_cashouts` + `23505`-catch-and-return-existing pattern, same shape as Phase 1's `notificationService.notify()` (Architecture Patterns, Don't Hand-Roll). |
| CASHOUT-08 | Every cashout produces a wallet_transaction + audit log entry; no direct balance mutation | Reuse `walletRepository.adjustBalance` + `walletRepository.recordTransaction` exactly as the other 4 financial flows do; `type: 'credit'`, `relatedEntity: 'cashout'` (Architecture Patterns). |
| CASHOUT-09 | Market-type-agnostic (works off wager+odds_at_time+market status, not binary-hardcoded) | Cashout logic never reads/filters on `choice` — validated against current schema (Common Pitfall 5). |
| CASHOUT-10 | Shared decimal-safe money math, no float drift across repeated cashouts | `src/utils/money.js` — see Standard Stack / Don't Hand-Roll; current codebase already does raw `Math.round(x*100)/100` float math (`wagerService.js:38`), which is the anti-pattern CASHOUT-10 exists specifically to avoid repeating. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cashout value computation (stake × odds × fraction − fee) | API/Backend (service layer) | — | Must never trust client-submitted values; pure server-side arithmetic (CASHOUT-02) |
| Row locking / concurrency control | Database (PostgreSQL row locks via `FOR UPDATE`) | API/Backend (transaction orchestration) | Postgres already serializes concurrent writers on the same row; no need for an app-level (Redis) lock given the existing proven pattern |
| Wallet balance mutation + audit trail | Database / API-Backend | — | Must go through `walletRepository.adjustBalance` + `recordTransaction` inside the same transaction — never a bare `UPDATE wallets` |
| Idempotency enforcement | Database (UNIQUE constraint) | API/Backend (23505 catch + replay-existing-result) | Matches Phase 1's `notifications` idempotency precedent exactly |
| Cashout-confirmed notification | API/Backend (domainEvents emit) | — | Reuses Phase 1's chokepoint (`notificationService.register()`); no new transport |
| Cashout request UI affordance | Browser/Client (`public/js/dashboard.js`) | — | Not UI-hinted for this phase (`ui_hint` absent in ROADMAP.md Phase 2, present only for Phase 3) — minimal hook only, not a design focus this phase |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| decimal.js | 10.6.0 | Decimal-safe money arithmetic for the cashout value formula (CASHOUT-10) | Industry-standard arbitrary-precision decimal library; 11+ years old (created 2014), 65.6M downloads/week `[VERIFIED: npm registry]`, maintained by the same author as `bignumber.js`, zero dependencies, no `postinstall` script `[VERIFIED: npm view]` |

**Alternative (zero-new-dependency path — recommended if Phase 1's supply-chain-gate precedent should hold for this phase too):** implement `src/utils/money.js` using integer-cents arithmetic (`Math.round(amount * 100)` → integer math → `/100`). This avoids any new dependency entirely. For this codebase's actual math (multiply by odds, subtract a percentage fee, all rounding to 2 decimal places, `NUMERIC(12,2)` columns) integer-cents arithmetic is exactly as correct as `decimal.js` and has been the standard fixed-point-money technique for decades — it is *not* "hand-rolling a decimal library," it's the well-known simpler case decimal libraries exist to generalize away from. Given Phase 1 gated even a **devDependency** (`jest`) behind a blocking `checkpoint:human-verify`, a new **production** dependency for money math should get the same treatment if `decimal.js` is chosen.

**Recommendation: prescriptively pick one.** This research recommends the zero-dependency `src/utils/money.js` (integer-cents) **specifically because** CASHOUT-10's requirement is "a shared decimal-safe utility" (singular, internal, reusable) — not "adopt a third-party decimal library." It satisfies the requirement with no new supply-chain surface and no checkpoint needed. If the planner/user prefers `decimal.js` instead, gate its install behind a `checkpoint:human-verify` task per Phase 1 Plan 01's precedent.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pg (already installed) | ^8.11.3 | `SELECT ... FOR UPDATE` row locking inside `transaction()` | Every cashout write (already the app-wide pattern) |
| Node core `crypto` or existing `uuid` (^9.0.1, already installed) | — | Optional server-generated fallback idempotency key if client omits one | Only if the design allows an idempotency key to be optional |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Postgres row-level `FOR UPDATE` locking | Redis `SET NX` distributed lock | CONCERNS.md's own "Fix approach" for the scheduler race suggests Redis locking, but that's solving a *different* problem (cross-process/cross-instance locks for a single-node app that doesn't have one yet). This app is single-process Node with one Postgres connection pool; row locks inside `transaction()` are sufficient, already proven at 4 call sites, and adding Redis locking here would be unjustified complexity per requisitos.txt's "não criar código duplicado" / avoid overengineering guidance. |
| Server-generated `wager_cashouts` table | Reusing `wallet_transactions.related_id` alone (no new table) | `wallet_transactions` has no room for `stake_cashed_out`/`gross_value`/`fee_amount`/`idempotency_key` without schema changes to a shared, heavily-used table; a dedicated `wager_cashouts` table isolates the new columns and gives CASHOUT-07's idempotency constraint a clean home. |
| `src/utils/money.js` (integer-cents) | `decimal.js` | See Standard Stack above — both are valid; integer-cents avoids a new dependency. |

**Installation (only if decimal.js is chosen):**
```bash
npm install decimal.js
```

**Version verification:** `npm view decimal.js version` → `10.6.0`, published lineage back to 2014, 53 published versions, `git+https://github.com/MikeMcl/decimal.js.git` `[VERIFIED: npm registry, checked 2026-07-14]`.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| decimal.js | npm | 11+ years (created 2014-04-02) | 65,621,118 / week (last-week window, checked 2026-07-14) | github.com/MikeMcl/decimal.js | OK | Conditionally approved — only if the planner chooses the third-party-dependency path over the zero-dependency `src/utils/money.js` recommendation above. Gate the actual `npm install` behind a `checkpoint:human-verify` task (Phase 1 precedent). |

**Note on verdict provenance:** the `gsd-tools query package-legitimacy check` seam returned `SUS` for this package (`unknown-age`, `unknown-downloads`, `no-repository`) because that tool call had no network access in this environment. This research independently verified age/downloads/repo directly via `npm view decimal.js` and the public `api.npmjs.org/downloads` endpoint (both succeeded), which is why the disposition above is `OK` rather than `SUS` — the seam's inconclusive result is a network-access artifact of this sandbox, not a signal about the package itself. Ecosystem-specific registry check confirmed: `npm` (correct ecosystem — this is a Node.js phase, no cross-ecosystem risk).

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** decimal.js is flagged `SUS` by the automated seam only due to a sandbox network-access limitation, not a legitimacy concern — see note above. Treat as `OK` per the direct registry verification performed in this session, but still gate the install behind a checkpoint per the general "new production dependency" precedent this project has already established (Phase 1 Plan 01, Task 1).

## Architecture Patterns

### System Architecture Diagram

```
User (dashboard.js)
   │  POST /api/wagers/:id/cashout
   │  body: { amount, idempotency_key }         <- untrusted input: only a STAKE
   ▼                                                 amount + a client-chosen key,
requireAuth (middleware/auth.js)                     NEVER a payout value
   │  attaches req.user.id (never trust body userId)
   ▼
wagersController.cashoutWager (new)
   │  Number() coercion, delegates to service
   ▼
wagerService.cashoutWager(wagerId, userId, {amount, idempotencyKey})   [service layer]
   │
   ├─ transaction(async (client) => {                [config/database.js transaction()]
   │     1. SELECT market_id FROM wagers WHERE id=$1        (unlocked peek, just to find market)
   │     2. SELECT * FROM markets WHERE id=$1 FOR UPDATE    (LOCK ORDER: market first)
   │        └─ re-validate market.status === 'open'
   │     3. SELECT * FROM wagers WHERE id=$1
   │          AND market_id=$2 AND user_id=$3 FOR UPDATE    (LOCK ORDER: wager second)
   │        └─ re-validate wager.status === 'pending'
   │        └─ re-validate cashed_out_amount + requested <= amount (leaves remainder > 0)
   │     4. money.js: gross = stake * odds_at_time
   │                   fee   = gross * feePercent
   │                   net   = gross - fee
   │        └─ re-validate net >= CASHOUT_MIN_AMOUNT
   │     5. INSERT wager_cashouts (..., idempotency_key)    <- UNIQUE(wager_id, idempotency_key)
   │        └─ ON 23505: SELECT existing row, short-circuit as idempotent replay
   │     6. UPDATE wagers SET cashed_out_amount = cashed_out_amount + stake
   │     7. walletRepository.findByUserIdForUpdate(userId, client)  (LOCK ORDER: wallet third)
   │     8. walletRepository.adjustBalance(+net)
   │     9. walletRepository.recordTransaction({ type:'credit', relatedEntity:'cashout',
   │                                             relatedId: cashout.id })   [CASHOUT-08]
   │     return { cashout, wagerQuestion, ... }
   │  })
   │
   ▼ (strictly AFTER the transaction promise resolves — never inside the closure)
domainEvents.emit('wager.cashed_out', { cashoutId, wagerId, userId, ... })
   │
   ▼
notificationService (Phase 1 chokepoint, register() extended with one more .on(...))
   │  notify(userId, { type:'wager.cashed_out', relatedEntity:'cashout', relatedId: cashoutId })
   ▼                                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
notifications table (Postgres)                              MUST be cashoutId not wagerId —
                                                              see Common Pitfall 3
```

**Later, asynchronously (scheduler or admin action), racing the above:**
```
scheduler.js tick() [every 10s]           admin action (marketsController)
   │                                          │
   ├─ marketService.closeMarket(id)          ├─ marketService.resolveMarket(id, outcome)
   │  (single UPDATE, no explicit lock,      │  (transaction: market FOR UPDATE, THEN
   │   but Postgres row-locks the UPDATE     │   wagers FOR UPDATE via findPendingByMarket
   │   statement itself — blocks/serializes  │   — SAME market→wager order as cashout,
   │   against any FOR UPDATE holder)        │   so no deadlock; but resolveMarket's
   │                                          │   payout math MUST be updated to account
   │                                          │   for cashed_out_amount — see Common
   │                                          │   Pitfall 2)
```

### Recommended Project Structure
```
src/
├── migrations/
│   └── 004_cashout.js          # wager_cashouts table + wagers.cashed_out_amount column
├── utils/
│   └── money.js                 # NEW: shared decimal-safe money helpers (CASHOUT-10)
├── repositories/
│   ├── wagerRepository.js       # MODIFIED: add findByIdForUpdate(id, client)
│   ├── marketRepository.js      # MODIFIED: add findByIdForUpdate(id, client) — DRY the
│   │                             #   inline `SELECT * FROM markets WHERE id=$1 FOR UPDATE`
│   │                             #   currently duplicated in placeWager/cancelWager/
│   │                             #   resolveMarket/deleteMarket (requisitos.txt: no duplicated code)
│   └── cashoutRepository.js     # NEW: wager_cashouts CRUD (create w/ 23505 handling, findByIdempotencyKey)
├── services/
│   ├── wagerService.js          # MODIFIED: add cashoutWager() method (same file as placeWager/
│   │                             #   cancelWager — closest analog, same class, same imports)
│   ├── marketService.js         # MODIFIED: resolveMarket() payout line must use remaining stake
│   └── notificationService.js   # MODIFIED: register() gains one more domainEvents.on('wager.cashed_out', ...)
├── controllers/
│   └── wagersController.js      # MODIFIED: add cashoutWager handler
└── routes/
    └── wagers.js                 # MODIFIED: POST /:id/cashout, requireAuth
```

### Pattern 1: Lock-then-revalidate, market→wager→wallet ordering

**What:** Acquire `SELECT ... FOR UPDATE` locks in a fixed global order across every financial flow that can touch the same rows, then re-check all business invariants *after* the locks are held (never before — a pre-lock read can be stale by the time the lock is acquired).

**When to use:** Every cashout write. This is the direct continuation of the pattern `placeWager`/`resolveMarket`/`deleteMarket` already use (see `src/services/wagerService.js` lines 23-59, `src/services/marketService.js` lines 116-162, 197-234, all read this session).

**Example (grounded in the actual current `cancelWager` shape, adapted to the correct lock order):**
```javascript
// Source: pattern synthesized from src/services/wagerService.js (existing placeWager/
// cancelWager) and src/services/marketService.js (existing resolveMarket), both read
// in full this session — see Common Pitfall 1 for why the order below (market before
// wager) matters and differs from cancelWager's existing order.
async cashoutWager(wagerId, userId, { amount, idempotencyKey }) {
  const requestedStake = Number(amount);
  if (!Number.isFinite(requestedStake) || requestedStake <= 0) {
    throw new ValidationError('Valor do cashout precisa ser maior que zero.');
  }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new ValidationError('idempotency_key é obrigatório.');
  }

  const result = await transaction(async (client) => {
    // Peek (unlocked) just to find which market to lock — market_id never changes
    // on an existing wager row, so this is safe, not a TOCTOU risk.
    const peek = await client.query('SELECT market_id FROM wagers WHERE id = $1;', [wagerId]);
    if (!peek.rows[0]) throw new NotFoundError('Aposta não encontrada.');

    // LOCK ORDER: market FIRST (matches resolveMarket/deleteMarket/placeWager — see
    // Common Pitfall 1 for why this must not be reversed).
    const marketResult = await client.query(
      'SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [peek.rows[0].market_id]
    );
    const market = marketResult.rows[0];
    if (!market || market.status !== 'open') {
      throw new ConflictError('Cashout indisponível: o mercado não está mais aberto.');
    }

    // LOCK ORDER: wager SECOND. Ownership + market_id baked into WHERE (IDOR-safe,
    // matches Phase 1 Pattern 4's ownership-in-WHERE convention).
    const wagerResult = await client.query(
      `SELECT * FROM wagers WHERE id = $1 AND market_id = $2 AND user_id = $3 FOR UPDATE;`,
      [wagerId, market.id, userId]
    );
    const wager = wagerResult.rows[0];
    if (!wager) throw new NotFoundError('Aposta não encontrada.');
    if (wager.status !== 'pending') {
      throw new ConflictError('Cashout indisponível: essa aposta já foi resolvida.');
    }

    const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);
    if (requestedStake >= remainingStake) {
      // Never allow remaining to reach zero this milestone (full cashout is v2-only).
      throw new ValidationError('Valor excede o saldo apostável restante para cashout parcial.');
    }

    // ... money.js computation, wager_cashouts INSERT (idempotency), wagers UPDATE,
    // LOCK ORDER: wallet THIRD via walletRepository.findByUserIdForUpdate(userId, client),
    // wallet_transactions INSERT — all unchanged from existing placeWager/resolveMarket shape.
  });

  domainEvents.emit('wager.cashed_out', { /* ...captured inside closure, emitted after commit... */ });
  return result;
}
```

### Pattern 2: Idempotency via UNIQUE constraint + 23505 replay (not no-op)

**What:** Unlike Phase 1's notification idempotency (which treats a duplicate as a silent no-op, since notifications have no caller-visible return value that matters), cashout idempotency must **return the same successful result** on a retried request — the caller needs the payout amount back.

**Example:**
```javascript
// Source: adapted from src/services/notificationService.js notify()'s existing
// 23505-catch pattern (read in full this session), which currently no-ops on
// conflict. Cashout needs a variant that replays the prior result instead.
try {
  const cashout = await cashoutRepository.create({ wagerId, userId, stakeCashedOut, grossValue, feeAmount, netValue, idempotencyKey }, client);
  return cashout;
} catch (err) {
  if (err.code === '23505') {
    // Same wager_id + idempotency_key already succeeded — return that result,
    // do NOT re-apply the wallet credit or the wagers.cashed_out_amount increment.
    const existing = await cashoutRepository.findByIdempotencyKey(wagerId, idempotencyKey, client);
    return existing; // caller sees the same response as the original request
  }
  throw err;
}
```
Note: this INSERT-then-catch-23505 check happens *before* the wallet/`wagers` mutations in the transaction body, so a duplicate request never reaches the balance-mutating statements at all (the whole transaction rolls back to nothing new having happened, then the idempotent replay path returns the prior committed row read fresh in a new statement).

### Anti-Patterns to Avoid

- **Reversing the lock order (wager before market):** matches `cancelWager`'s existing (buggy) order — do not copy that specific ordering, even though `cancelWager` is otherwise a reasonable analog for "cancel a wager owned by the caller."
- **Mutating `wagers.amount`/`odds_at_time`/`potential_payout` directly:** CLAUDE.md documents these as immutable once created. Use the new `cashed_out_amount` column instead.
- **Computing the payout on the client and sending it in the request body:** the request body may carry the *stake amount to cash out* (untrusted, validated server-side against `remainingStake`), never a computed monetary value.
- **Reusing `related_id = wagerId` for the `wager.cashed_out` notification:** collides with the existing `UNIQUE(user_id, type, related_entity, related_id)` constraint on the second cashout of the same wager — see Common Pitfall 3.
- **Emitting `domainEvents.emit(...)` inside the `transaction()` closure:** established D-01 pattern from Phase 1 — a rollback must never leave a "phantom" emitted event.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Row-level concurrency control | A custom mutex/semaphore, or a new Redis-based distributed lock | `SELECT ... FOR UPDATE` inside `transaction()` (already proven at 4 call sites) | Postgres already gives exactly the serialization guarantee needed; a new locking primitive would be untested, duplicated infrastructure for a single-Postgres-instance app |
| Idempotent retry semantics | An in-memory Map of "recently seen keys" or a Redis SETNX-with-TTL scheme | A UNIQUE constraint (`wager_id`, `idempotency_key`) + `23505` catch | Survives process restarts, matches the exact idempotency pattern Phase 1 already established for notifications, requires zero new infra |
| Fixed-point money arithmetic | Ad-hoc `Math.round(x * 100) / 100` scattered per call site (the current `wagerService.js:38` pattern) | One shared `src/utils/money.js` (or `decimal.js`, see Standard Stack) | CASHOUT-10 explicitly exists because scattered float rounding drifts across *repeated* operations (multiple partial cashouts compounding); a single shared utility is the whole point of the requirement |
| Deadlock avoidance | A custom "try-lock-with-timeout-and-retry" wrapper | Fixed, documented lock ordering (market→wager→wallet) across every financial flow | Postgres already detects and reports deadlocks (`40P01`); the fix is ordering discipline, not a retry framework — a retry wrapper would mask the real bug (inconsistent ordering) rather than fix it |

**Key insight:** every piece of cashout infrastructure this phase needs (transactions, row locks, idempotency-via-constraint, audit trail, event emission) already exists in this codebase as a proven pattern from `placeWager`/`cancelWager`/`resolveMarket`/`deleteMarket`/`notificationService`. The work is disciplined reuse and one schema addition, not new infrastructure.

## Common Pitfalls

### Pitfall 1: Lock-ordering deadlock between cashout, cancelWager, and resolveMarket
**What goes wrong:** Two concurrent transactions lock the same two rows (`markets`, `wagers`) in opposite order → Postgres deadlock detector aborts one transaction with error `40P01` under real concurrent load (exactly the scenario requisitos.txt mandates testing: "dois cashouts ao mesmo tempo... alteração simultânea do mesmo mercado").
**Why it happens:** `cancelWager()` (`src/services/wagerService.js` lines 78-92, read this session) locks `wagers` first, then `markets`. `resolveMarket()`/`deleteMarket()` (`src/services/marketService.js`, read this session) lock `markets` first, then `wagers` (via `wagerRepository.findPendingByMarket`, which itself uses `FOR UPDATE` — confirmed at `src/repositories/wagerRepository.js` line 30). This inconsistency already exists in the shipped codebase before this phase.
**How to avoid:** New cashout code must lock **market before wager** (matching the majority pattern: `placeWager`, `resolveMarket`, `deleteMarket`). Document (do not silently fix) that `cancelWager`'s opposite order remains a residual deadlock risk between cancel and cashout/resolve until Phase 4 replaces `cancelWager` entirely (CANCEL-08 already mandates replacing it in place).
**Warning signs:** Intermittent `error: deadlock detected` (Postgres code `40P01`) under concurrent test load; would show up specifically in the CASHOUT-06/07 concurrency test if it exercises cashout-vs-cancel or cashout-vs-resolve concurrently (not just cashout-vs-cashout).

### Pitfall 2: `resolveMarket()`'s payout line ignores prior cashouts unless explicitly updated
**What goes wrong:** `marketService.resolveMarket()` currently pays `wager.potential_payout` in full on a win (`src/services/marketService.js` line 135, read this session), regardless of any prior partial cashout. If not updated, a user could cash out 80% of a wager and *still* receive the full original payout on resolution — a direct double-pay financial bug.
**Why it happens:** `resolveMarket()` predates this phase and has no concept of `cashed_out_amount`.
**How to avoid:** The remaining-stake fraction is `(wager.amount - wager.cashed_out_amount) / wager.amount`; remaining payout = `wager.potential_payout * remainingFraction` (computed via the same `money.js` utility, not raw float math). This is a mandatory edit to already-reviewed financial code, not new code — flag it explicitly as a task in the plan, with its own verification (a wager with a prior cashout resolving to the correct scaled payout).
**Warning signs:** Any test that resolves a wager with `cashed_out_amount > 0` and asserts the full original `potential_payout` was paid (that would currently pass against unmodified code and must be treated as a regression test that should *fail* until the fix lands).

### Pitfall 3: Notification idempotency-constraint collision on repeated cashouts
**What goes wrong:** If the new `wager.cashed_out` event listener in `notificationService.register()` reuses `relatedId: wagerId` (copying the shape of the other 7 events verbatim), a **second** cashout on the same wager silently produces no notification — it collides with the existing `UNIQUE(user_id, type, related_entity, related_id)` constraint and gets swallowed by the existing `23505`-catch-as-no-op logic (`src/services/notificationService.js` lines 27-36, read this session).
**Why it happens:** The other 7 catalog events (`wager.placed`, `wager.won`, etc.) each happen at most once per wager, so `relatedId: wagerId` is a safe idempotency key for them. Cashout can legitimately happen multiple times on the same wager (partial, repeated) — `wagerId` alone is not a unique-enough key for this event.
**How to avoid:** Use `relatedEntity: 'cashout'`, `relatedId: <the new wager_cashouts row's own id>` (globally unique per cashout event) — not `relatedId: wagerId`.
**Warning signs:** A test asserting "second cashout on the same wager produces a second notification row" — this would fail silently (no error thrown, just a missing row) if the wrong `relatedId` is used, since the whole point of the existing idempotency-catch is to swallow the conflict quietly.

### Pitfall 4: `wallet_transactions.type` has a CHECK constraint — do not try to add a `'cashout'` type value
**What goes wrong:** `wallet_transactions.type` has `CHECK (type IN ('credit', 'debit', 'refund', 'correction'))` (`src/migrations/002_wallet.js` line 23, read this session). Altering this CHECK constraint on a live, already-used-in-production table is unnecessary schema churn.
**Why it happens:** It might seem natural to want a `'cashout'` type value for clarity.
**How to avoid:** Reuse `type: 'credit'` (money flowing into the wallet, same as a market-resolution win payout already does) and disambiguate via the free-text `related_entity: 'cashout'` column, which has no CHECK constraint — this exactly matches the existing convention where `related_entity` already distinguishes `'wager'`, `'market_resolved'`, `'admin_adjustment'` under the same `type` values.
**Warning signs:** A migration that does `ALTER TABLE wallet_transactions DROP CONSTRAINT ... ADD CONSTRAINT ... CHECK (type IN (..., 'cashout'))` — unnecessary and touches a shared table other flows depend on.

### Pitfall 5: Accidentally hardcoding binary-market assumptions into cashout code
**What goes wrong:** CASHOUT-09 requires cashout logic to be market-type-agnostic ahead of Phase 3's Over/Under and multiple-choice markets. It would be easy to accidentally add a stray `wager.choice IN ('yes','no')` filter somewhere (e.g., copy-pasting from `resolveMarket`'s per-wager loop, which does branch on `choice`).
**Why it happens:** Every existing analog method (`placeWager`, `resolveMarket`) does reference `choice`, because they need it for payout-branch logic. Cashout does not need `choice` at all — the cashout value formula only needs `amount`, `odds_at_time`, `cashed_out_amount`, and `market.status`/`wager.status`.
**How to avoid:** Never `SELECT`/filter on `wagers.choice` anywhere in cashout code; confirm this with a grep gate in the plan's acceptance criteria (e.g., `grep -c "choice" src/services/wagerService.js`'s cashout-related lines should be 0, or scoped to only the pre-existing `placeWager`/`cancelWager` methods).
**Warning signs:** Any cashout SQL or JS conditional referencing `'yes'`/`'no'` literals.

## Code Examples

### `src/utils/money.js` — zero-dependency decimal-safe helper (CASHOUT-10)
```javascript
// Source: synthesized pattern (no direct codebase analog exists yet — this is the
// first shared money-math utility in the project; see Don't Hand-Roll). Uses
// integer-cents arithmetic to avoid float drift, matching the NUMERIC(12,2)
// precision already used by every money column in this schema.
function toCents(amount) {
  return Math.round(Number(amount) * 100);
}
function fromCents(cents) {
  return cents / 100;
}
// stake * odds, rounded to 2 decimals, computed in integer space
function multiply(amount, factor) {
  return fromCents(Math.round(toCents(amount) * factor));
}
function subtract(a, b) {
  return fromCents(toCents(a) - toCents(b));
}
function applyFeePercent(amount, feePercent) {
  const fee = fromCents(Math.round(toCents(amount) * (feePercent / 100)));
  return { fee, net: subtract(amount, fee) };
}
module.exports = { toCents, fromCents, multiply, subtract, applyFeePercent };
```

### Notification listener addition (extends the existing chokepoint, does not replace it)
```javascript
// Source: added inside notificationService.js's existing register() function
// (src/services/notificationService.js, read this session) — same shape as the
// 7 existing domainEvents.on(...) registrations, per Pattern D-06 ("additive,
// no fixed switch statement").
domainEvents.on('wager.cashed_out', safeHandler(async (evt) => {
  await notify(evt.userId, {
    type: 'wager.cashed_out',
    title: 'Cashout realizado',
    body: `Você sacou R$${evt.netValue.toFixed(2)} da sua aposta em "${evt.question}". O restante continua ativo.`,
    relatedEntity: 'cashout',     // NOT 'wager' — see Common Pitfall 3
    relatedId: evt.cashoutId,     // NOT evt.wagerId — see Common Pitfall 3
  });
}));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `Math.round(x * 100) / 100` inline float rounding (`wagerService.js:38`, the only existing money-math site in the codebase) | Shared `src/utils/money.js` integer-cents utility, reused by every new cashout computation | This phase (CASHOUT-10) | Prevents drift across *repeated* partial cashouts on the same wager, which the single-shot existing float rounding was never exercised against |
| Inline, duplicated `SELECT ... FOR UPDATE` raw SQL at each of 4 existing call sites | (Recommended, not required) `marketRepository.findByIdForUpdate` / `wagerRepository.findByIdForUpdate` helper methods, reused by cashout and future refactors | This phase (optional DRY improvement, requisitos.txt "não criar código duplicado") | Reduces duplicated lock SQL from 5 call sites (4 existing + 1 new) down to reusable repository methods |

**Deprecated/outdated:** none — this is additive to an actively-maintained pattern, not a replacement of an outdated one.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Cashout fee percentage is not specified anywhere in the source materials; recommend a `CASHOUT_FEE_PERCENT` env var (mirroring `env.js`'s existing `BCRYPT_ROUNDS`/`SESSION_TIMEOUT` pattern) with a placeholder default that must be confirmed before implementation | Standard Stack, Architecture Patterns | If the real intended fee differs, the value returned to users would be wrong from day one — this is a financial-correctness assumption, must be confirmed with the user/planner before coding, not silently defaulted |
| A2 | Minimum cashout amount is not specified anywhere; recommend a `CASHOUT_MIN_AMOUNT` env var (default placeholder, e.g. R$1.00) | Phase Requirements (CASHOUT-04) | Too-low a minimum allows dust cashouts (spammy audit trail); too-high blocks legitimate small cashouts — needs product confirmation |
| A3 | CASHOUT-01's "request a cashout quote" is interpreted as a single endpoint that computes-and-executes atomically (no separate quote-then-confirm step), because `odds_at_time` is immutable/pre-locked (no live-odds staleness risk exists in this app to justify a two-step UX) | Architecture Patterns, Phase Requirements | If the user actually wants a genuine preview-before-commit UX (e.g., show the computed value, require a second confirming tap), this is a different (larger) API surface — two endpoints instead of one — and should be confirmed before planning locks the single-endpoint design |
| A4 | Idempotency key is transported as a body field `idempotency_key` (snake_case, matching existing body-field conventions like `market_id`), not an HTTP header | Architecture Patterns | Low risk either way — purely a naming/transport choice, easy to change later without touching the transactional logic |
| A5 | `decimal.js` vs. zero-dependency `src/utils/money.js`: this research recommends the zero-dependency path as the primary recommendation | Standard Stack | If the planner/user actually wants `decimal.js` for its broader guarantees (or future multi-currency support), the install needs its own `checkpoint:human-verify` task per Phase 1 precedent — not a blocking risk, just a process step that must not be skipped |
| A6 | A cashout must leave the wager's remaining stake strictly `> 0` (cannot reduce it to exactly zero via one or more partial cashouts) — enforced as `requestedStake < remainingStake` (strict), not `<=` | Architecture Patterns (Pattern 1), Phase Requirements (CASHOUT-03/CASHOUT-04) | If the real intent allows cashing out down to a nonzero-but-tiny remainder, this is fine as written; if the intent is that partial cashouts should also respect the same `CASHOUT_MIN_AMOUNT` floor on the *remaining* stake (not just the requested amount), that's an additional validation rule not yet specified anywhere — flag for confirmation |

**If this table is empty:** N/A — six assumptions listed above; all are business-rule/config gaps in the source materials, not technical-approach uncertainty (the technical approach itself is HIGH confidence, grounded in existing shipped code).

## Open Questions

1. **What is the actual cashout fee percentage?**
   - What we know: The formula explicitly includes "minus fee" (REQUIREMENTS.md CASHOUT-02); Cancellation's fee is explicitly 5% (CANCEL-02), but no cashout-specific number exists anywhere in prompt.txt, REQUIREMENTS.md, PROJECT.md, or STATE.md.
   - What's unclear: Whether it should mirror the 5% cancellation fee, be lower (cashout keeps the wager partially active, arguably a lighter-touch operation than full cancellation), or be admin-configurable via the existing (currently unused) `settings` table.
   - Recommendation: Surface this explicitly at planning time as a required user decision before implementation — do not let the planner silently pick a number. A `CASHOUT_FEE_PERCENT` env var is the right *mechanism* (matches existing config conventions) regardless of what value is chosen.

2. **What is the actual minimum cashout amount?**
   - What we know: CASHOUT-04 requires *a* minimum; no value given anywhere.
   - What's unclear: Whether it should be a fixed currency amount (e.g., R$1.00) or a percentage-of-original-stake floor (e.g., can't cash out less than 5% of the original wager).
   - Recommendation: Fixed currency-amount env var (`CASHOUT_MIN_AMOUNT`) is simpler and matches this codebase's existing config style; confirm the actual number with the user.

3. **Does the "cashout-available" event mentioned in the Phase 2 description (ROADMAP.md: "reuses the notification chokepoint to emit a cashout-available/cashout-confirmed event") need a distinct trigger separate from the cashout-completion event this research designs?**
   - What we know: ApostaE has no live-odds/in-play feed; a wager is cashable-out at any moment the market is `open` and the wager is `pending` — there is no distinct state transition that makes cashout "become available" the way `market.closed`/`market.resolved` are real, admin/scheduler-triggered transitions.
   - What's unclear: Whether "cashout-available" was meant literally (a separate notification the moment a wager becomes eligible — which would fire immediately at wager placement and thus be redundant with `wager.placed`) or was just loose phrasing for "the cashout feature, once built, needs a notification" (i.e., only `cashout-confirmed`/`wager.cashed_out` matters).
   - Recommendation: This research recommends emitting only `wager.cashed_out` (cashout-confirmed) — treat "cashout-available" as referring to the feature existing at all (satisfied by `wager.placed` already telling the user their wager exists and is thus cashable), not a distinct new event. Flag for confirmation if the planner disagrees.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL (dev/prod `apostae` db) | All cashout persistence | ✓ (confirmed live connection this session) | Not queried directly this session (schema confirmed via migrations 001/002/003) | — |
| PostgreSQL dedicated `*test*`-named database | CASHOUT-06/07's required concurrency test (Jest, `Promise.all` simultaneous requests) | ✗ (carried forward from Phase 1 — `pg_hba.conf`/proxy on the DB host only allows database name `apostae` from this host; confirmed again by Phase 1 Plans 02-04's SUMMARY.md Issues Encountered sections) | — | None currently — this blocks *live* execution of the concurrency test the same way it blocked Phase 1's five notification test files. The test should still be **written** (ready to run) per Phase 1's established compensating pattern (source-level/grep gates + a temporary mock-backed dry run, deleted before commit) |
| Redis | Not required by cashout itself (no session/cache use in this feature) | ✓ (confirmed reachable this session) | — | — |
| decimal.js (if chosen over `money.js`) | Money math | Not installed (would need `npm install`) | 10.6.0 latest, verified this session | `src/utils/money.js` zero-dependency alternative (recommended) |

**Missing dependencies with no fallback:**
- A reachable `*test*`-named Postgres database for live concurrency-test execution. This is an infrastructure/network constraint outside application code (same conclusion Phase 1 reached four times). The planner should treat CASHOUT-06/07's concurrency test as "written and ready, needs live-DB execution once infra access is resolved" — the same compensating verification approach (grep/AST gates + temporary mock-backed dry run) Phase 1 used throughout should be expected here too, and should be explicitly scoped into the plan rather than assumed away.

**Missing dependencies with fallback:**
- `decimal.js` — zero-dependency `src/utils/money.js` fallback is the primary recommendation anyway (see Standard Stack).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest ^30.4.2 (already installed as devDependency, Phase 1) |
| Config file | `jest.config.js` (`testEnvironment: 'node'`, `testMatch: ['**/tests/**/*.test.js']`) |
| Quick run command | `npx jest tests/cashout.*.test.js` |
| Full suite command | `npm test` (`jest --runInBand`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CASHOUT-01/02 | Cashout value computed server-side, formula-correct, client-submitted value ignored | unit + integration | `npx jest tests/cashout.computation.test.js` | ❌ Wave 0 |
| CASHOUT-03 | Remaining stake stays active; `resolveMarket` pays only the remaining fraction after a prior cashout | integration | `npx jest tests/cashout.resolution-integration.test.js` | ❌ Wave 0 |
| CASHOUT-04/05 | Minimum-amount rejection; rejected when market closed / wager resolved | unit + integration | `npx jest tests/cashout.validation.test.js` | ❌ Wave 0 |
| CASHOUT-06 | Two concurrent cashout requests on the same wager — only one succeeds | integration (concurrency, `Promise.all`) | `npx jest tests/cashout.concurrency.test.js` | ❌ Wave 0 |
| CASHOUT-07 | Retried request with same idempotency key does not double-apply | integration | `npx jest tests/cashout.idempotency.test.js` | ❌ Wave 0 |
| CASHOUT-08 | wallet_transactions row + audit trail produced, balance only via recorded movement | integration | `npx jest tests/cashout.audit.test.js` | ❌ Wave 0 |
| CASHOUT-09 | Works without referencing `choice`/market type | unit (source-grep gate) + integration | grep gate + `npx jest tests/cashout.computation.test.js` | ❌ Wave 0 |
| CASHOUT-10 | No float drift across repeated partial cashouts on the same wager | unit | `npx jest tests/money.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `npx jest tests/cashout.*.test.js tests/money.test.js`
- **Per wave merge:** `npm test` (full suite, includes Phase 1's notification tests — must stay green, since this phase extends `notificationService.register()` and modifies `marketService.resolveMarket()`)
- **Phase gate:** Full suite green before `/gsd-verify-work` — **but see Environment Availability**: live-DB execution is blocked in this sandbox exactly as it was for all of Phase 1; the plan must account for this the same way Phase 1's plans did (written-and-ready tests + compensating dry-run verification), not silently skip test-writing.

### Wave 0 Gaps
- [ ] `tests/cashout.computation.test.js` — covers CASHOUT-01, CASHOUT-02, CASHOUT-09
- [ ] `tests/cashout.validation.test.js` — covers CASHOUT-04, CASHOUT-05
- [ ] `tests/cashout.concurrency.test.js` — covers CASHOUT-06 (must fire genuinely simultaneous requests via `Promise.all`, not sequential awaits, to actually exercise row-lock contention)
- [ ] `tests/cashout.idempotency.test.js` — covers CASHOUT-07
- [ ] `tests/cashout.audit.test.js` — covers CASHOUT-08
- [ ] `tests/cashout.resolution-integration.test.js` — covers CASHOUT-03, and re-verifies `resolveMarket`'s modified payout math doesn't regress the already-shipped win/loss payout tests from Phase 1's `tests/notifications.emission.test.js` (which resolve markets with no cashouts — remaining-fraction math must reduce to the original full-payout behavior when `cashed_out_amount = 0`)
- [ ] `tests/money.test.js` — covers CASHOUT-10 in isolation (pure function, no DB needed — this one CAN run in this sandbox regardless of the test-DB blocker)
- [ ] `tests/helpers/testDb.js` extension — `applyCashoutMigration()` (migration 004) + a `seedWager()`/`seedOpenMarket()` helper, following the exact `applyWalletSchema()`/`seedWallet()` precedent Phase 1 Plan 02/04 already established

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | `requireAuth` middleware (existing, reused unchanged) |
| V3 Session Management | no (unchanged by this phase) | — |
| V4 Access Control | yes | Ownership check baked into the `WHERE user_id = $3` clause of the wager-lock query (IDOR prevention), matching Phase 1's Pattern 4 and `cancelWager`'s existing ownership-check precedent |
| V5 Input Validation | yes | `amount`/`idempotency_key` validated server-side (`Number.isFinite`, `> 0`, string type); market/wager status re-validated after lock acquisition, not trusted from a pre-lock read |
| V6 Cryptography | no | Not applicable — no new cryptographic operation in this phase |
| V11 Business Logic | yes | Stake-proportional formula computed entirely server-side; client-submitted amount is a *stake to cash out* (bounded by `remainingStake`), never a payout value — closes the exact "trust frontend" attack surface requisitos.txt calls out explicitly |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| IDOR — cashing out someone else's wager by guessing/incrementing `wagerId` | Elevation of Privilege | Ownership (`user_id = $3`) baked into the same `SELECT ... FOR UPDATE ... WHERE` clause used to acquire the lock, not a separate check after — matches existing `cancelWager` precedent of ownership-in-query |
| Race condition / double-spend — two simultaneous cashout requests both succeed | Tampering / Repudiation | `SELECT ... FOR UPDATE` row lock inside `transaction()`; second transaction blocks until the first commits, then re-reads the now-updated `cashed_out_amount`/`wager.status` and is correctly rejected or recomputed against fresh state |
| Replay attack — retried/duplicated HTTP request re-applies the cashout | Repudiation | `UNIQUE(wager_id, idempotency_key)` constraint + `23505`-catch-and-replay-existing-result pattern |
| Parameter tampering — client sends a `payout`/`value` field instead of/alongside `amount`, hoping the server reads it | Tampering | Server computes and returns the value; never reads any client-submitted payout/value field, only the requested stake `amount` (bounded/validated against `remainingStake`) |
| Mass assignment — client sends extra fields (`wagerId` in body, `userId` in body) hoping to redirect the operation | Elevation of Privilege | Controller destructures only `{ amount, idempotency_key }` from `req.body`; `wagerId` comes from `req.params.id`, `userId` comes exclusively from `req.user.id` (JWT), matching the existing `wagersController.cancelWager` precedent exactly |

## Sources

### Primary (HIGH confidence — direct codebase read this session)
- `src/services/wagerService.js` (full file) — `placeWager`/`cancelWager` transaction/lock/emit shape
- `src/services/marketService.js` (full file) — `closeMarket`/`resolveMarket`/`deleteMarket` transaction/lock/emit shape, payout calculation to be modified
- `src/config/database.js` (full file) — `transaction()`/`query()` helpers, NUMERIC→float type parser
- `src/repositories/wagerRepository.js`, `walletRepository.js`, `marketRepository.js` (full files) — existing lock/CRUD method shapes
- `src/migrations/001_initial.js`, `002_wallet.js`, `003_notifications.js` (full files) — current schema, CHECK constraints, idempotency-constraint precedent
- `src/events/domainEvents.js`, `src/services/notificationService.js` (full files) — Phase 1's chokepoint/event-catalog pattern to extend
- `src/scheduler.js` (full file) — the scheduler race's actual mechanics
- `src/middleware/auth.js`, `src/utils/errors.js`, `src/middleware/errorHandler.js` (full files) — error-class conventions, `23505`-vs-`'P'`-prefix gotcha
- `.planning/phases/01-notifications-infrastructure/01-01-SUMMARY.md` through `01-04-SUMMARY.md`, `01-PATTERNS.md` — Phase 1's established patterns and the carried-forward test-DB-unreachable blocker
- `.planning/codebase/CONCERNS.md` — pre-existing scheduler race, missing idempotency, N+1/pagination debt already documented by the codebase mapper
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `requisitos.txt`, `prompt.txt` — binding requirements and confirmed decisions

### Secondary (MEDIUM confidence)
- `npm view decimal.js version time.created repository.url` + `api.npmjs.org/downloads/point/last-week/decimal.js` (executed this session, direct registry data)

### Tertiary (LOW confidence)
- None — no unverified web-search claims were used in this research; the domain is entirely internal-codebase-consistency, not external-library-API research.

## Metadata

**Confidence breakdown:**
- Standard stack (locking/transaction pattern): HIGH — directly read from 4 existing proven call sites in this exact codebase
- Standard stack (money-math library choice): MEDIUM — `decimal.js` legitimacy is HIGH-verified, but the *choice* between it and the zero-dependency alternative is a judgment call flagged for confirmation (A5)
- Architecture (lock ordering, schema additions): HIGH — the deadlock-ordering finding (Common Pitfall 1) and the `resolveMarket` payout-integration finding (Common Pitfall 2) are both derived directly from reading the actual current source, not inferred
- Pitfalls: HIGH — all 5 pitfalls are grounded in specific line-level reads of the current working tree, not generic financial-system advice
- Fee/minimum-amount values: LOW — genuinely unspecified anywhere in the source materials (see Assumptions Log A1/A2, Open Questions 1/2) — these are business decisions, not research gaps

**Research date:** 2026-07-14
**Valid until:** Valid as long as the working-tree source files read this session (`wagerService.js`, `marketService.js`, migrations 001-003) remain unchanged before Phase 2 planning begins. Since the repo has uncommitted working-tree state (per `git status`), re-verify these files were not further modified between this research and `/gsd-plan-phase` execution.
