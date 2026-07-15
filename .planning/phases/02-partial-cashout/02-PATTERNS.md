# Phase 2: Partial Cashout - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 9 (1 migration, 1 new util, 3 repository files, 2 service files, 1 controller, 1 route)
**Analogs found:** 9 / 9 (all files have a strong same-codebase analog — no new-framework research needed)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/migrations/004_cashout.js` | migration | CRUD (DDL) | `src/migrations/003_notifications.js` (new table + UNIQUE) and `002_wallet.js` (money columns + trigger) | exact |
| `src/utils/money.js` | utility | transform | none in-repo (first money utility) — spec is fully given in RESEARCH.md Code Examples | no analog (use RESEARCH.md spec verbatim) |
| `src/repositories/cashoutRepository.js` | repository | CRUD + idempotency | `src/repositories/notificationRepository.js` (`create` + 23505 semantics) blended with `walletRepository.js` (transactional `client`-param CRUD) | role-match (composite) |
| `src/repositories/wagerRepository.js` (add `findByIdForUpdate`) | repository | CRUD | itself — `findPendingByMarket` (existing `FOR UPDATE` method in same file) | exact |
| `src/repositories/marketRepository.js` (add `findByIdForUpdate`) | repository | CRUD | itself — `resolve`/`updateStatus` (existing `client`-param methods in same file); lock SQL currently inlined in `wagerService.js`/`marketService.js` | exact |
| `src/services/wagerService.js` (add `cashoutWager`) | service | CRUD (financial transaction) | itself — `placeWager` and `cancelWager` in the same file/class | exact |
| `src/services/marketService.js` (modify `resolveMarket` payout line) | service | CRUD (financial transaction) | itself — `resolveMarket` (lines 116-193), the method being edited | exact |
| `src/services/notificationService.js` (add `wager.cashed_out` listener) | service | event-driven | itself — `register()`'s existing `domainEvents.on('wager.won', ...)` block (lines 62-70) | exact |
| `src/controllers/wagersController.js` (add `cashoutWager`) | controller | request-response | itself — `cancelWager` handler (lines 15-18) | exact |
| `src/routes/wagers.js` (add `POST /:id/cashout`) | route | request-response | itself — `router.delete('/:id', requireAuth, wagersController.cancelWager)` | exact |

## Pattern Assignments

### `src/migrations/004_cashout.js` (migration)

**Analogs:** `src/migrations/002_wallet.js` (lines 1-71), `src/migrations/003_notifications.js` (lines 1-33)

**Module shape** (copy exactly — `id`, `up` array of SQL strings, `down` array, reverse order):
```javascript
// src/migrations/003_notifications.js lines 26-32
module.exports = {
  id: '003_notifications',
  up: migrations,
  down: [
    'DROP TABLE IF EXISTS notifications;',
  ],
};
```

**New table + idempotency UNIQUE constraint pattern** (copy shape from notifications' `UNIQUE(user_id, type, related_entity, related_id)`, lines 8-19 of `003_notifications.js`):
```sql
CREATE TABLE IF NOT EXISTS wager_cashouts (
  id SERIAL PRIMARY KEY,
  wager_id INTEGER NOT NULL REFERENCES wagers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stake_cashed_out NUMERIC(15, 2) NOT NULL CHECK (stake_cashed_out > 0),
  gross_value NUMERIC(15, 2) NOT NULL,
  fee_amount NUMERIC(15, 2) NOT NULL,
  net_value NUMERIC(15, 2) NOT NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (wager_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_wager_cashouts_wager_id ON wager_cashouts(wager_id);
```

**Money-column NUMERIC precision convention** (copy from `002_wallet.js` line 11): `NUMERIC(15, 2)`, matching `wallets.balance`/`wallet_transactions.amount` — do not use a different precision.

**New column on existing table** (append to migration, no ALTER precedent exists yet in-repo but is standard Postgres — keep the same `IF NOT EXISTS`-safe defensive style used throughout):
```sql
ALTER TABLE wagers ADD COLUMN IF NOT EXISTS cashed_out_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;
```

**Down migration** (mirror, reverse order, per `003_notifications.js` line 29-31 and `002_wallet.js` lines 63-70):
```javascript
down: [
  'ALTER TABLE wagers DROP COLUMN IF EXISTS cashed_out_amount;',
  'DROP TABLE IF EXISTS wager_cashouts;',
],
```

Do **not** touch `wallet_transactions.type`'s CHECK constraint (Pitfall 4) — reuse `type = 'credit'`.

---

### `src/utils/money.js` (utility, transform)

**No in-repo analog exists** — this is the first shared money-math utility (confirmed by RESEARCH.md: only prior money math is inline `Math.round(wagerAmount * odds * 100) / 100` at `src/services/wagerService.js:38`, which is the anti-pattern this file replaces).

Use the exact spec already fully worked out in `02-RESEARCH.md`'s "Code Examples" section (`toCents`, `fromCents`, `multiply`, `subtract`, `applyFeePercent`) — copy verbatim, it is complete and self-contained (zero dependencies, matches `NUMERIC(12,2)`/`NUMERIC(15,2)` precision already used everywhere in the schema).

**Module export style convention** (match plain function-object export like `src/utils/errors.js` lines 68-76, NOT a class singleton — `money.js` has no state, so it should follow `errors.js`'s named-exports-object shape, not `walletRepository.js`'s `new X()` singleton shape):
```javascript
module.exports = { toCents, fromCents, multiply, subtract, applyFeePercent };
```

---

### `src/repositories/cashoutRepository.js` (repository, CRUD + idempotency)

**Analog 1 — idempotent create + 23505 semantics:** `src/repositories/notificationRepository.js` lines 3-17 (comment explains the `.code === '23505'` contract):
```javascript
// src/repositories/notificationRepository.js lines 4-17
// Insere uma notificação. Sem transação (grava é desacoplada da ação que
// disparou o evento por design — ver D-01). Uma segunda chamada com a
// mesma (userId, type, relatedEntity, relatedId) colide com a constraint
// UNIQUE e lança um erro com `.code === '23505'`; quem chama decide o que
// fazer com isso (notificationService trata como idempotência).
async create({ userId, type, title, body, relatedEntity, relatedId }) {
  const result = await query(
    `INSERT INTO notifications (user_id, type, title, body, related_entity, related_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *;`,
    [userId, type, title, body || null, relatedEntity || null, relatedId || null]
  );
  return result.rows[0];
}
```
**Key difference for cashout:** unlike `notificationRepository.create`, `cashoutRepository.create` MUST accept and use the transactional `client` param (it runs inside `wagerService.cashoutWager`'s `transaction()`, not standalone) — follow `walletRepository.recordTransaction(..., client)`'s signature shape instead (analog 2 below) for the `client`-param convention, while keeping analog 1's 23505-friendly INSERT shape.

**Analog 2 — `client`-param CRUD inside a transaction:** `src/repositories/walletRepository.js` lines 10-25 (`adjustBalance`, `recordTransaction` both take `client` as last param, always `client.query(...)`, never the bare `query` import):
```javascript
// src/repositories/walletRepository.js lines 18-25
async recordTransaction({ walletId, type, amount, balanceBefore, balanceAfter, relatedEntity, relatedId, description, adminId }, client) {
  await client.query(
    `INSERT INTO wallet_transactions
       (wallet_id, type, amount, balance_before, balance_after, related_entity, related_id, description, admin_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
    [walletId, type, amount, balanceBefore, balanceAfter, relatedEntity || null, relatedId || null, description || null, adminId || null]
  );
}
```

**Needed methods:** `create({wagerId, userId, stakeCashedOut, grossValue, feeAmount, netValue, idempotencyKey}, client)` (RETURNING *, let 23505 bubble to caller per Pattern 2 in RESEARCH.md — do NOT catch it here, catch it in the service, matching where `notificationService.notify()` — not `notificationRepository.create()` — does the catching); `findByIdempotencyKey(wagerId, idempotencyKey, client)` (plain SELECT, `client.query`).

**Class/export shape** (copy exactly): singleton instance export, per every repository in the codebase:
```javascript
module.exports = new WalletRepository(); // walletRepository.js line 28 — same pattern for cashoutRepository
```

---

### `src/repositories/wagerRepository.js` — add `findByIdForUpdate(id, client)`

**Analog:** itself, `findPendingByMarket` (lines 28-34) — same file, same `FOR UPDATE` + `client.query` shape:
```javascript
// src/repositories/wagerRepository.js lines 28-34
async findPendingByMarket(marketId, client) {
  const result = await client.query(
    "SELECT * FROM wagers WHERE market_id = $1 AND status = 'pending' FOR UPDATE;",
    [marketId]
  );
  return result.rows;
}
```
New method should mirror this exactly but by `id`, with ownership baked into WHERE per RESEARCH.md Pattern 1 (`WHERE id = $1 AND market_id = $2 AND user_id = $3 FOR UPDATE`) — this is the IDOR-safe query RESEARCH.md's Architecture Patterns section already writes out in full (see `cashoutWager` example, lines 248-252 of `02-RESEARCH.md`).

---

### `src/repositories/marketRepository.js` — add `findByIdForUpdate(id, client)`

**Analog:** itself, `resolve` (lines 34-41) — same file, same `client.query` + `FOR UPDATE`-adjacent shape (currently the literal `SELECT * FROM markets WHERE id = $1 FOR UPDATE;` is inlined at 4 call sites — `wagerService.js:24`, `wagerService.js:84`, `marketService.js:117`, `marketService.js:198` — this new method DRYs those, per RESEARCH.md's "Recommended Project Structure" note):
```javascript
// src/repositories/marketRepository.js lines 34-41 (existing sibling method, same client-param shape to copy)
async resolve(id, outcome, client) {
  const result = await client.query(
    `UPDATE markets SET status = 'resolved', outcome = $1, resolved_at = CURRENT_TIMESTAMP
     WHERE id = $2 RETURNING *;`,
    [outcome, id]
  );
  return result.rows[0] || null;
}
```
New method:
```javascript
async findByIdForUpdate(id, client) {
  const result = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [id]);
  return result.rows[0] || null;
}
```

---

### `src/services/wagerService.js` — add `cashoutWager(wagerId, userId, { amount, idempotencyKey })`

**Analog:** itself — `placeWager` (lines 11-73) and `cancelWager` (lines 76-124), same class `WagerService`, same file.

**Imports pattern already present at top of file** (no new imports needed except `cashoutRepository` and `money`):
```javascript
// src/services/wagerService.js lines 1-7
const { transaction } = require('../config/database');
const wagerRepository = require('../repositories/wagerRepository');
const walletRepository = require('../repositories/walletRepository');
const userRepository = require('../repositories/userRepository');
const domainEvents = require('../events/domainEvents');
const { ValidationError, NotFoundError, ConflictError, AuthorizationError } = require('../utils/errors');
const logger = require('../utils/logger');
```
Add: `const marketRepository = require('../repositories/marketRepository');`, `const cashoutRepository = require('../repositories/cashoutRepository');`, `const money = require('../utils/money');`.

**Lock-then-revalidate + transaction() + emit-after-commit pattern** (copy exact shape from `placeWager`, lines 23-72 — note the `let marketQuestion;` hoisted-outside-transaction var, and the `domainEvents.emit(...)` call placed strictly AFTER `await transaction(...)` resolves, never inside the closure):
```javascript
// src/services/wagerService.js lines 21-73 (placeWager, full method — the closest
// structural analog: validate → transaction(lock, revalidate, mutate) → emit after commit)
let marketQuestion;

const wager = await transaction(async (client) => {
  const marketResult = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [marketId]);
  const market = marketResult.rows[0];
  if (!market) throw new NotFoundError('Mercado não encontrado.');
  if (market.status !== 'open') throw new ConflictError('Esse mercado não está mais aberto para apostas.');
  // ... business mutation inside client-scoped calls ...
  return createdWager;
});

// Emitido só depois do commit (D-01): um rollback nunca deve deixar um
// evento "fantasma" sem linha correspondente no banco.
domainEvents.emit('wager.placed', { wagerId: wager.id, userId, marketId, question: marketQuestion, choice, amount: wagerAmount });

return wager;
```

**Full concrete `cashoutWager` shape is already written out in `02-RESEARCH.md`** (Architecture Patterns, Pattern 1, lines 221-271) — including the market→wager→wallet lock order, ownership-in-WHERE, `remainingStake` guard, and idempotency 23505-catch (Pattern 2, lines 279-296). Follow it verbatim; it was synthesized directly from this file's own `placeWager`/`cancelWager` shape plus `marketService.resolveMarket`.

**Ownership-in-WHERE convention** (copy from `cancelWager`'s existing precedent, though note RESEARCH.md's cashout version bakes ownership into the lock query itself rather than checking after, per IDOR mitigation table):
```javascript
// src/services/wagerService.js lines 78-81 (cancelWager) — ownership checked AFTER lock here;
// cashoutWager should instead bake it into the WHERE clause per RESEARCH.md Pattern 1 (stronger)
if (wager.user_id !== userId) throw new AuthorizationError('Essa aposta não é sua.');
```

---

### `src/services/marketService.js` — modify `resolveMarket()` payout line

**Analog:** itself — the method being edited, lines 111-193, specifically the win-branch payout at line 135:
```javascript
// src/services/marketService.js line 135 — CURRENT (pre-cashout) code, must change
const updated = await walletRepository.adjustBalance(wallet.id, wager.potential_payout, client);
```
**Required change** (per RESEARCH.md Pitfall 2): compute remaining-fraction payout via `money.js`, not raw `wager.potential_payout`:
```javascript
// Pattern from RESEARCH.md Pitfall 2 — remaining fraction = (amount - cashed_out_amount) / amount;
// remaining payout = potential_payout * remainingFraction, computed via money.js, not raw float math.
const remainingFraction = (Number(wager.amount) - Number(wager.cashed_out_amount)) / Number(wager.amount);
const remainingPayout = money.multiply(wager.potential_payout, remainingFraction);
// then: walletRepository.adjustBalance(wallet.id, remainingPayout, client)
```
This must reduce to the exact current behavior when `cashed_out_amount = 0` (RESEARCH.md's Wave 0 test gap explicitly requires a regression test for this). Keep everything else in `resolveMarket` (the `outcomes.push(...)` collection-then-emit-after-commit shape, lines 125-192) unchanged.

---

### `src/services/notificationService.js` — add `wager.cashed_out` listener

**Analog:** itself — the existing `wager.won` listener block, lines 62-70 (closest analog: single-recipient `evt.userId`, not the multi-recipient `evt.recipients` loop used by `market.closed`/`market.resolved`/`market.deleted`):
```javascript
// src/services/notificationService.js lines 62-70
domainEvents.on('wager.won', safeHandler(async (evt) => {
  await notify(evt.userId, {
    type: 'wager.won',
    title: 'Você ganhou!',
    body: `Sua aposta de R$${evt.amount.toFixed(2)} em "${evt.question}" venceu! +R$${evt.payout.toFixed(2)}`,
    relatedEntity: 'wager',
    relatedId: evt.wagerId,
  });
}));
```
**Critical deviation (Pitfall 3):** the new listener MUST use `relatedEntity: 'cashout'` and `relatedId: evt.cashoutId` — NOT `relatedEntity: 'wager'` / `relatedId: evt.wagerId` — because a wager can be cashed out more than once and `wagerId` would collide with the `UNIQUE(user_id, type, related_entity, related_id)` constraint (`003_notifications.js` line 18), silently swallowing the 2nd+ notification via the existing 23505-catch-as-no-op in `notify()` (lines 26-36 of this same file). The exact code is already written in `02-RESEARCH.md`'s Code Examples section — copy verbatim:
```javascript
domainEvents.on('wager.cashed_out', safeHandler(async (evt) => {
  await notify(evt.userId, {
    type: 'wager.cashed_out',
    title: 'Cashout realizado',
    body: `Você sacou R$${evt.netValue.toFixed(2)} da sua aposta em "${evt.question}". O restante continua ativo.`,
    relatedEntity: 'cashout',     // NOT 'wager'
    relatedId: evt.cashoutId,     // NOT evt.wagerId
  });
}));
```
Insert this block inside `register()` alongside the other `.on(...)` calls, additive-only — no fixed switch statement to update (D-06 convention, confirmed by this file's structure).

---

### `src/controllers/wagersController.js` — add `cashoutWager` handler

**Analog:** itself — `cancelWager` handler, lines 15-18:
```javascript
// src/controllers/wagersController.js lines 12-18
/**
 * DELETE /api/wagers/:id - cancela a própria aposta
 */
const cancelWager = catchAsync(async (req, res) => {
  const result = await wagerService.cancelWager(Number(req.params.id), req.user.id);
  res.json(result);
});
```
New handler (same `catchAsync` wrap, same `Number(req.params.id)` coercion, `req.user.id` never trusted from body, destructure only expected body fields per RESEARCH.md's mass-assignment mitigation):
```javascript
const cashoutWager = catchAsync(async (req, res) => {
  const { amount, idempotency_key } = req.body;
  const result = await wagerService.cashoutWager(Number(req.params.id), req.user.id, { amount, idempotencyKey: idempotency_key });
  res.json(result);
});
```
Add to the `module.exports` object (line 28-32), same shape.

---

### `src/routes/wagers.js` — add `POST /:id/cashout`

**Analog:** itself — the whole file (12 lines), specifically the `router.delete('/:id', ...)` line:
```javascript
// src/routes/wagers.js full file, lines 1-12
const express = require('express');
const wagersController = require('../controllers/wagersController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/user/:username', requireAuth, wagersController.getUserWagers);
router.post('/', requireAuth, wagersController.placeWager);
router.delete('/:id', requireAuth, wagersController.cancelWager);

module.exports = router;
```
Add: `router.post('/:id/cashout', requireAuth, wagersController.cashoutWager);` — same `requireAuth` middleware, no new middleware needed.

---

## Shared Patterns

### Transaction + row-lock + emit-after-commit (D-01)
**Source:** `src/config/database.js` lines 48-61 (`transaction()` helper) + `src/services/wagerService.js` lines 23-73 (`placeWager`) + `src/services/marketService.js` lines 116-193 (`resolveMarket`)
**Apply to:** `wagerService.cashoutWager`, and the modified `marketService.resolveMarket`
```javascript
const result = await transaction(async (client) => {
  // all locks (FOR UPDATE) + mutations here, using client.query / repo methods with client param
  return { /* data needed for the emit, captured now — never re-queried after commit */ };
});
domainEvents.emit('event.name', { /* built from `result`, only after transaction() resolves */ });
```

### Fixed lock ordering across financial flows
**Source:** RESEARCH.md Pitfall 1, grounded in `wagerService.js` lines 24/84 and `marketService.js` lines 117/198
**Apply to:** `cashoutWager` must lock `markets` → `wagers` → `wallets` (matching `placeWager`/`resolveMarket`/`deleteMarket`, NOT `cancelWager`'s wager→market order).

### Ownership baked into locking WHERE clause (IDOR mitigation)
**Source:** RESEARCH.md Pattern 1 code example, `src/services/wagerService.js` `cancelWager`'s existing (weaker, post-lock) ownership check at line 81
**Apply to:** `cashoutWager`'s wager-lock query: `WHERE id = $1 AND market_id = $2 AND user_id = $3 FOR UPDATE`

### Idempotent-create-then-23505-catch
**Source:** `src/services/notificationService.js` lines 26-36 (no-op variant) — cashout needs the **replay-existing-result** variant, spelled out in RESEARCH.md Pattern 2 (lines 279-296)
**Apply to:** `cashoutRepository.create` call inside `cashoutWager`'s transaction body — catch `err.code === '23505'`, call `cashoutRepository.findByIdempotencyKey(...)`, return that instead of re-applying wallet mutations.

### Wallet mutation always via repository, never direct UPDATE
**Source:** `src/repositories/walletRepository.js` lines 10-25 (`adjustBalance` + `recordTransaction`), used identically at all 4 existing call sites (`placeWager`, `cancelWager`, `resolveMarket`, `deleteMarket`)
**Apply to:** `cashoutWager`'s wallet credit — `type: 'credit'`, `relatedEntity: 'cashout'`, `relatedId: cashout.id` (per Pitfall 4, do not add a new `wallet_transactions.type` CHECK value).

### Custom error classes, no raw throws
**Source:** `src/utils/errors.js` (full file) — `ValidationError`(400)/`NotFoundError`(404)/`ConflictError`(409)/`AuthorizationError`(403), all used consistently across `wagerService.js`/`marketService.js`
**Apply to:** every validation branch in `cashoutWager` (see RESEARCH.md's fully-written example, which already uses these exact classes).

### `catchAsync` wrapper, no try/catch in controllers/routes
**Source:** `src/controllers/wagersController.js` lines 1-2, 7-10, 15-18 (`catchAsync` import + every handler wrapped)
**Apply to:** new `cashoutWager` controller handler.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/utils/money.js` | utility | transform | First shared money-math utility in the project — no prior file to copy from (only prior money-math was scattered inline `Math.round` calls). Use the complete spec already given in `02-RESEARCH.md`'s Code Examples section verbatim instead of an in-repo analog. |

## Metadata

**Analog search scope:** `src/services/`, `src/repositories/`, `src/controllers/`, `src/routes/`, `src/migrations/`, `src/utils/`, `src/config/database.js`
**Files scanned:** `wagerService.js`, `marketService.js`, `wagerRepository.js`, `walletRepository.js`, `marketRepository.js`, `notificationRepository.js`, `notificationService.js`, `wagersController.js`, `wagers.js`, `database.js`, `errors.js`, `002_wallet.js`, `003_notifications.js` (13 files, all read in full this session)
**Pattern extraction date:** 2026-07-14
