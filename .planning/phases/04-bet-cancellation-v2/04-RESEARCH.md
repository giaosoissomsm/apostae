# Phase 4: Bet Cancellation v2 - Research

**Researched:** 2026-07-15
**Domain:** Financial transaction logic (fee-based wager cancellation) on an existing Node.js/Express/PostgreSQL betting platform
**Confidence:** HIGH

## Summary

Phase 4 replaces the existing free, pending-only `cancelWager` with a 5%-fee version, in place, on the same `DELETE /api/wagers/:id` route. Unlike Phases 1-3 (which added new tables/columns), this phase requires **no new migration** — every piece of schema it needs (`wagers.cashed_out_amount`, `wagers.status` CHECK already permits the value the UI already labels "Cancelada", `wallet_transactions` for the audit trail) already exists from Phase 2. The work is concentrated entirely in `src/services/wagerService.js#cancelWager` (rewrite the transaction body) plus a small, optional env/config addition for the fee percentage.

Three pre-existing, code-verified defects in the current `cancelWager` must be fixed as part of this phase, not treated as new features:
1. **Lock order bug**: `cancelWager` currently locks `wager` before `market` — the opposite order used by `placeWager`/`cashoutWager`/`resolveMarket`/`deleteMarket` (market → wager → wallet). This is a documented, never-closed deadlock risk (flagged in Phase 2 research as "Pitfall 1", re-flagged in Phase 2 code review). A concurrent cashout (market→wager) and cancel (wager→market) on the same wager can deadlock; PostgreSQL will abort one side with `40P01`, surfacing an unhandled error. CANCEL-07 explicitly requires this class of race be closed transactionally — Phase 4 is the natural, final place to fix it, matching the milestone's own "cancellation ships last, closes remaining gaps" framing.
2. **Weaker IDOR pattern**: `cancelWager` locks the wager by bare `id`, then checks `wager.user_id !== userId` afterward (returns 403). `cashoutWager`/`wagerRepository.findByIdForUpdate` already bakes ownership into the lock query's `WHERE` clause (returns null → 404) — a stronger IDOR mitigation, explicitly called out as unaddressed in Phase 2's own STATE.md decision log ("stronger IDOR mitigation than cancelWager's existing lock-then-check-afterward pattern"). Phase 4 should close this by switching `cancelWager` to the same repository helper.
3. **No cashout-blocking check**: the current `cancelWager` (per Phase 2's CR-02 fix) nets `cashed_out_amount` out of the refund but does **not** block cancellation when `cashed_out_amount > 0` — it only reduces the refund amount. CANCEL-06 requires an outright block once "a cashout has already occurred." This is a new guard, not present today.

**Primary recommendation:** Rewrite `cancelWager`'s transaction body to mirror `cashoutWager`'s structure exactly (peek market_id → lock market via `marketRepository.findByIdForUpdate` → lock+own-check wager via `wagerRepository.findByIdForUpdate` → validate → mutate → record), reusing `money.applyFeePercent` (already built in Phase 2, currently used with a 0% cashout fee) for the 5% fee computation. No new tables. No new npm packages.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CANCEL-01 | User can cancel a wager when the market permits cancellation | Pattern 1 (lock/validate sequence), Code Examples (recommended `cancelWager` rewrite) |
| CANCEL-02 | Cancelling automatically charges a 5% fee and refunds 95% to the wallet | Pattern 2 (`money.applyFeePercent` reuse), Open Question 2 (hardcode vs env-configurable fee) |
| CANCEL-03 | Fee computed off remaining stake (post any prior partial cashout), not original amount | Pitfall 1, Assumption A1, Code Examples (defensive `remainingStake` formula) |
| CANCEL-04 | Wallet transaction record + audit log entry | Pitfall 4, Assumption A3 (`wallet_transactions` row is the established "audit" mechanism) |
| CANCEL-05 | Wager status becomes "Cancelada" | Pitfall 3, Assumption A2 (reuse existing `'refunded'` status, already displayed as "Cancelada") |
| CANCEL-06 | Blocked once market closed, wager resolved, or a cashout already occurred | Pitfall 1 (open question — hard-block interpretation recommended), Code Examples |
| CANCEL-07 | Blocking checks enforced transactionally (row lock + re-validation), race-safe | Pattern 1 (lock order fix), Pitfall 2 (deadlock fix), Validation Architecture (concurrency test plan) |
| CANCEL-08 | Replaces `cancelWager` in place — same route/method, no versioning/flag | Architecture Diagram, Sources (`wagersController.js`/`routes/wagers.js` confirmed unchanged) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fee computation (5% / 95% split) | API / Backend (`src/utils/money.js`, `src/services/wagerService.js`) | — | Must never be computed or trusted from the client (requisitos.txt, CANCEL-02/03) |
| Cancellation eligibility checks (market open, wager pending, no prior cashout) | API / Backend (`src/services/wagerService.js`) | Database (CHECK constraints as defense-in-depth only, not primary enforcement) | Business-rule validation belongs in the service layer, re-validated after row locks are acquired (CANCEL-07) |
| Wallet balance mutation + transaction record | API / Backend → Database | Database (`wallet_transactions` table is the audit ledger) | Existing `walletRepository.adjustBalance`/`recordTransaction` pattern; balance never mutated without a corresponding row |
| Row-level locking / concurrency safety | Database (PostgreSQL `FOR UPDATE`) | API / Backend (`transaction()` helper orchestrates lock order) | Postgres enforces serialization; the service layer must acquire locks in the correct, consistent order to avoid deadlock |
| Cancel button visibility / confirmation UX | Browser / Client (`public/js/dashboard.js`) | — | Cosmetic only — backend is the sole source of truth for whether cancellation is actually allowed; frontend gating is UX polish, not a security boundary |
| Notification on cancellation | API / Backend (`domainEvents` → `notificationService.js`) | — | Chokepoint already exists and already has a `wager.cancelled` listener wired (Phase 1) — reuse, don't rebuild |

## Standard Stack

### Core
No new libraries are required for this phase. Reuse exactly what Phase 2 already introduced and proved:

| Library/Module | Version | Purpose | Why Standard (for this codebase) |
|---------|---------|---------|--------------|
| `src/utils/money.js` (in-repo, zero-dependency) | n/a (in-repo) | Decimal-safe `applyFeePercent(amount, feePercent)` → `{ fee, net }` | Already built and proven in `cashoutWager` for exactly this "gross → fee/net split" shape; reusing it is mandated by requisitos.txt's "não criar código duplicado" |
| `pg` | ^8.11.3 [VERIFIED: package.json] | `SELECT ... FOR UPDATE`, `transaction()` helper | Existing driver, no version change needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| none | — | — | — |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing `money.applyFeePercent` with a new `CANCEL_FEE_PERCENT` env var | Hardcoding `0.05`/`0.95` multipliers inline in `wagerService.js` | Hardcoding is what requisitos.txt's literal wording describes ("taxa de 5%", no mention of configurability) and is simpler, but breaks the established env-var + startup-bounds-validation pattern used for `CASHOUT_FEE_PERCENT` (`src/config/env.js`) and makes the fee untestable/untunable without a code change. Recommend the env-var route for consistency; flagged as an open question below since it is a judgment call, not a locked user decision. |

**Installation:** None — no new dependencies.

**Version verification:** N/A — no new packages. `pg` version unchanged, confirmed via `package.json` [VERIFIED: package.json].

## Package Legitimacy Audit

**Not applicable.** This phase introduces zero new npm packages — it exclusively modifies existing files (`src/services/wagerService.js`, `src/repositories/wagerRepository.js` if a new repo method is added, `src/config/env.js` optionally) and reuses in-repo utilities built in Phase 2. No `package-legitimacy check` invocation is needed.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                     DELETE /api/wagers/:id  (unchanged route/method — CANCEL-08)
                              │
                              ▼
                 wagersController.cancelWager
                 (req.user.id from JWT, req.params.id — no client-trusted fields)
                              │
                              ▼
                 wagerService.cancelWager(wagerId, userId)
                              │
              ┌───────────────┴────────────────────────────┐
              │  transaction(async (client) => { ... })     │
              │                                              │
              │  1. peek market_id (unlocked SELECT,         │
              │     market_id is immutable on a wager)        │
              │  2. LOCK market  FOR UPDATE  (marketRepository │
              │     .findByIdForUpdate) — market → wager →    │
              │     wallet order, matching cashoutWager        │
              │  3. LOCK+OWN-CHECK wager FOR UPDATE            │
              │     (wagerRepository.findByIdForUpdate:        │
              │     id + market_id + user_id all in WHERE)     │
              │  4. VALIDATE (re-check after locks, not        │
              │     before):                                   │
              │       - wager.status === 'pending'              │
              │       - market.status === 'open'                │
              │       - market.closes_at not passed              │
              │       - wager.cashed_out_amount === 0  (CANCEL-06)│
              │  5. COMPUTE fee/net via money.applyFeePercent(  │
              │     remainingStake, CANCEL_FEE_PERCENT)          │
              │  6. wagerRepository.updateStatus(id,'refunded')  │
              │  7. walletRepository.adjustBalance(+net)         │
              │  8. walletRepository.recordTransaction(          │
              │     type:'refund', amount: net, description       │
              │     mentions gross/fee for audit readability)     │
              └───────────────┬────────────────────────────┘
                              │ (commit)
                              ▼
                 domainEvents.emit('wager.cancelled', {...})
                              │
                              ▼
                 notificationService.js (existing listener,
                 Phase 1 chokepoint — no new wiring needed)
```

### Recommended Project Structure
No new files/folders. Modified files only:
```
src/
├── services/wagerService.js        # cancelWager rewritten (lock order, cashout block, fee)
├── repositories/wagerRepository.js # optionally: reuse existing findByIdForUpdate as-is (no change needed)
├── config/env.js                   # optionally: add CANCEL_FEE_PERCENT (mirrors CASHOUT_FEE_PERCENT)
tests/
└── cancel.*.test.js                # new test files, following the cashout.*.test.js naming/structure convention
```

### Pattern 1: Lock order market → wager → wallet, mirrored from `cashoutWager`
**What:** Always acquire the market row lock first, then the wager row lock (with ownership baked into the WHERE clause), then the wallet row lock — never any other order.
**When to use:** Any transaction that touches more than one of {market, wager, wallet} concurrently.
**Example:**
```javascript
// Source: src/services/wagerService.js:193-211 (cashoutWager, existing, unmodified — the pattern to replicate in the new cancelWager)
const peek = await client.query('SELECT market_id FROM wagers WHERE id = $1;', [wagerId]);
if (!peek.rows[0]) throw new NotFoundError('Aposta não encontrada.');

// ORDEM DE LOCK: mercado PRIMEIRO (igual placeWager/resolveMarket/deleteMarket).
const market = await marketRepository.findByIdForUpdate(peek.rows[0].market_id, client);
if (!market || market.status !== 'open') {
  throw new ConflictError('...');
}

// ORDEM DE LOCK: aposta SEGUNDA. Posse + mercado embutidos no WHERE (IDOR-safe).
const wager = await wagerRepository.findByIdForUpdate(wagerId, market.id, userId, client);
if (!wager) throw new NotFoundError('Aposta não encontrada.');
```
This is the exact template the new `cancelWager` should follow — it already exists in the codebase and is the pattern CANCEL-07 wants applied.

### Pattern 2: Fee split via `money.applyFeePercent`
**What:** Never compute `amount * 0.95` inline with raw floats — always go through the cents-based utility.
**When to use:** Any operation that debits a fee from a gross amount.
**Example:**
```javascript
// Source: src/utils/money.js:44-49 (existing, unmodified)
function applyFeePercent(amount, feePercent) {
  const fee = fromCents(Math.round(toCents(amount) * (feePercent / 100) + Number.EPSILON));
  return { fee, net: subtract(amount, fee) };
}
// Usage in the new cancelWager:
const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount); // CANCEL-03
const { fee, net } = money.applyFeePercent(remainingStake, env.CANCEL_FEE_PERCENT);
// net is refunded (95%), fee is charged (5%) and never separately credited anywhere —
// it simply is not refunded; document this clearly in the wallet_transactions description.
```

### Anti-Patterns to Avoid
- **Reintroducing the wager→market lock order:** Even though the current buggy code "works" in the absence of concurrent cashouts/resolutions, any code path that locks wager before market in this codebase is a latent deadlock against the other three methods that all lock market first. Do not carry this pattern forward.
- **Trusting a pre-lock read for eligibility checks:** `cancelWager`'s peek-market_id read is safe *only* because `market_id` is immutable on a wager row — never use a peeked, unlocked value for `status`/`cashed_out_amount` checks. Always re-read those fields from the locked row.
- **Computing the fee before validating `cashed_out_amount === 0`:** if the block-on-cashout check (CANCEL-06) is skipped or ordered after the fee computation, a partially-cashed-out wager could still slip through and get a (technically correct, per CANCEL-03) but requirement-violating partial cancellation. Validate CANCEL-06's block *before* computing anything.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fee/net split of a decimal amount | A new float-based `amount * 0.95` calculation | `money.applyFeePercent(amount, feePercent)` (existing, Phase 2) | Already has the `Number.EPSILON` IEEE-754 fix for exactly this class of rounding bug; a second hand-rolled implementation would silently diverge under edge cases (requisitos.txt: "não criar código duplicado") |
| Ownership-safe wager row lock | A new bespoke `SELECT * FROM wagers WHERE id = $1 FOR UPDATE` + after-the-fact `user_id` check | `wagerRepository.findByIdForUpdate(id, marketId, userId, client)` (existing, Phase 2) | Already IDOR-hardened (ownership baked into WHERE, not checked after); reusing it for `cancelWager` closes a documented, still-open gap from Phase 2's own decision log |
| Market row lock | Inline `SELECT * FROM markets WHERE id = $1 FOR UPDATE` (what the current `cancelWager` does) | `marketRepository.findByIdForUpdate(id, client)` (existing, Phase 2 — built explicitly as "DRY da query `SELECT ... FOR UPDATE` hoje duplicada inline em placeWager/cancelWager/resolveMarket/deleteMarket") | The repository method already exists specifically to replace this duplicated inline query; the current `cancelWager` predates it and never got migrated |

**Key insight:** Every primitive Phase 4 needs (fee math, ownership-safe locking, wallet transaction recording, domain-event emission) was already built and proven correct in Phase 2. This phase is a rewrite/hardening of one method using existing building blocks, not new infrastructure — treat any new helper function as a signal to stop and check whether it already exists in `wagerRepository`/`marketRepository`/`walletRepository`/`money.js` first.

## Common Pitfalls

### Pitfall 1: CANCEL-03 vs CANCEL-06 — an unresolved tension in the requirement wording that must not be silently guessed
**What goes wrong:** CANCEL-03 says the fee is "computed off the wager's *remaining* stake after any prior partial cashout" — language that implies cancellation of a *partially cashed-out* wager is still possible, just computed on the leftover stake. CANCEL-06 says cancellation is "blocked once ... a cashout has already occurred on that wager" — language that implies an outright, total block the instant `cashed_out_amount > 0`, with no partial-cancellation path at all. Taken as independent requirements, these two are in tension.
**Why it happens:** requisitos.txt's own Portuguese wording ("O sistema deve impedir cancelamentos quando: ... existir cashout realizado" — "the system must prevent cancellations when ... a cashout has been performed") is unambiguous in isolation and supports the CANCEL-06 hard-block reading. CANCEL-03's wording most likely exists as *defensive/future-proofing* phrasing (matching the exact formula already used in `resolveMarket`/`deleteMarket`'s `remainingStake` fix), not as license to allow a cancellation after a cashout.
**How to avoid:** Recommended resolution (see Open Questions below for the explicit confirmation ask): implement CANCEL-06 as a hard, total block — `if (Number(wager.cashed_out_amount) > 0) throw new ConflictError(...)` — placed *before* any refund math runs. Then compute the fee using CANCEL-03's literal formula (`remainingStake = wager.amount - wager.cashed_out_amount`) anyway, as a defensive no-op: since the block guarantees `cashed_out_amount === 0` by the time the formula runs, `remainingStake` always equals `wager.amount` in practice, so both requirements are satisfied without contradiction and the formula still protects the codebase if the block is ever relaxed in a future milestone.
**Warning signs:** Any implementation that nets `cashed_out_amount` out of the refund *without* the outright `ConflictError` block will pass CANCEL-03's literal test but silently fail CANCEL-06's — do not let a plan or test suite treat "refund the remaining stake" as satisfying "block if a cashout occurred."

### Pitfall 2: Deadlock via reversed lock order (market↔wager) between `cancelWager` and `cashoutWager`
**What goes wrong:** If the rewritten `cancelWager` does not adopt the market→wager→wallet order, a genuinely concurrent cashout (locks market, then wager) and cancel (locks wager, then market) on the *same wager* can deadlock: each transaction holds the lock the other is waiting for. PostgreSQL's deadlock detector will abort one side after a timeout with SQLSTATE `40P01`, which is not handled anywhere in `errorHandler.js` (same class of gap as the already-documented `25P02`/`22001` handling hole, see `02-REVIEW.md` IN-01) — it surfaces as a raw 500 to the user.
**Why it happens:** The current, pre-Phase-4 `cancelWager` was written before `cashoutWager` established the market-first convention and was never revisited (documented, never-closed gap — see `02-RESEARCH.md` Pitfall 1 and inline code comments in `wagerService.js:170-171`: "NUNCA a ordem oposta de cancelWager").
**How to avoid:** Rewrite `cancelWager`'s lock sequence to exactly match `cashoutWager`'s (peek unlocked market_id → lock market → lock+own-check wager → lock wallet), as described in Pattern 1 above.
**Warning signs:** Any code review of the new `cancelWager` that finds a `SELECT ... FROM wagers ... FOR UPDATE` statement appearing *before* the corresponding market lock should be treated as a regression of this exact, previously-known bug class.

### Pitfall 3: `wagers.status` has no `'cancelled'` enum value — do not add a migration for one without checking the existing UI convention first
**What goes wrong:** A naive reading of CANCEL-05 ("the wager's status becomes 'Cancelada'") might lead to adding a new `'cancelled'` value to the `wagers.status` CHECK constraint (`CREATE TABLE wagers (... status VARCHAR(20) ... CHECK (status IN ('pending', 'won', 'lost', 'refunded', 'voided')) ...)`, migration 001) and a matching migration. This is unnecessary churn.
**Why it happens:** [VERIFIED: codebase] `public/js/dashboard.js:246` already maps `status === 'refunded'` to the display label `'Cancelada'` — i.e. the existing free-cancellation feature already uses the `'refunded'` status value and already displays it to the user as "Cancelada". The DB enum is in English; the UI label is in Portuguese. CANCEL-05 is very likely already satisfied by continuing to use `updateStatus(wagerId, 'refunded', client)`, unchanged from the current code.
**How to avoid:** Keep `wagerRepository.updateStatus(wagerId, 'refunded', client)` as-is in the new `cancelWager`; do not add a migration or a new status value unless the user explicitly confirms they want a literal `'cancelled'` DB value distinct from `'refunded'` (e.g., to visually/programmatically distinguish "cancelled by user, fee charged" from some other future "refunded" scenario). Flagged as an open question below since it is a judgment call, not testable from requirements text alone.
**Warning signs:** A migration that only adds a status enum value with no other schema change is a signal this pitfall was not checked first.

### Pitfall 4: "Audit log entry" (CANCEL-04) does not mean a new `audit_logs` table row
**What goes wrong:** `audit_logs` (migration 001) is reserved, by established codebase convention, for admin/security actions (login, logout, password changes, admin user-management actions — see `authService.js`/`userService.js`, all of which pass `admin_id`). Financial operations (`placeWager`, `cashoutWager`, `resolveMarket`, `deleteMarket`, the current `cancelWager`) have never written to `audit_logs` — they satisfy "audit" purely via the `wallet_transactions` row (`balance_before`/`balance_after`/`description`/`related_entity`/`related_id`), which is the append-only financial ledger.
**Why it happens:** The word "audit" appears in both CASHOUT-08 and CANCEL-04, and it is tempting to assume it always means the `audit_logs` table specifically. [VERIFIED: codebase — grep across `src/`] confirms `cashoutWager` (CASHOUT-08, already shipped and marked Complete in REQUIREMENTS.md) never inserts into `audit_logs` — only into `wallet_transactions`. This is the established, accepted interpretation for this codebase.
**How to avoid:** Continue the same pattern for `cancelWager` — a single `wallet_transactions` row (`type: 'refund'`, `amount: net`, populated `balance_before`/`balance_after`, a `description` that mentions the gross amount and the 5% fee for human-readability) is sufficient to satisfy CANCEL-04, consistent with CASHOUT-08's precedent.
**Warning signs:** A plan that adds a new `INSERT INTO audit_logs` call inside `cancelWager` is diverging from the established pattern — flag for confirmation rather than assuming it's required.

### Pitfall 5: Frontend cancel button has no awareness of `cashed_out_amount`
**What goes wrong:** `public/js/dashboard.js:227`'s cancel button visibility condition is `w.status === 'pending' && w.market_status === 'open'` — it does not check `cashed_out_amount`. Once CANCEL-06's hard block ships, a user who partially cashed out a wager will still see an active "Cancelar" button, click it, and receive a rejected-request toast (`err.message` from the thrown `ConflictError`) instead of the button simply not being there. Functionally correct (backend is the enforcement point, not the UI) but a UX rough edge.
**Why it happens:** The dashboard's wager list query (`wagerRepository.findByUserId`/`findByUsername`, via `SELECT_WITH_MARKET`) already returns `cashed_out_amount`-adjacent data is not confirmed — check whether `w.cashed_out_amount` is actually present in the `GET /api/wagers/user/:username` response payload before assuming the frontend can gate on it without a repository query change.
**How to avoid:** Not a hard requirement (CANCEL-01..08 are backend-only requirements), but recommended as a low-cost UX improvement: add `w.cashed_out_amount > 0` to the cancel-button visibility condition, and update the success toast to reflect the 5%-fee/95%-refund split using the enriched cancellation response (see Code Examples below for what the response should now include).
**Warning signs:** None — this is optional polish, not a defect. Flag as a discretionary task for the plan.

## Code Examples

Verified patterns from this codebase (all read directly this session):

### Current `cancelWager` (to be rewritten) — full existing implementation
```javascript
// Source: src/services/wagerService.js:107-165 (current, pre-Phase-4 state)
async cancelWager(wagerId, userId) {
  const result = await transaction(async (client) => {
    const wagerResult = await client.query('SELECT * FROM wagers WHERE id = $1 FOR UPDATE;', [wagerId]);
    const wager = wagerResult.rows[0];
    if (!wager) throw new NotFoundError('Aposta não encontrada.');
    if (wager.user_id !== userId) throw new AuthorizationError('Essa aposta não é sua.');
    if (wager.status !== 'pending') throw new ConflictError('Essa aposta não pode mais ser cancelada.');

    const marketResult = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [wager.market_id]);
    const market = marketResult.rows[0];
    if (!market || market.status !== 'open') {
      throw new ConflictError('Não é mais possível cancelar: o mercado já fechou.');
    }
    if (market.closes_at && new Date(market.closes_at) <= new Date()) {
      throw new ConflictError('Não é mais possível cancelar: o prazo já acabou.');
    }

    await wagerRepository.updateStatus(wagerId, 'refunded', client);

    // CR-02 fix (Phase 2 review) — nets cashed_out_amount, but does NOT block.
    const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);

    const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
    const balanceBefore = wallet.balance;
    const updated = await walletRepository.adjustBalance(wallet.id, remainingStake, client);
    await walletRepository.recordTransaction({
      walletId: wallet.id, type: 'refund', amount: remainingStake,
      balanceBefore, balanceAfter: updated.balance,
      relatedEntity: 'wager', relatedId: wager.id,
      description: `Cancelamento da aposta #${wager.id}`,
    }, client);

    return { marketId: wager.market_id, amount: remainingStake, question: market.question };
  });

  domainEvents.emit('wager.cancelled', {
    wagerId, userId, marketId: result.marketId, question: result.question, amount: result.amount,
  });

  logger.info(`Usuário ${userId} cancelou a aposta #${wagerId}`);
  return { ok: true };
}
```

### Recommended new `cancelWager` shape (composed from existing, proven pieces)
```javascript
// Illustrative — combines cashoutWager's lock pattern (src/services/wagerService.js:193-211)
// with money.applyFeePercent (src/utils/money.js:44-49) and the CANCEL-06 hard block.
async cancelWager(wagerId, userId) {
  const result = await transaction(async (client) => {
    const peek = await client.query('SELECT market_id FROM wagers WHERE id = $1;', [wagerId]);
    if (!peek.rows[0]) throw new NotFoundError('Aposta não encontrada.');

    // ORDEM DE LOCK: mercado PRIMEIRO (agora igual a placeWager/cashoutWager/resolveMarket/deleteMarket).
    const market = await marketRepository.findByIdForUpdate(peek.rows[0].market_id, client);
    if (!market || market.status !== 'open') {
      throw new ConflictError('Não é mais possível cancelar: o mercado já fechou.');
    }
    if (market.closes_at && new Date(market.closes_at) <= new Date()) {
      throw new ConflictError('Não é mais possível cancelar: o prazo já acabou.');
    }

    // ORDEM DE LOCK: aposta SEGUNDA — ownership embutida no WHERE (IDOR-safe,
    // substitui o padrão "trava depois checa" antigo).
    const wager = await wagerRepository.findByIdForUpdate(wagerId, market.id, userId, client);
    if (!wager) throw new NotFoundError('Aposta não encontrada.'); // 404, não 403 — não vaza existência
    if (wager.status !== 'pending') throw new ConflictError('Essa aposta não pode mais ser cancelada.');

    // CANCEL-06: bloqueio TOTAL se qualquer cashout já ocorreu — checado
    // ANTES de qualquer cálculo de reembolso.
    if (Number(wager.cashed_out_amount) > 0) {
      throw new ConflictError('Não é possível cancelar: essa aposta já teve um cashout realizado.');
    }

    // CANCEL-03: fórmula defensiva — remainingStake === wager.amount sempre,
    // dado o bloqueio acima, mas mantém a mesma fórmula usada em resolveMarket/deleteMarket.
    const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);
    const { fee, net } = money.applyFeePercent(remainingStake, env.CANCEL_FEE_PERCENT);

    await wagerRepository.updateStatus(wagerId, 'refunded', client); // 'refunded' -> UI already labels "Cancelada"

    // ORDEM DE LOCK: carteira TERCEIRA.
    const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
    const balanceBefore = wallet.balance;
    const updated = await walletRepository.adjustBalance(wallet.id, net, client);
    await walletRepository.recordTransaction({
      walletId: wallet.id, type: 'refund', amount: net,
      balanceBefore, balanceAfter: updated.balance,
      relatedEntity: 'wager', relatedId: wager.id,
      description: `Cancelamento da aposta #${wager.id} (taxa de ${env.CANCEL_FEE_PERCENT}% = R$${fee.toFixed(2)}, reembolso líquido R$${net.toFixed(2)} sobre R$${remainingStake.toFixed(2)})`,
    }, client);

    return { marketId: market.id, question: market.question, grossAmount: remainingStake, feeAmount: fee, netAmount: net };
  });

  domainEvents.emit('wager.cancelled', {
    wagerId, userId, marketId: result.marketId, question: result.question,
    amount: result.netAmount, // preserves existing evt.amount semantics used by notificationService.js
    grossAmount: result.grossAmount, feeAmount: result.feeAmount,
  });

  logger.info(`Usuário ${userId} cancelou a aposta #${wagerId} (taxa: R$${result.feeAmount.toFixed(2)})`);
  return { ok: true, refunded: result.netAmount, fee: result.feeAmount };
}
```
This is illustrative, not a final diff — the planner should verify field names/exact error messages against the live file before generating tasks.

### `env.js` addition (mirrors the existing `CASHOUT_FEE_PERCENT` pattern exactly)
```javascript
// Source pattern: src/config/env.js:37 and its validation block (existing, unmodified)
CANCEL_FEE_PERCENT: parseFloat(process.env.CANCEL_FEE_PERCENT || '5'),
// ... and the same [0,100] bounds-validation block already used for CASHOUT_FEE_PERCENT,
// duplicated (or generalized into a shared validator) for CANCEL_FEE_PERCENT.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `cancelWager` locks wager before market | Market-first lock order everywhere else in the codebase (`placeWager`, `cashoutWager`, `resolveMarket`, `deleteMarket`) | Established in Phase 2 (cashout); never retrofitted into `cancelWager` | Phase 4 is the last chance to close this before the milestone ends — no future phase touches wager cancellation again |
| Refund computed as full `wager.amount` | Refund computed as `wager.amount - wager.cashed_out_amount` | Phase 2 code review (CR-02), already shipped | Phase 4 must not regress this — the new fee math must apply *on top of* this existing net calculation, not replace it |
| No fee on cancellation | 5% fee, 95% refund (CANCEL-02) | This phase | New behavior; `money.applyFeePercent` already supports non-zero fees (was proven for a hypothetical non-zero `CASHOUT_FEE_PERCENT`), just never exercised with `feePercent > 0` in production code yet |

**Deprecated/outdated:**
- Free (0%-fee), no-cashout-check cancellation: replaced in place per CANCEL-08 (same route, no versioning/flag).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | CANCEL-06 means an outright block on any wager with `cashed_out_amount > 0` (not a partial-cancellation-with-netting reading of CANCEL-03) | Pitfall 1, Code Examples | If wrong, the plan implements the wrong business rule for the platform's actual money-handling policy — this is the single highest-impact assumption in this research and MUST be confirmed with the user before planning locks it in |
| A2 | CANCEL-05 ("status becomes 'Cancelada'") is satisfied by continuing to use the existing `'refunded'` DB status value (already displayed as "Cancelada" in the UI), not a new `'cancelled'` enum value | Pitfall 3 | If wrong, a migration adding a new status value (and updating `dashboard.js`'s status-label map, and possibly other status-branching code) is needed and was not scoped |
| A3 | CANCEL-04 ("audit log entry") is satisfied by a `wallet_transactions` row alone, not a new `audit_logs` table insert | Pitfall 4 | Low risk — directly supported by CASHOUT-08's already-shipped, already-accepted precedent (same wording, same interpretation, already marked Complete) |
| A4 | Introducing a `CANCEL_FEE_PERCENT` env var (default `5`, `[0,100]`-bounded like `CASHOUT_FEE_PERCENT`) is preferable to hardcoding `0.05`/`0.95` inline | Standard Stack — Alternatives Considered | Low risk either way — purely an engineering-consistency judgment call, does not affect correctness, easy to change later |
| A5 | No new database migration is required for this phase | Summary | If wrong (e.g. if A2 or A4's env-var route is rejected in favor of a schema-level fee-percent setting), a migration would need to be added — moderate planning impact |

**If this table is empty:** N/A — see entries above; A1 requires explicit user confirmation before planning.

## Open Questions

1. **Does CANCEL-06 block cancellation entirely once any cashout has occurred, or does it only require netting the fee/refund off the remaining (post-cashout) stake?**
   - What we know: requisitos.txt's literal Portuguese wording ("existir cashout realizado" — "a cashout has been performed") and CANCEL-06's English wording ("a cashout has already occurred on that wager") both read as an outright block condition, structurally identical to the other two block conditions in the same list (market closed, wager resolved) — neither of *those* is a "partial/netted" condition, both are hard stops.
   - What's unclear: CANCEL-03's wording ("computed off the wager's remaining stake after any prior partial cashout") only makes semantic sense as a *live* code path if a partially-cashed-out wager can still reach the fee-computation step — which is only true if CANCEL-06 is read as something looser than a total block.
   - Recommendation: Adopt the hard-block reading (A1) as the primary implementation, computing the fee off `remainingStake` as pure defensive-formula insurance (see Code Examples). **This should be explicitly confirmed with the user/product owner before the plan is finalized**, since it is a real behavioral fork (a user who cashed out $1 of a $100 wager either can still cancel the other $99 for a 5% fee, or cannot cancel at all) with direct financial-UX impact, not something the planner should silently pick.

2. **Should the cancellation fee percentage be a hardcoded constant (`0.05`) or a configurable `CANCEL_FEE_PERCENT` env var?**
   - What we know: requisitos.txt states a fixed "5%" with no mention of configurability (unlike cashout's fee, which was explicitly designed to start at 0% and be tunable later — see STATE.md Phase 2 decision).
   - What's unclear: whether the fixed 5% is a genuine business constant that should never change without a code review, or whether operational flexibility (matching `CASHOUT_FEE_PERCENT`'s pattern) is desired.
   - Recommendation: Default to the env-var pattern (A4) for architectural consistency and testability; low risk if the user prefers a hardcoded constant instead — trivial to switch either direction.

3. **Does the `GET /api/wagers/user/:username` payload (used by `dashboard.js`) already include `cashed_out_amount`, and is updating the frontend's cancel-button visibility/messaging in scope for this phase?**
   - What we know: `wagerRepository.findByUserId`/`findByUsername` use `SELECT_WITH_MARKET`, which does `SELECT w.id, w.user_id, w.market_id, w.choice, w.option_id, w.amount, w.odds_at_time, w.potential_payout, w.status, w.created_at, w.resolved_at, m.question, ...` — **`w.cashed_out_amount` and `w.cancelled_fee`/similar are not in this explicit column list**, so the frontend currently cannot see cashed-out state at all.
   - What's unclear: whether the phase's scope includes a small repository-query change (add `cashed_out_amount` to `SELECT_WITH_MARKET`) plus the corresponding `dashboard.js` UX polish, or whether that is out of scope (ROADMAP.md's Phase 4 entry has no "UI hint: yes" marker, unlike Phase 3).
   - Recommendation: Treat as a small, optional, low-risk addition (Pitfall 5) — flag for planner discretion rather than a hard requirement, since CANCEL-01..08 are all backend-only requirements.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL (live, `*test*`-named DB) | Integration tests (`tests/cancel.*.test.js`, following `tests/helpers/testDb.js` convention) | ✗ [VERIFIED: STATE.md carried-forward blocker, reconfirmed by every Phase 1-3 plan's SUMMARY.md] | — | Same compensating pattern used in every prior phase: mock-backed dry runs + structural checks (`node -c`, `require()`-load), with tests written correctly and ready to run once a real Postgres test DB is reachable. This blocker is now three phases old and should be escalated to the user again — Phase 4's CANCEL-07 concurrency requirement is explicitly the kind of test (`Promise.allSettled` racing real row locks) that mocks are structurally incapable of validating, exactly as `02-REVIEW.md` CR-01 and `03-REVIEW.md` CR-01 both already demonstrated for this exact class of gap. |
| Node.js / npm / Jest | Test execution | ✓ [VERIFIED: package.json — jest ^30.4.2 installed] | jest 30.4.2 | — |

**Missing dependencies with no fallback:**
- None — the live-Postgres gap has a documented (if imperfect) fallback already used successfully (with caveats) in Phases 1-3.

**Missing dependencies with fallback:**
- Live `*test*`-named PostgreSQL instance — see above. Given this is the **third consecutive phase** to hit this exact blocker, and given that this phase's core requirement (CANCEL-07, concurrency safety) is the hardest one to verify without a real database, strongly recommend the plan include an explicit checkpoint asking the user to resolve DB access (or confirm human-verify-at-execution-time as the accepted mitigation) before the phase is marked complete — mirroring the precedent set by Phase 1's UAT pause (see `20cdad9` commit: "pause UAT — blocked on test-DB access, user directed move to Phase 2").

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.4.2 [VERIFIED: package.json] |
| Config file | none — uses Jest defaults, `npm test` = `jest --runInBand` |
| Quick run command | `npx jest tests/cancel.<name>.test.js` |
| Full suite command | `npm test` (runs all `tests/*.test.js`, `--runInBand` avoids DB-connection-pool contention across files) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CANCEL-01 | User can cancel a pending wager while market is open | integration | `npx jest tests/cancel.happy-path.test.js` | ❌ Wave 0 |
| CANCEL-02 | 5% fee charged, 95% refunded | unit + integration | `npx jest tests/cancel.fee-computation.test.js` | ❌ Wave 0 |
| CANCEL-03 | Fee computed off remaining (post-cashout) stake, not original amount | integration (requires seeding `cashedOutAmount` via existing `seedWager` helper, then testing the pre-block defensive formula) | `npx jest tests/cancel.fee-computation.test.js` | ❌ Wave 0 (can extend the same file as CANCEL-02) |
| CANCEL-04 | Wallet transaction record + audit trail produced | integration | `npx jest tests/cancel.audit.test.js` | ❌ Wave 0 (mirror `tests/cashout.audit.test.js` structure) |
| CANCEL-05 | Wager status becomes `'refunded'` (displayed "Cancelada") | integration | `npx jest tests/cancel.happy-path.test.js` | ❌ Wave 0 |
| CANCEL-06 | Blocked when market closed / wager resolved / cashout occurred | integration (3 distinct negative-path cases) | `npx jest tests/cancel.blocking.test.js` | ❌ Wave 0 |
| CANCEL-07 | Transactional row-lock + re-validation; concurrency-safe against cashout/resolve races | integration, **requires real Postgres** (see Environment Availability) | `npx jest tests/cancel.concurrency.test.js` | ❌ Wave 0 (mirror `tests/cashout.concurrency.test.js` structure exactly — `Promise.allSettled`/`Promise.all`, never sequential awaits) |
| CANCEL-08 | Same route/method, no versioned endpoint | static/structural | grep-based check in `<verify>` block, no dedicated test file needed (mirrors `wagersController.cancelWager` staying wired to `DELETE /:id`) | n/a |

### Sampling Rate
- **Per task commit:** `npx jest tests/cancel.<relevant>.test.js`
- **Per wave merge:** `npm test` (full suite — critical given this phase touches a shared method other tests indirectly depend on, e.g. `tests/cashout.cancel-refund.test.js` already exercises the *current* `cancelWager` and must be re-verified/updated, not just left passing by accident)
- **Phase gate:** Full suite green before `/gsd-verify-work` — and, given the live-Postgres gap, an explicit human-verify checkpoint for CANCEL-07's concurrency test specifically (mocks cannot prove real row-lock serialization, as already demonstrated twice this milestone)

### Wave 0 Gaps
- [ ] `tests/cancel.happy-path.test.js` — covers CANCEL-01, CANCEL-05
- [ ] `tests/cancel.fee-computation.test.js` — covers CANCEL-02, CANCEL-03
- [ ] `tests/cancel.blocking.test.js` — covers CANCEL-06 (3 cases: closed market, resolved wager, prior cashout)
- [ ] `tests/cancel.audit.test.js` — covers CANCEL-04
- [ ] `tests/cancel.concurrency.test.js` — covers CANCEL-07 (requires live Postgres — see Environment Availability)
- [ ] `tests/cashout.cancel-refund.test.js` (existing, Phase 2) — must be reviewed/updated, since it currently tests the *old* fee-less `cancelWager` behavior and will break/need updating once the 5% fee ships
- [ ] No new test framework/config needed — `tests/helpers/testDb.js` already supports every fixture this phase needs (`seedWager({ cashedOutAmount })`, `seedOpenMarket`), confirmed by direct read this session

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireAuth` middleware (existing, reused unchanged — `router.delete('/:id', requireAuth, wagersController.cancelWager)`) |
| V3 Session Management | no (unchanged by this phase) | — |
| V4 Access Control | yes | Ownership baked into `wagerRepository.findByIdForUpdate`'s `WHERE id = $1 AND market_id = $2 AND user_id = $3` — closes the previously-weaker "lock then check after" pattern (403→404, avoids existence leakage) |
| V5 Input Validation | yes | `wagerId` parsed via `Number(req.params.id)` (existing); no other client-supplied fields are read by `cancelWager` — `userId` exclusively from JWT, never from body/params |
| V6 Cryptography | no | Not applicable |
| V11 Business Logic | yes | Fee/refund entirely server-computed via `money.applyFeePercent`; client never supplies or influences the refund amount — closes requisitos.txt's explicit "nunca confiar em valores enviados pelo frontend" for this endpoint (the endpoint takes no body at all today, and should continue to take none) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Double-spend — user cancels the same wager twice concurrently (e.g. two rapid `DELETE` clicks) | Tampering / Repudiation | `SELECT ... FOR UPDATE` on the wager row; second transaction blocks until first commits, re-reads `status !== 'pending'` (now `'refunded'`) and correctly rejects with `ConflictError` |
| Deadlock via reversed lock order (this phase's central bug) → denial of service on legitimate concurrent cashout/cancel pairs | Denial of Service | Fix lock order to market→wager→wallet (Pitfall 2) |
| IDOR — cancelling someone else's wager by guessing/incrementing `wagerId` in the URL | Elevation of Privilege | Ownership baked into the lock query's `WHERE` clause (`wagerRepository.findByIdForUpdate`), returns 404 not 403 — avoids confirming wager existence to a non-owner |
| Race against market close/resolution — cancelling a wager in the split second the scheduler closes/resolves its market | Tampering | Market row lock (`marketRepository.findByIdForUpdate`) acquired before the wager lock; scheduler's `closeMarket`/`resolveMarket` compete for the same row lock and are correctly serialized by Postgres regardless of which transaction started first |
| Cashout-then-cancel double-pay (this phase's core financial-integrity requirement, CANCEL-06) | Repudiation / financial-integrity violation | Explicit `cashed_out_amount > 0` check before any refund math, raising `ConflictError` — must be the first check after locks are acquired, before the fee/net computation |
| Parameter tampering — client sends a `fee`/`amount`/`refund` field in the request body hoping the server reads it | Tampering | The endpoint takes no request body today (`DELETE /:id`, no `req.body` read anywhere in `cancelWager`); keep it that way — any new body field would be a new attack surface with no legitimate purpose |

## Sources

### Primary (HIGH confidence — direct codebase read this session)
- `src/services/wagerService.js` (full file, current committed state) — `cancelWager`/`cashoutWager`/`placeWager` transaction/lock/emit shapes, the exact bug being fixed
- `src/services/marketService.js` (full file) — `closeMarket`/`resolveMarket`/`deleteMarket` lock order and `remainingStake`/`remainingFraction` fee-netting precedent
- `src/repositories/wagerRepository.js`, `marketRepository.js`, `walletRepository.js` (full files) — existing lock/CRUD helpers to reuse
- `src/utils/money.js` (full file) — `applyFeePercent` utility to reuse verbatim
- `src/config/env.js` (full file) — `CASHOUT_FEE_PERCENT` env-var + bounds-validation pattern to mirror
- `src/config/database.js` (full file) — `transaction()` helper semantics
- `src/migrations/001_initial.js`, `002_wallet.js`, `004_cashout.js`, `005_market_types.js`, `006_market_odds_nullable.js` (full files) — confirms no new migration is required; confirms `wagers.status` CHECK constraint values
- `src/controllers/wagersController.js`, `src/routes/wagers.js` (full files) — confirms `DELETE /api/wagers/:id` route/method to preserve (CANCEL-08)
- `src/services/notificationService.js` (full file) — confirms the `wager.cancelled` listener already exists from Phase 1, no new wiring needed
- `public/js/dashboard.js` (relevant excerpts) — confirms `'refunded'` status already displays as "Cancelada"; confirms cancel-button visibility condition doesn't account for `cashed_out_amount`
- `tests/helpers/testDb.js` (full file) — confirms `seedWager({ cashedOutAmount })`/`seedOpenMarket` fixtures already support every scenario this phase's tests need; confirms `seedMarketOptions`'s CTE fix (03-REVIEW.md CR-01) is already applied in the current file
- `tests/cashout.concurrency.test.js`, `tests/cashout.audit.test.js` (full files) — the exact test structure/convention to replicate for CANCEL-07/CANCEL-04
- `.planning/phases/02-partial-cashout/02-REVIEW.md`, `02-REVIEW-FIX.md` (full files) — CR-02 fix details (the existing netting logic Phase 4 must not regress), CR-01 savepoint pattern (relevant if a similar transaction-abort edge case exists in the new code, though `cancelWager` has no idempotency-key/unique-constraint retry path so CR-01's specific bug does not apply here)
- `.planning/phases/03-new-market-types/03-REVIEW.md` (full file) — confirms cancellation logic is untouched by/agnostic to market type (never references `wager.choice`/`option_id`), per Phase 3's own completeness audit
- `requisitos.txt`, `prompt.txt` (full files) — source-of-truth requirement wording for Section 4 "Cancelamento de aposta" / "4. Cancelamento de aposta"
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` (full files) — CANCEL-01..08 definitions, Phase 4 goal/success criteria, cross-phase decision log

### Secondary (MEDIUM confidence)
- None — this phase required no external documentation lookup; all findings are first-party codebase evidence, the strongest available source for an in-place rewrite of existing, already-audited logic.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; every reused utility (`money.js`, repository lock helpers) was read in full and already proven in Phase 2's shipped, reviewed code.
- Architecture: HIGH — the target architecture is a direct structural copy of `cashoutWager`, an existing, code-reviewed, fixed method in the same file.
- Pitfalls: HIGH for Pitfalls 2-5 (all directly evidenced by reading current source + prior review docs). MEDIUM for Pitfall 1 (CANCEL-03/CANCEL-06 tension) — the recommended resolution is well-reasoned from the source Portuguese text but is explicitly flagged as needing user confirmation, not something research can resolve unilaterally.

**Research date:** 2026-07-15
**Valid until:** No expiry driver — this is an in-repo, no-new-dependency phase; revalidate only if `wagerService.js`/`money.js`/the `wagers`/`wallet_transactions` schema changes before Phase 4 planning begins (e.g., if Phase 3's still-open Wave 6 human-verify gate against real Postgres surfaces a schema change).
</content>
