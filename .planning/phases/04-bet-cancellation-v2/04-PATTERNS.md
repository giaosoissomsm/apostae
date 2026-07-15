# Phase 4: Bet Cancellation v2 - Pattern Map

**Mapped:** 2026-07-15
**Files analyzed:** 3 (1 rewrite, 1 optional new config key, 1 optional repository-query tweak)
**Analogs found:** 3 / 3

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/services/wagerService.js#cancelWager` (rewrite in place) | service | CRUD (transactional financial mutation) | `src/services/wagerService.js#cashoutWager` (same file, lines ~193-211 lock sequence + fee/net split further down) | exact — same file, same class, sibling method, proven structure |
| `src/config/env.js` (optional `CANCEL_FEE_PERCENT` addition) | config | request-response (startup bounds validation) | `src/config/env.js` lines 37, 51-63 (`CASHOUT_FEE_PERCENT` definition + validation block) | exact |
| `src/repositories/wagerRepository.js` (no change expected; reuse `findByIdForUpdate`) | repository | CRUD | itself, lines 46-52 (`findByIdForUpdate`) | exact — zero-diff reuse |
| `public/js/dashboard.js` (optional cancel-button/toast polish, discretionary) | component | request-response | `public/js/dashboard.js` line 227 (cancel-button visibility condition), line 246 (status→label map) | role-match — optional, not a hard requirement (Pitfall 5) |

No new files are created. `src/controllers/wagersController.js` (lines 15-18) and `src/routes/wagers.js` (`DELETE /:id`) are confirmed unchanged (CANCEL-08) — do not touch.

## Pattern Assignments

### `src/services/wagerService.js#cancelWager` (service, CRUD — full rewrite of transaction body)

**Analog:** `src/services/wagerService.js#cashoutWager` (same file)

**Current (buggy) implementation to be replaced — full excerpt** (`src/services/wagerService.js:107-165`... — actual current line numbers may drift slightly, verify before editing):
```javascript
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

**Bugs this rewrite must fix (do not carry forward):**
1. Locks `wager` before `market` (deadlock risk vs. `cashoutWager`/`resolveMarket`/`deleteMarket`, all of which lock market first).
2. Locks wager by bare `id`, then checks `wager.user_id !== userId` afterward (403) — weaker IDOR pattern than `findByIdForUpdate`'s baked-in `WHERE` ownership check (404).
3. Nets `cashed_out_amount` out of the refund but never blocks cancellation outright when `cashed_out_amount > 0` (CANCEL-06 requires a hard block).

**Analog — `cashoutWager`'s lock sequence to replicate exactly** (`src/services/wagerService.js:193-211`, verified current):
```javascript
const result = await transaction(async (client) => {
  // Peek não travado — só pra descobrir qual mercado travar. market_id
  // nunca muda numa aposta existente, então isso não é um risco de TOCTOU.
  const peek = await client.query('SELECT market_id FROM wagers WHERE id = $1;', [wagerId]);
  if (!peek.rows[0]) throw new NotFoundError('Aposta não encontrada.');

  // ORDEM DE LOCK: mercado PRIMEIRO (igual placeWager/resolveMarket/deleteMarket).
  const market = await marketRepository.findByIdForUpdate(peek.rows[0].market_id, client);
  if (!market || market.status !== 'open') {
    throw new ConflictError('Cashout indisponível: o mercado não está mais aberto.');
  }

  // ORDEM DE LOCK: aposta SEGUNDA. Posse + mercado embutidos no WHERE
  // (IDOR-safe — ver findByIdForUpdate).
  const wager = await wagerRepository.findByIdForUpdate(wagerId, market.id, userId, client);
  if (!wager) throw new NotFoundError('Aposta não encontrada.');
  if (wager.status !== 'pending') {
    throw new ConflictError('Cashout indisponível: essa aposta já foi resolvida.');
  }

  const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);
  ...
  const gross = money.multiply(requestedStake, Number(wager.odds_at_time));
  const { fee, net } = money.applyFeePercent(gross, env.CASHOUT_FEE_PERCENT);
  ...
```
Note: `cashoutWager` also has a SAVEPOINT/idempotency-key retry block (for `wager_cashouts` unique constraint) that does NOT apply to `cancelWager` — `cancelWager` has no idempotency-key insert path, so that portion of `cashoutWager` should NOT be copied.

**Ownership-safe lock helper to reuse verbatim** (`src/repositories/wagerRepository.js:46-52`, verified current):
```javascript
async findByIdForUpdate(id, marketId, userId, client) {
  const result = await client.query(
    'SELECT * FROM wagers WHERE id = $1 AND market_id = $2 AND user_id = $3 FOR UPDATE;',
    [id, marketId, userId]
  );
  return result.rows[0] || null;
}
```

**Market lock helper to reuse verbatim** (`src/repositories/marketRepository.js:86-89`, verified current):
```javascript
async findByIdForUpdate(id, client) {
  const result = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [id]);
  return result.rows[0] || null;
}
```

**Fee/net split utility to reuse verbatim** (`src/utils/money.js:44-47`, verified current):
```javascript
function applyFeePercent(amount, feePercent) {
  const fee = fromCents(Math.round(toCents(amount) * (feePercent / 100) + Number.EPSILON));
  return { fee, net: subtract(amount, fee) };
}
```

**Recommended new `cancelWager` shape** (illustrative composite — verify field/error-message wording against live file before generating tasks; see RESEARCH.md "Code Examples" for the fully worked version):
```javascript
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

    // ORDEM DE LOCK: aposta SEGUNDA — ownership embutida no WHERE (IDOR-safe).
    const wager = await wagerRepository.findByIdForUpdate(wagerId, market.id, userId, client);
    if (!wager) throw new NotFoundError('Aposta não encontrada.'); // 404, não 403
    if (wager.status !== 'pending') throw new ConflictError('Essa aposta não pode mais ser cancelada.');

    // CANCEL-06: bloqueio TOTAL se qualquer cashout já ocorreu.
    if (Number(wager.cashed_out_amount) > 0) {
      throw new ConflictError('Não é possível cancelar: essa aposta já teve um cashout realizado.');
    }

    // CANCEL-03: fórmula defensiva (sempre === wager.amount dado o bloqueio acima).
    const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);
    const { fee, net } = money.applyFeePercent(remainingStake, env.CANCEL_FEE_PERCENT);

    await wagerRepository.updateStatus(wagerId, 'refunded', client); // reuse existing status value — Pitfall 3

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

**Error handling pattern:** Uses the same error classes already imported in `wagerService.js` (`NotFoundError`, `ConflictError` — note the rewrite drops `AuthorizationError` since ownership is now enforced by the lock query returning `null` → `NotFoundError`, avoiding existence leakage). No try/catch — errors propagate to `catchAsync` in the controller and `errorHandler.js` middleware, exactly like `cashoutWager`.

**Event-emission pattern:** `domainEvents.emit('wager.cancelled', {...})` is called AFTER the transaction commits (not inside it), matching `cashoutWager`'s existing `domainEvents.emit(...)` placement pattern in the same file. `notificationService.js` already has a `wager.cancelled` listener wired from Phase 1 — no new wiring needed.

---

### `src/config/env.js` (config — optional `CANCEL_FEE_PERCENT` addition)

**Analog:** `src/config/env.js` lines 37, 51-63 (`CASHOUT_FEE_PERCENT`, verified current)

**Definition pattern** (line 37):
```javascript
CASHOUT_FEE_PERCENT: parseFloat(process.env.CASHOUT_FEE_PERCENT || '0'),
```
New line, same shape but default `'5'` per requirement:
```javascript
CANCEL_FEE_PERCENT: parseFloat(process.env.CANCEL_FEE_PERCENT || '5'),
```

**Bounds-validation pattern** (lines 51-63):
```javascript
// CASHOUT_FEE_PERCENT precisa estar em [0, 100] em QUALQUER ambiente (não só
// produção): money.applyFeePercent computa fee = gross * (feePercent / 100)
// sem clamp, então um valor acima de 100 (ex.: operador digitando 500 em vez
// de 5) faz `fee > gross`, e `net = gross - fee` fica NEGATIVO — cashoutWager
// silenciosamente um "cashout" (que deveria creditar) num débito. Um valor
// não-numérico (parseFloat retornando NaN) é igualmente perigoso e também é
// rejeitado aqui.
if (!Number.isFinite(env.CASHOUT_FEE_PERCENT) || env.CASHOUT_FEE_PERCENT < 0 || env.CASHOUT_FEE_PERCENT > 100) {
  throw new Error(
    `Invalid CASHOUT_FEE_PERCENT: "${process.env.CASHOUT_FEE_PERCENT}" — must be a number between 0 and 100.`
  );
}
```
Duplicate this block (or generalize into a shared validator) for `CANCEL_FEE_PERCENT`, same `[0,100]` bounds, same startup-crash-on-invalid semantics.

**Note:** This addition is discretionary (Open Question 2 in RESEARCH.md — hardcode `0.05`/`0.95` inline is the simpler alternative). Planner should pick one; if hardcoded, skip this file entirely.

---

## Shared Patterns

### Transactional lock order: market → wager → wallet
**Source:** `src/services/wagerService.js#cashoutWager` (lines 193-211+), also used by `placeWager`, `resolveMarket`, `deleteMarket` (see `src/services/marketService.js`)
**Apply to:** The rewritten `cancelWager` — this is the single most important cross-cutting fix in this phase (Pitfall 2, CANCEL-07).
```javascript
const peek = await client.query('SELECT market_id FROM wagers WHERE id = $1;', [wagerId]);
const market = await marketRepository.findByIdForUpdate(peek.rows[0].market_id, client);
const wager = await wagerRepository.findByIdForUpdate(wagerId, market.id, userId, client);
const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
```

### IDOR-hardened row lock (404 not 403)
**Source:** `src/repositories/wagerRepository.js:46-52` (`findByIdForUpdate`)
**Apply to:** `cancelWager` — replaces the old lock-then-check-`user_id`-afterward pattern. Ownership is baked into the `WHERE` clause; a non-owner or non-existent wager both return `null` → `NotFoundError` (404), never leaking existence via a 403.

### Fee/net split via `money.applyFeePercent`
**Source:** `src/utils/money.js:44-47`
**Apply to:** `cancelWager`'s fee computation — never hand-roll `amount * 0.95` with raw floats; always route through this cents-based, `Number.EPSILON`-safe utility, exactly as `cashoutWager` already does for `CASHOUT_FEE_PERCENT`.

### Wallet mutation + audit trail
**Source:** `src/repositories/walletRepository.js` — `findByUserIdForUpdate`, `adjustBalance`, `recordTransaction` (used identically by both `cashoutWager` and the current `cancelWager`)
**Apply to:** `cancelWager`'s refund step — `recordTransaction` with `type: 'refund'`, populated `balanceBefore`/`balanceAfter`, `relatedEntity: 'wager'`, `relatedId: wager.id`, and a `description` that documents the gross/fee/net breakdown for human audit readability (satisfies CANCEL-04 — no `audit_logs` table insert needed, per Pitfall 4/A3).

### Domain event emission after commit
**Source:** `src/services/wagerService.js#cashoutWager` and current `cancelWager` (both emit via `domainEvents.emit(...)` after the `transaction()` call resolves, not inside it)
**Apply to:** `cancelWager` — keep `domainEvents.emit('wager.cancelled', {...})` post-commit; `notificationService.js` already listens for this event (Phase 1), no new wiring required.

## No Analog Found

None — every file this phase touches has a direct, exact-match analog already in the same file or an immediately adjacent one. This is an in-place rewrite/hardening of existing, previously-shipped logic, not new infrastructure.

## Metadata

**Analog search scope:** `src/services/wagerService.js` (full file, both `cancelWager` and `cashoutWager`), `src/repositories/wagerRepository.js`, `src/repositories/marketRepository.js`, `src/utils/money.js`, `src/config/env.js`, `src/controllers/wagersController.js`, `public/js/dashboard.js` (excerpts)
**Files scanned:** 7 (all read directly this session; RESEARCH.md's own "Sources" section independently verified the same set in the prior research pass)
**Pattern extraction date:** 2026-07-15
</content>
