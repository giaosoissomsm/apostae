# Phase 1: Notifications Infrastructure - Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** 9 (new) + 2 (modified) + 1 (modified: server.js)
**Analogs found:** 9 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/events/domainEvents.js` | utility (event bus) | event-driven | none in codebase (net-new pattern) | no-analog (see below) |
| `src/migrations/003_notifications.js` | migration | batch (DDL) | `src/migrations/002_wallet.js` | exact |
| `src/repositories/notificationRepository.js` | model/repository | CRUD | `src/repositories/walletRepository.js` | exact |
| `src/services/notificationService.js` | service | event-driven + CRUD | `src/services/wagerService.js` (CRUD/transaction shape) + new event-driven registration (no analog) | role-match |
| `src/controllers/notificationsController.js` | controller | request-response | `src/controllers/wagersController.js` | exact |
| `src/routes/notifications.js` | route | request-response | `src/routes/wagers.js` | exact |
| `server.js` (modified) | config/bootstrap | request-response + event-driven | `server.js` itself (existing route-mount + scheduler-start block) | exact |
| `src/services/marketService.js` (modified) | service | CRUD + event-driven (emit after transaction) | itself — extend existing `closeMarket`/`resolveMarket`/`deleteMarket` | exact |
| `src/services/wagerService.js` (modified) | service | CRUD + event-driven (emit after transaction) | itself — extend existing `placeWager`/`cancelWager` | exact |

## Pattern Assignments

### `src/events/domainEvents.js` (utility, event-driven)

**Analog:** None exists in this codebase (this is the first EventEmitter-based pub/sub in the project). Use Node core `events` module directly per RESEARCH.md Pattern 1. This is confirmed safe: no npm dependency needed, `module.exports = new EventEmitter()` gives every requirer the same singleton (Node module caching).

**Required shape** (from RESEARCH.md, verified against Node semantics):
```javascript
const { EventEmitter } = require('events');
const domainEvents = new EventEmitter();

// REQUIRED: prevents an unhandled 'error' event from crashing the whole process
domainEvents.on('error', (err) => {
  require('../utils/logger').error('domainEvents listener error', err);
});

module.exports = domainEvents;
```

**Logger conventions to match** — check `src/utils/logger.js` call signature used elsewhere: `logger.info(...)`, `logger.warn(...)`, `logger.error(msg, meta)` (seen in `src/middleware/errorHandler.js` lines 15-19 and `src/services/wagerService.js` line 91, `src/services/marketService.js` lines 83, 133, 165).

---

### `src/migrations/003_notifications.js` (migration, batch)

**Analog:** `src/migrations/002_wallet.js` (full file read above, 72 lines)

**Structure to copy exactly** (lines 1-72):
- Header comment block (migration number + one-line Portuguese description), e.g.:
  ```javascript
  /**
   * Migration 003: Sistema de Notificações
   * Cria tabela para notificações de eventos de apostas e mercados
   */
  ```
- `const migrations = [ ... ]` — array of raw SQL strings, one array element per logical DDL group (table + its indexes together, as in `002_wallet.js` lines 8-17 combining `CREATE TABLE` + `CREATE INDEX` in one string)
- Export shape (lines 60-71):
  ```javascript
  module.exports = {
    id: '003_notifications',
    up: migrations,
    down: [
      'DROP TABLE IF EXISTS notifications;',
    ],
  };
  ```
- Column/index conventions to mirror from `002_wallet.js`:
  - `id SERIAL PRIMARY KEY`
  - `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` (line 10 pattern)
  - `related_entity VARCHAR(50)` / `related_id INTEGER` pair, with inline comment showing valid values (line 27: `-- 'wager', 'market_resolved', 'admin_adjustment', etc`)
  - `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP` (line 14, 31)
  - Indexes as separate `CREATE INDEX IF NOT EXISTS idx_<table>_<col> ON <table>(<col>);` statements appended to the same array-element string (lines 17, 33-36)

**Notifications-specific schema** (per RESEARCH.md/CONTEXT.md D-03, D-08, Pattern 2/5 — not present in analog but required by this phase):
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT,
  related_entity VARCHAR(50),
  related_id INTEGER,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, type, related_entity, related_id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
```
Note: `read_at TIMESTAMP` nullable (not a boolean) mirrors the `deleted_at`/`resolved_at` idiom already used elsewhere in the codebase — confirm exact idiom name against `001_initial.js` if further precedent needed (not re-read here; `002_wallet.js` establishes the `updated_at`/timestamp-column convention sufficiently).

**Migration runner:** confirm `scripts/migrate.js` auto-discovers files by filename pattern (`00N_*.js`) in `src/migrations/` — verify next sequential number is `003` (confirmed: only `001_initial.js` and `002_wallet.js` exist).

---

### `src/repositories/notificationRepository.js` (repository, CRUD)

**Analog:** `src/repositories/walletRepository.js` (full file, 29 lines)

**Imports pattern** (line 1 — none; file has zero imports, uses `client.query` passed in directly): notifications repository will need `query` from `../config/database` for non-transactional reads (list/count/unread-count), since RESEARCH.md Pattern 1 explicitly says notification writes are NOT wrapped in `transaction()` (decoupled from the triggering transaction by design).

**Class + method shape** (lines 1-28):
```javascript
class WalletRepository {
  async findByUserIdForUpdate(userId, client) {
    const result = await client.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE;',
      [userId]
    );
    return result.rows[0] || null;
  }
  ...
}
module.exports = new WalletRepository();
```
— singleton instance export (`new ClassName()`), one method per operation, always parameterized queries (`$1`, `$2`, ...), always `result.rows[0] || null` for single-row lookups.

**recordTransaction as INSERT-with-named-object-param analog** (lines 18-25) — directly informs `create()`:
```javascript
async recordTransaction({ walletId, type, amount, balanceBefore, balanceAfter, relatedEntity, relatedId, description, adminId }, client) {
  await client.query(
    `INSERT INTO wallet_transactions
       (wallet_id, type, amount, balance_before, balance_after, related_entity, related_id, description, admin_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
    [walletId, type, amount, balanceBefore, balanceAfter, relatedEntity || null, relatedId || null, description || null, adminId || null]
  );
}
```
Copy this exact destructured-object-param + `|| null` coalescing style for `notificationRepository.create({ userId, type, title, body, relatedEntity, relatedId })`.

**Required methods for this phase** (per RESEARCH.md Pattern 4/5, D-08):
- `create({ userId, type, title, body, relatedEntity, relatedId })` — plain `INSERT`, no transaction; caller (`notificationService`) catches `23505`
- `findByUserId(userId, { page, limit, unreadOnly })` — bounded `LIMIT`/`OFFSET`, `ORDER BY created_at DESC, id DESC`, always `WHERE user_id = $1`
- `markRead(id, userId)` — `UPDATE ... WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING *` (ownership + idempotent-if-already-read baked into WHERE)
- `findById(id, userId)` — for the "already read" idempotent-success disambiguation in the service layer
- `countUnread(userId)` — for `GET /unread-count`

**Ownership-scoping is non-negotiable** on every method taking `id` — see Shared Patterns below.

---

### `src/services/notificationService.js` (service, event-driven + CRUD)

**Analog (CRUD/transaction conventions):** `src/services/wagerService.js` — class shape, `require` block (lines 1-6), Portuguese doc-comments above methods (line 9, 57), throwing typed errors from `../utils/errors` (lines 14-18, 62-64).

**No direct analog for the event-listener-registration half** — this is net-new. Follow RESEARCH.md's concrete code exactly (already grounded against this repo's `errorHandler.js` `23505`/`'P'`-prefix gotcha, verified true at `src/middleware/errorHandler.js` line 42: `if (err.code && err.code.startsWith('P'))` — Postgres unique-violation code is `'23505'`, which does NOT start with `'P'`, so it would NOT be caught by this branch and would fall through to the generic 500 branch if allowed to propagate).

**Imports pattern** (from `wagerService.js` lines 1-6, adapted):
```javascript
const domainEvents = require('../events/domainEvents');
const notificationRepository = require('../repositories/notificationRepository');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');
```

**Error class reuse** (`src/utils/errors.js` lines 44-48): use `NotFoundError` (404) for mark-read-on-nonexistent-or-not-owned — matches this codebase's existing precedent of `AuthorizationError` for ownership mismatches on wagers (`wagerService.js` line 63: `if (wager.user_id !== userId) throw new AuthorizationError(...)`), but RESEARCH.md Pattern 4 explicitly directs **404-not-403** for notifications specifically (don't leak existence). This is an intentional deviation from the wager precedent, not an oversight — the planner/executor should not "fix" it to match wagers.

**Core event-driven + idempotency pattern** — copy directly from RESEARCH.md Pattern 1/2 code blocks (already codebase-grounded):
```javascript
function safeHandler(fn) {
  return async (payload) => {
    try {
      await fn(payload);
    } catch (err) {
      logger.error('notificationService listener failed', { err: err.message, payload });
    }
  };
}

async function notify(userId, { type, title, body, relatedEntity, relatedId }) {
  try {
    await notificationRepository.create({ userId, type, title, body, relatedEntity, relatedId });
  } catch (err) {
    if (err.code === '23505') {
      logger.debug(`Notificação duplicada ignorada: ${type} ${relatedEntity}#${relatedId} usuário ${userId}`);
      return;
    }
    throw err;
  }
}

function register() {
  domainEvents.on('wager.won', safeHandler(async (evt) => {
    await notify(evt.userId, {
      type: 'wager.won',
      title: 'Você ganhou!',
      body: `Sua aposta de R$${evt.amount.toFixed(2)} em "${evt.question}" venceu! +R$${evt.payout.toFixed(2)}`,
      relatedEntity: 'wager',
      relatedId: evt.wagerId,
    });
  }));
  // ...same shape for wager.lost, wager.cancelled, wager.placed, market.closed, market.resolved, market.deleted
}
```

**Portuguese tone reference for message copy** (D-09) — pull exact phrasing style from:
- `wagerService.js` line 91: `` `Usuário ${userId} cancelou a aposta #${wagerId}` `` (log tone)
- `walletRepository` call sites in `wagerService.js` line 50: `` `Aposta #${wager.id} no mercado #${marketId}` `` and line 88: `` `Cancelamento da aposta #${wager.id}` ``
- `marketService.js` line 126: `` `Pagamento da aposta #${wager.id} (mercado #${market.id})` `` and line 158: `` `Reembolso da aposta #${wager.id} (mercado #${market.id} deletado)` ``
User-facing notification body text should read naturally (not log-terse) but keep the same `#id`/`R$amount` formatting convention.

**Required service methods:** `register()` (called once at bootstrap), `notify(userId, evt)` (internal, idempotent), `listForUser(userId, { page, limit, unreadOnly })`, `markRead(id, userId)`, `getUnreadCount(userId)`.

---

### `src/controllers/notificationsController.js` (controller, request-response)

**Analog:** `src/controllers/wagersController.js` (full file, 33 lines)

**Exact pattern to copy** (lines 1-32):
```javascript
const wagerService = require('../services/wagerService');
const { catchAsync } = require('../middleware/errorHandler');

const placeWager = catchAsync(async (req, res) => {
  const wager = await wagerService.placeWager(req.user.id, req.body);
  res.status(201).json(wager);
});

const cancelWager = catchAsync(async (req, res) => {
  const result = await wagerService.cancelWager(Number(req.params.id), req.user.id);
  res.json(result);
});

module.exports = { placeWager, cancelWager, getUserWagers };
```
Key conventions: `catchAsync` wrapper on every handler (no manual try/catch in controllers), `req.user.id` — never `req.body.userId` or `req.params.userId` — as the identity source (line 8, 16), `Number(req.params.id)` coercion before passing to service (line 16), plain `res.json(...)` / `res.status(201).json(...)` — no custom envelope.

**Apply to notifications:**
```javascript
const notificationService = require('../services/notificationService');
const { catchAsync } = require('../middleware/errorHandler');

const listMyNotifications = catchAsync(async (req, res) => {
  const { page, limit, unread_only } = req.query;
  const result = await notificationService.listForUser(req.user.id, {
    page: Number(page) || 1,
    limit: Number(limit) || 20,
    unreadOnly: unread_only === 'true',
  });
  res.json(result);
});

const markRead = catchAsync(async (req, res) => {
  const updated = await notificationService.markRead(Number(req.params.id), req.user.id);
  res.json(updated);
});

const getUnreadCount = catchAsync(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.user.id);
  res.json({ count });
});

module.exports = { listMyNotifications, markRead, getUnreadCount };
```

---

### `src/routes/notifications.js` (route, request-response)

**Analog:** `src/routes/wagers.js` (full file, 12 lines)

**Exact pattern to copy** (lines 1-11):
```javascript
const express = require('express');
const wagersController = require('../controllers/wagersController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/user/:username', requireAuth, wagersController.getUserWagers);
router.post('/', requireAuth, wagersController.placeWager);
router.delete('/:id', requireAuth, wagersController.cancelWager);

module.exports = router;
```
Every route wrapped with `requireAuth` inline as second middleware arg (no router-level `router.use(requireAuth)` in this codebase's convention — apply per-route, matching this file exactly).

**Apply to notifications:**
```javascript
const express = require('express');
const notificationsController = require('../controllers/notificationsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, notificationsController.listMyNotifications);
router.get('/unread-count', requireAuth, notificationsController.getUnreadCount);
router.patch('/:id/read', requireAuth, notificationsController.markRead);

module.exports = router;
```
Note: `/unread-count` must be registered before `/:id/read` would only matter if both were `GET /:something` — here they're different HTTP methods/paths so no route-ordering conflict, but keep static routes above param routes as a general Express convention regardless.

---

### `server.js` (modified — route mount + listener registration)

**Analog:** itself — existing route-require block (lines 18-23) and `startScheduler()` call site (line 146).

**Exact pattern already in file** (lines 18-23):
```javascript
const authRoutes = require('./src/routes/auth');
const usersRoutes = require('./src/routes/users');
const marketsRoutes = require('./src/routes/markets');
const wagersRoutes = require('./src/routes/wagers');
const leaderboardRoutes = require('./src/routes/leaderboard');
const sessionsRoutes = require('./src/routes/sessions');
```
Add `const notificationsRoutes = require('./src/routes/notifications');` to this block, and the corresponding `app.use('/api/notifications', notificationsRoutes);` alongside the existing `app.use('/api/...', ...)` mounts (locate exact mount block — not yet read this session; grep `app.use('/api` before editing).

**Listener registration** — add near `startScheduler()` (line 146: `startScheduler();`, requiring `const { startScheduler } = require('./src/scheduler');` at line 27):
```javascript
require('./src/services/notificationService').register();
```
Register before or alongside `startScheduler()` so listeners are attached before any market/wager mutation can occur.

---

### `src/services/wagerService.js` (modified — add emits)

**Emission points** (exact insertion locations, grounded in current file content read above):

1. `placeWager()` — currently returns directly from `transaction(...)` at line 20-54 (`return transaction(async (client) => {...});`). To emit after commit without changing the transaction's return shape, change to:
```javascript
const wager = await transaction(async (client) => { /* ...unchanged body, return wager... */ });
domainEvents.emit('wager.placed', {
  wagerId: wager.id, userId, marketId, choice, amount: wagerAmount,
});
return wager;
```
(Requires capturing `market.question` inside the transaction if the notification needs the market name — currently not returned by `wagerRepository.create()`; verify payload needs against `wagerRepository`/`marketRepository` shape before finalizing, per RESEARCH.md Pattern 3's "no re-query after commit" rule — pull `market.question` from the already-fetched `market` row at line 22 inside the transaction closure and include it in the returned/emitted payload.)

2. `cancelWager()` — currently `return transaction(...)` at lines 59-93, ending with `logger.info(...)` (line 91) then `return { ok: true };` (line 92). Same restructure:
```javascript
const result = await transaction(async (client) => { /* ...unchanged, capture wager.amount, market.question... */ });
domainEvents.emit('wager.cancelled', { wagerId, userId, marketId: result.marketId, amount: result.amount, question: result.question });
logger.info(`Usuário ${userId} cancelou a aposta #${wagerId}`);
return { ok: true };
```

**Import to add** (top of file, alongside line 1-6 existing requires): `const domainEvents = require('../events/domainEvents');`

---

### `src/services/marketService.js` (modified — add emits)

**Emission points:**

1. `closeMarket()` (lines 88-94) — NOT wrapped in `transaction()` currently (single `marketRepository.updateStatus` call, no `client`). Emit directly after the await:
```javascript
async closeMarket(marketId) {
  const market = await marketRepository.findById(marketId);
  if (!market) throw new NotFoundError('Mercado não encontrado.');
  if (market.status !== 'open') return market;
  const closed = await marketRepository.updateStatus(marketId, 'closed');
  domainEvents.emit('market.closed', { marketId, question: market.question });
  return closed;
}
```

2. `resolveMarket()` (lines 97-136) — `return transaction(async (client) => {...})` at line 102. The per-wager loop (lines 111-131) already has `wager`, `outcome`, `wager.potential_payout`, `market.question` in scope. Per RESEARCH.md Pattern 3/4 (no re-query after commit), collect an array inside the transaction and emit after:
```javascript
return transaction(async (client) => {
  // ...unchanged body...
  const wagerOutcomes = [];
  for (const wager of pendingWagers) {
    if (wager.choice === outcome) {
      // ...unchanged payout logic...
      wagerOutcomes.push({ wagerId: wager.id, userId: wager.user_id, won: true, amount: wager.amount, payout: wager.potential_payout });
    } else {
      await wagerRepository.updateStatus(wager.id, 'lost', client);
      wagerOutcomes.push({ wagerId: wager.id, userId: wager.user_id, won: false, amount: wager.amount });
    }
  }
  logger.info(...); // unchanged
  return { ...resolved, wagerOutcomes };
}).then((resolved) => {
  domainEvents.emit('market.resolved', { marketId, outcome, question: resolved.question });
  for (const w of resolved.wagerOutcomes) {
    domainEvents.emit(w.won ? 'wager.won' : 'wager.lost', {
      wagerId: w.wagerId, userId: w.userId, marketId, question: resolved.question,
      amount: w.amount, payout: w.won ? w.payout : null,
    });
  }
  return resolved;
});
```
(Strip `wagerOutcomes` from the final returned object if callers of `resolveMarket()` shouldn't see it — check controller usage before finalizing.)

3. `deleteMarket()` (lines 139-168) — same restructure, emit `market.deleted` with `market.question` and, per-wager, could optionally emit `wager.cancelled`-shaped events for refunds (CONTEXT.md D-05 item 7 says this event alone covers "market cancelled" — no separate refund event needed).

**Import to add:** `const domainEvents = require('../events/domainEvents');`

---

## Shared Patterns

### Ownership scoping (IDOR prevention)
**Source:** No existing notification precedent; closest codebase precedent is `wagerService.cancelWager()` at `src/services/wagerService.js` line 63: `if (wager.user_id !== userId) throw new AuthorizationError('Essa aposta não é sua.');`
**Deviation required:** Per RESEARCH.md Pattern 4, notifications must return 404 (`NotFoundError`), not 403 (`AuthorizationError`), for ownership mismatches — don't copy the wager precedent's error type here, only its "check ownership before mutating" structure.
**Apply to:** `notificationRepository.markRead(id, userId)` (WHERE clause includes `user_id`), `notificationRepository.findById(id, userId)`, `notificationRepository.findByUserId(userId, ...)` — every query.

### Error handling — catchAsync + centralized handler
**Source:** `src/middleware/errorHandler.js` (full file, 76 lines) — `catchAsync` (lines 66-70) wraps every controller handler; `errorHandler` (lines 8-61) is mounted last in Express and maps `AppError` subclasses via `statusCode`.
**Apply to:** All notification controller handlers use `catchAsync`; all notification service errors throw `AppError` subclasses from `src/utils/errors.js`, never raw `Error`.
**Critical gotcha (verified):** `errorHandler.js` line 42 `if (err.code && err.code.startsWith('P'))` does NOT match Postgres's `'23505'` unique-violation code. `notificationService.notify()` MUST catch `23505` itself before it can reach `catchAsync`/this handler — do not rely on the global handler to treat it as a benign idempotent no-op, it will not.

### Transaction boundary / emit-after-commit
**Source:** `src/config/database.js` `transaction()` helper (used throughout `wagerService.js`/`marketService.js`); pattern confirmed at every call site read above (`wagerService.js` lines 20, 59; `marketService.js` line 102, 140).
**Apply to:** Every `domainEvents.emit(...)` call in `wagerService.js`/`marketService.js` must be textually outside the `transaction(async (client) => {...})` callback — after the promise the callback returns has resolved. Never emit from inside the callback (a rollback would leave a phantom emitted event with no corresponding committed row).

### Parameterized queries only
**Source:** Every repository read this session (`walletRepository.js` all methods) uses `$1`, `$2`, ... placeholders exclusively, zero string concatenation into SQL.
**Apply to:** `notificationRepository.js` — every query, especially the dynamic `unreadOnly` WHERE-clause fragment in `findByUserId` (build the conditional fragment as a literal safe string like `'AND read_at IS NULL'`, never interpolate user input directly).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/events/domainEvents.js` | utility | event-driven | First EventEmitter-based pub/sub in this codebase; no prior analog exists. Use RESEARCH.md's concrete code directly (Node core `events` module, singleton export, top-level `'error'` handler). |

## Metadata

**Analog search scope:** `src/services/`, `src/repositories/`, `src/controllers/`, `src/routes/`, `src/migrations/`, `src/middleware/`, `src/utils/`, `server.js`
**Files scanned/read in full this session:** `src/services/wagerService.js`, `src/services/marketService.js`, `src/repositories/walletRepository.js`, `src/controllers/wagersController.js`, `src/routes/wagers.js`, `src/migrations/002_wallet.js`, `src/utils/errors.js`, `src/middleware/errorHandler.js`, plus grep of `server.js` require/mount block
**Pattern extraction date:** 2026-07-13
