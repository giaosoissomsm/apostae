# Phase 1: Notifications Infrastructure - Research

**Researched:** 2026-07-13
**Domain:** Event-driven notification infrastructure for a Node.js/Express/PostgreSQL betting platform (in-process EventEmitter domain events, idempotent write-once notification records, ownership-scoped paginated REST API)
**Confidence:** HIGH for codebase-integration patterns (grounded directly in `src/config/database.js`, `src/services/wagerService.js`, `src/services/marketService.js`, `src/repositories/walletRepository.js`, `src/migrations/00{1,2}_*.js`, `src/middleware/errorHandler.js`) / MEDIUM-LOW for generic web-sourced patterns (EventEmitter error semantics, keyset-vs-offset pagination) used to validate design choices

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Notification writing MUST be event-driven via a domain-event bus (e.g. `src/events/domainEvents.js`, a Node `EventEmitter` singleton). `wagerService` and `marketService` MUST NOT call notification-writing code directly — they emit domain events (after their `transaction()` call resolves, matching the codebase's existing transaction-boundary convention). A dedicated `notificationService`, subscribed to the bus, is the sole writer to the `notifications` table.
- **D-02:** This decoupling is explicitly for future extensibility — the user wants future integrations (email, push, WhatsApp, Telegram, mobile apps) to be able to subscribe to the same domain events without touching `wagerService`/`marketService` business logic. Design the event bus/payload shape generically (event type + user id + relevant entity ids/amounts), not as a "notifications-only" mechanism.
- **D-03:** Event processing MUST be idempotent — duplicate delivery/retry of the same underlying event must not create duplicate notification rows. Use a stable idempotency key per (event source, entity id, event type) — e.g. a unique constraint on `(user_id, type, related_entity, related_id)` or an explicit `event_id` column, planner's choice of exact mechanism.
- **D-04:** This matches (and should follow) the pattern already recommended in `.planning/research/ARCHITECTURE.md` — do not diverge from that research without a reason.
- **D-05:** Full event catalog to wire up this phase: `wager.placed`, `market.closed`, `market.resolved`, `wager.won`, `wager.lost`, `wager.cancelled`, `market.deleted`, plus forward-compat slot for `wager.cashed_out` (Phase 2, not built now). See CONTEXT.md for exact emission-point mapping per event.
- **D-06:** Any other balance-affecting or attention-requiring wager/market status transition not explicitly listed above should flow through the same generic event-bus mechanism rather than being hardcoded as a one-off — no fixed switch statement that requires editing for every new event type.
- **D-07:** Backend API only this phase. No changes to `public/index.html` or other frontend files.
- **D-08:** Listing notifications (GET, paginated) NEVER changes read state as a side effect. Marking read is explicit and separate (single mark-as-read required at minimum per NOTIF-07).
- **D-09:** Notification text must be specific (amount, market name/question), Portuguese language, matching existing service-layer tone.

### Claude's Discretion

- Exact domain-event payload schema (field names/types) — design for extensibility per D-02.
- Exact idempotency-key mechanism (unique constraint vs explicit `event_id` column) — either acceptable per D-03.
- Whether bulk "mark all read" ships in v1 or just single mark-as-read (NOTIF-07 only requires single).
- Notifications table schema details (indexes, exact column names) beyond what NOTIF-06/07/08 require.

### Deferred Ideas (OUT OF SCOPE)

- Frontend notification bell/list UI — explicitly deferred (D-07).
- Real-time delivery (WebSocket/SSE) — deferred at project level; this phase only avoids choices that force a rewrite later.
- Email/push/WhatsApp/Telegram notification delivery — not built this phase; only extensibility required.
- Cashout-available notification — not built this phase (Phase 2 doesn't exist yet); only forward-compatibility in the event catalog/schema.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NOTIF-01 | User notified when a market they wagered in is closed | Event catalog Pattern 1 (`market.closed`); emission point `marketService.closeMarket()` |
| NOTIF-02 | User notified when a market's result is defined (resolved) | Event catalog Pattern 1 (`market.resolved`); emission point `marketService.resolveMarket()` |
| NOTIF-03 | User notified when their wager wins | Event catalog Pattern 1 (`wager.won`); emitted per-wager inside `resolveMarket()`'s payout loop |
| NOTIF-04 | User notified when their wager loses | Event catalog Pattern 1 (`wager.lost`); emitted per-wager inside `resolveMarket()`'s payout loop |
| NOTIF-05 | User notified on other relevant wager status changes (e.g. cancelled) | `wager.cancelled` from `cancelWager()`, `market.deleted` from `deleteMarket()` (covers "market cancelled") |
| NOTIF-06 | User can list notifications paginated, newest first | Pagination Pattern (bounded LIMIT/OFFSET with stable tie-break, keyset-ready); schema section |
| NOTIF-07 | User can mark a notification as read; state persists | Read/unread schema (`read_at TIMESTAMP`), mark-read endpoint pattern |
| NOTIF-08 | Every notification has a timestamp, retrievable only by owning user (no IDOR) | Ownership-scoping pattern (Pitfall 8 in milestone PITFALLS.md); every query includes `WHERE user_id = $currentUserId` |
| NOTIF-09 | Notification-writing triggered from a single chokepoint, reused by every emitting feature | Pattern 1: domain-event bus + sole-writer `notificationService.notify()` |
| NOTIF-10 | No push transport required this milestone, but design must not force a rewrite later | Event bus abstraction (Pattern 1) already isolates the future realtime swap point; see Data Flow section |
</phase_requirements>

## Summary

This phase adds one net-new architectural seam to an otherwise unchanged layered codebase: an in-process `EventEmitter` domain-event bus (`src/events/domainEvents.js`) sitting between the existing financial services (`wagerService`, `marketService`) and a new `notificationService`/`notificationRepository`/`notificationsController` triad. Every emission point already exists as a named method (`closeMarket`, `resolveMarket`, `cancelWager`, `deleteMarket`, `placeWager`) and every emission happens **after** that method's `transaction()` call has resolved — never from inside the transaction closure — so a notification is structurally impossible to write for a change that didn't actually commit. This exactly matches the milestone-level `ARCHITECTURE.md` research (Pattern 1) and the locked decisions in CONTEXT.md (D-01/D-04); no diverging design was considered.

The `notifications` table follows the codebase's existing `audit_logs`/`wallet_transactions` conventions: `SERIAL` PK, `user_id` FK, a `read_at TIMESTAMP` (nullable) rather than a separate boolean (mirrors the codebase's `deleted_at`/`resolved_at` idiom), and a `related_entity`/`related_id` pair mirroring `wallet_transactions`. Idempotency is enforced with a `UNIQUE` constraint on `(user_id, type, related_entity, related_id)` — no separate `event_id` column needed, because every event in the D-05 catalog naturally identifies its target notification via those four fields, and letting Postgres reject the duplicate INSERT (caught explicitly by `notificationService`, not surfaced as a 500) is simpler and race-safe by construction, unlike an application-level "check then insert."

Pagination uses bounded `LIMIT`/`OFFSET` with an explicit hard cap and a stable `(created_at DESC, id DESC)` sort — this is **not** the same tech debt CONCERNS.md flags (which is *unbounded* `OFFSET`, i.e. no `LIMIT` at all); it is the standard, sufficient-at-this-scale form of the pattern, and the query is written so a future switch to keyset/cursor pagination (`WHERE (created_at, id) < ($cursor_created_at, $cursor_id)`) is an additive parameter, not a rewrite — satisfying the same "don't force a rewrite later" spirit CONTEXT.md applies to NOTIF-10.

**Primary recommendation:** Build `src/events/domainEvents.js` as a single shared `EventEmitter` singleton with a top-level `.on('error', ...)` safety handler; build `notificationService.notify()` as the only writer to a new `notifications` table (migration `003_notifications.js`) with a `UNIQUE(user_id, type, related_entity, related_id)` idempotency constraint; wire `marketService`/`wagerService` to `domainEvents.emit(...)` immediately after each relevant `transaction()` call resolves; expose `GET /api/notifications` (paginated), `PATCH /api/notifications/:id/read`, and `GET /api/notifications/unread-count` under `requireAuth`, every query scoped by `user_id = req.user.id`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Domain event emission (wager/market state changes) | API / Backend (services layer) | — | `wagerService`/`marketService` already own these state transitions; emitting is a one-line addition at their existing commit point, not a new tier |
| Domain event bus (pub/sub dispatch) | API / Backend (in-process module) | — | Single Node process, no distributed infra this milestone; `src/events/domainEvents.js` is a plain in-memory `EventEmitter`, not a queue/broker |
| Notification write (persist to DB) | API / Backend (`notificationService`) | Database / Storage | Service owns business logic (formatting, idempotency handling); Postgres owns durable storage via `notificationRepository` |
| Notification read/list/mark-read | API / Backend (`notificationsController`/`notificationService`) | Database / Storage | REST endpoints scoped to `req.user.id`; all filtering happens in SQL (`WHERE user_id = $1`), never in application code post-fetch |
| Unread count | API / Backend | Database / Storage (optionally Redis cache later) | A live indexed `COUNT` query is sufficient at this scale (Claude's Discretion; no caching needed for v1) |
| Notification inbox UI | Browser / Client | — | Explicitly out of scope this phase (D-07) — noted here only so the planner doesn't misassign any task to `public/` |
| Future realtime delivery (WebSocket/SSE) | Browser / Client + API / Backend | — | Out of scope (D-07/NOTIF-10); the event bus is the future attachment point, no code for it is written now |

## Standard Stack

### Core

No new dependencies. Reuse the existing stack exactly as `.planning/research/STACK.md` (milestone-level) already concludes for this exact question — verdict confirmed, not re-litigated:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `events` (Node builtin) | Node runtime-bundled, no install | `EventEmitter` domain-event bus | Node core module; required modules are singletons by default, so `module.exports = new EventEmitter()` in one file gives every requirer the same shared instance — no package needed [CITED: https://nodejs.org/api/events.html] |
| `pg` | ^8.11.3 (existing) | `notifications` table read/write | Already the sole DB access layer in this codebase; no ORM is used anywhere else, notifications shouldn't be the first exception |
| `express` | ^4.19.2 (existing) | New `/api/notifications` route | Matches existing one-router-per-resource convention |
| `joi` | ^17.12.0 (existing, underused) | Validate pagination query params (`page`/`limit`/`unread_only`) | Already a dependency; `ARCHITECTURE.md` flags it as "imported but not consistently applied" — this is a low-risk place to start actually using it |

### Supporting

None required for this phase. `redis` (existing dependency) could cache the unread-count, but per Claude's Discretion this is deferred — a plain indexed `COUNT` query is fast enough at this platform's scale and adds no new invalidation-correctness surface to get wrong on day one.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `notifications` table + repository | An npm notification-center package | No dominant/well-maintained package exists for "Postgres-backed in-app notification center" the way Passport exists for auth; every real-world implementation surveyed hand-rolls it — a dependency would add schema opinions and migration lock-in for a domain simple enough not to need one [ASSUMED — confirmed independently by milestone-level STACK.md research, not re-verified this session] |
| In-process `EventEmitter` | A message queue (BullMQ, RabbitMQ) or Postgres `LISTEN`/`NOTIFY` | Single Node process, no multi-instance deployment this milestone; a queue is unjustified infra for in-process pub/sub. `ARCHITECTURE.md` Scaling Considerations already documents the exact future swap point (Redis pub/sub, already a dependency) if the app is ever scaled to multiple instances — not needed now |
| `UNIQUE` constraint idempotency | Application-level "SELECT then INSERT if not exists" check | TOCTOU race — two near-simultaneous deliveries of the same event (unlikely in-process, but the resolveMarket per-wager loop and repeated scheduler ticks make this non-hypothetical) could both pass the SELECT check before either INSERTs. A `UNIQUE` constraint makes Postgres the single source of truth for "already processed," race-free by construction |

**Installation:**
```bash
# No new packages required this phase.
```

**Version verification:** No new packages introduced this phase — nothing to verify against the npm registry. Existing dependency versions (`pg` ^8.11.3, `express` ^4.19.2, `joi` ^17.12.0) are unchanged from `package.json`, confirmed by direct read of `/srv/www/apostas/package.json` `[VERIFIED: local package.json]`.

## Package Legitimacy Audit

**No external packages are introduced by this phase.** The Package Legitimacy Gate is not applicable — every capability (`EventEmitter`, Postgres table, Express routes) is either a Node builtin or an already-installed, already-verified dependency of this codebase.

**Packages removed due to [SLOP] verdict:** none (N/A — no new packages)
**Packages flagged as suspicious [SUS]:** none (N/A — no new packages)

## Architecture Patterns

### System Architecture Diagram

```
                         ┌───────────────────────────────────────────┐
                         │   Client (any future consumer — not       │
                         │   built this phase: browser, mobile,      │
                         │   email/WhatsApp worker)                  │
                         └───────────────┬─────────────────────────┘
                                          │ HTTP (Bearer JWT)
                                          ▼
   GET  /api/notifications           ┌─────────────────────┐
   PATCH /api/notifications/:id/read │ notificationsController │
   GET  /api/notifications/unread-count │ (requireAuth on all) │
                                     └──────────┬───────────┘
                                                 ▼
                                      ┌─────────────────────┐
                                      │  notificationService │◀────────────┐
                                      │  .notify(evt)         │             │
                                      │  .listForUser()       │             │  domainEvents.on(...)
                                      │  .markRead()           │             │  (async, self-catching)
                                      │  .getUnreadCount()      │             │
                                      └──────────┬───────────┘             │
                                                 ▼                         │
                                      ┌─────────────────────┐             │
                                      │ notificationRepository │           │
                                      │ (parameterized SQL,   │           │
                                      │  user_id-scoped)      │           │
                                      └──────────┬───────────┘             │
                                                 ▼                         │
                                      ┌─────────────────────┐             │
                                      │  notifications table  │             │
                                      │  (PostgreSQL)          │             │
                                      └─────────────────────┘             │
                                                                            │
   ┌─────────────────────────────────────────────────────────┐            │
   │            src/events/domainEvents.js                   │────────────┘
   │        (shared EventEmitter singleton, in-process)       │
   │  .emit('market.closed' | 'market.resolved' |              │
   │         'wager.won' | 'wager.lost' | 'wager.cancelled' |   │
   │         'market.deleted' | 'wager.placed', payload)        │
   └───────────────────────▲───────────────────────────────┘
                            │  emit(...) — AFTER transaction() resolves,
                            │  never from inside the transaction callback
              ┌─────────────┴──────────────┐
              │                             │
   ┌──────────────────────┐     ┌──────────────────────┐
   │   marketService        │     │   wagerService         │
   │ closeMarket()           │     │ placeWager()             │
   │ resolveMarket()          │     │ cancelWager()             │
   │ deleteMarket()             │     └──────────┬───────────┘
   └──────────┬───────────┘                     │
              │  transaction(async client => {...})   (unchanged existing pattern)
              ▼                                  ▼
   ┌─────────────────────────────────────────────────────┐
   │   PostgreSQL — markets / wagers / wallets /           │
   │   wallet_transactions (unchanged by this phase)        │
   └─────────────────────────────────────────────────────┘
```

Trace the primary use case: a market resolves → `marketService.resolveMarket()` runs its existing `transaction()` (unchanged) → transaction commits → `resolveMarket()` calls `domainEvents.emit('market.resolved', {...})` and, per winning/losing wager in its existing loop, `domainEvents.emit('wager.won'|'wager.lost', {...})` → `notificationService`'s registered listener receives each event → validates/formats a Portuguese-language message → calls `notificationRepository.create()` with a `client`-less pooled `query()` (no transaction needed here, since this write is intentionally decoupled — see Pattern 1 trade-offs) → row lands in `notifications` → later, the user calls `GET /api/notifications` → `notificationsController` → `notificationService.listForUser(req.user.id, {...})` → `notificationRepository.findByUserId()` (scoped `WHERE user_id = $1`) → paginated rows returned.

### Recommended Project Structure

```
src/
├── events/
│   └── domainEvents.js            # NEW: shared EventEmitter singleton
├── services/
│   ├── notificationService.js     # NEW: sole writer; registers listeners at startup
│   ├── marketService.js           # EXTEND: emit after closeMarket/resolveMarket/deleteMarket
│   └── wagerService.js            # EXTEND: emit after placeWager/cancelWager
├── repositories/
│   └── notificationRepository.js  # NEW: CRUD, always user_id-scoped
├── routes/
│   └── notifications.js           # NEW: GET /, PATCH /:id/read, GET /unread-count
├── controllers/
│   └── notificationsController.js # NEW
└── migrations/
    └── 003_notifications.js       # NEW: next sequential migration
```

### Pattern 1: Domain-event notification writes (single chokepoint, not scattered inline calls)

**What:** Services never call `notificationRepository` directly. At the point a service's `transaction()` call resolves successfully, the service emits a small, typed event on the shared `domainEvents` bus. `notificationService`, registered once at server startup (alongside `startScheduler()` in `server.js`), is the *only* code in the entire codebase that imports and calls `notificationRepository`.

**When to use:** Every notification-worthy state change in this phase's catalog (D-05). Not for anything that must be atomic with the money movement itself — that logic stays exactly as it is today, inside the existing `transaction()` callback using existing repositories directly. Notifications are additive observers, never in the critical financial path.

**Why this fits this codebase specifically:** Every financial mutation already goes through `transaction(async (client) => {...})`. Emitting *after* that promise resolves (not from inside the callback) makes an emit-on-rollback bug structurally impossible — the emit line is textually outside the transaction closure. This matches `ARCHITECTURE.md` Pattern 1 exactly (D-04 requires following it).

**Concrete implementation:**
```javascript
// src/events/domainEvents.js
const { EventEmitter } = require('events');

const domainEvents = new EventEmitter();

// REQUIRED safety net: Node crashes the process on an unhandled 'error' event.
// A bug inside any notification listener must never be able to bring down
// wager placement / market resolution, which have nothing to do with
// notifications. See Pitfall 1 below.
domainEvents.on('error', (err) => {
  require('../utils/logger').error('domainEvents listener error', err);
});

module.exports = domainEvents;
```

```javascript
// src/services/marketService.js (resolveMarket, after transaction() resolves)
const resolved = await transaction(async (client) => {
  // ...existing unchanged logic (resolve, pay winners, mark losers)...
  // Capture what's needed for events (wager ids/amounts/choices) as this
  // loop already iterates pendingWagers — build an array of {wagerId, userId,
  // amount, payout} inside the transaction, emit AFTER commit, below.
  return { resolved, wagerOutcomes };
});

domainEvents.emit('market.resolved', {
  marketId,
  outcome,
  question: resolved.question,
});
for (const w of resolved.wagerOutcomes) {
  domainEvents.emit(w.won ? 'wager.won' : 'wager.lost', {
    wagerId: w.wagerId,
    userId: w.userId,
    marketId,
    question: resolved.question,
    amount: w.amount,
    payout: w.won ? w.payout : null,
  });
}
```

```javascript
// src/services/notificationService.js
const domainEvents = require('../events/domainEvents');
const notificationRepository = require('../repositories/notificationRepository');
const logger = require('../utils/logger');

function register() {
  domainEvents.on('market.resolved', safeHandler(async ({ marketId, outcome, question }) => {
    // fetch affected wagers if the event payload doesn't already carry
    // enough to notify (design choice — see Pattern 3 payload discussion)
  }));

  domainEvents.on('wager.won', safeHandler(async (evt) => {
    await notify(evt.userId, {
      type: 'wager.won',
      title: 'Você ganhou!',
      body: `Sua aposta de R$${evt.amount.toFixed(2)} em "${evt.question}" venceu! +R$${evt.payout.toFixed(2)}`,
      relatedEntity: 'wager',
      relatedId: evt.wagerId,
    });
  }));

  // ...wager.lost, market.closed, wager.cancelled, market.deleted, wager.placed similarly...
}

// Wraps every listener so a thrown/rejected error is logged, never
// propagated to crash the process or block sibling listeners.
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
      // unique_violation on the idempotency constraint — duplicate event,
      // not an error. Log at debug, do not rethrow.
      logger.debug(`Notificação duplicada ignorada: ${type} ${relatedEntity}#${relatedId} usuário ${userId}`);
      return;
    }
    throw err;
  }
}

module.exports = { register, notify };
```

```javascript
// server.js (bootstrap, alongside startScheduler())
require('./src/services/notificationService').register();
```

**Trade-offs:** Notification writes are not atomic with the triggering transaction — a crash between commit and the `domainEvents.emit()` line, or between emit and the repository INSERT, loses a notification. This is explicitly acceptable per `ARCHITECTURE.md`: notifications are scoped as structure-only, non-realtime, and outside PROJECT.md's financial-integrity constraint (which binds only balance/wallet/wager/cashout/cancellation operations, not notification delivery). Do not "fix" this by moving the write inside the triggering transaction — that would directly contradict D-01/D-04.

### Pattern 2: Idempotency via UNIQUE constraint, not application-level check

**What:** `notifications` table has `UNIQUE (user_id, type, related_entity, related_id)`. `notificationRepository.create()` performs a plain `INSERT`; `notificationService.notify()` catches Postgres error code `23505` (`unique_violation`) and treats it as "already processed, no-op" rather than an error.

**When to use:** Every call to `notify()`. This directly satisfies D-03 (idempotent processing) and closes the "no idempotency for financial operations" gap flagged in `.planning/codebase/CONCERNS.md` — for the notifications domain specifically, not the financial-mutation domain (that gap remains for Phase 2/4 to close on cashout/cancellation).

**Why `UNIQUE(user_id, type, related_entity, related_id)` over an explicit `event_id` column:** Every event in the D-05 catalog already has a natural composite key — a user can only win/lose a *specific* wager once, a market can only close/resolve/be-deleted once. No event in this catalog needs a separately-generated UUID threaded through the payload; the four columns already being written are sufficient to detect a duplicate. An `event_id` column would be the right choice only if a single event could plausibly need multiple distinct notifications for the same `(user, type, entity)` triple (not the case here) or if there were an external event source without a natural key (also not the case — every emission is our own in-process code).

**CRITICAL implementation gotcha specific to this codebase (verified by reading `src/middleware/errorHandler.js`):** The existing centralized error handler checks `if (err.code && err.code.startsWith('P'))` to special-case database errors — but node-postgres unique-violation errors have `err.code === '23505'` (PostgreSQL's own numeric-string error codes), which does **not** start with `'P'`. This means if a `23505` error from a duplicate notification INSERT is ever allowed to propagate up to a controller/`catchAsync`, it will fall through to the generic `else` branch and return an opaque 500 to whatever HTTP request happened to trigger it — which is wrong twice over: (1) duplicate notification delivery is expected, normal, idempotent-success behavior, not an error, and (2) the write happens from an event listener, not inside an HTTP request at all, so an uncaught rejection here would be an unhandled promise rejection, not even a clean 500. **The `notificationService.notify()` function MUST catch `23505` itself and never let it propagate**, exactly as shown in the Pattern 1 code example. Verify this behavior with an explicit test: emit the same event payload twice, assert exactly one row exists and no error/crash occurs.

**Example (schema-level enforcement):**
```sql
-- migration 003_notifications.js
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
```

**Trade-off / known limitation:** This constraint means a given user can only ever have *one* notification of a given `type` for a given `related_entity`/`related_id` pair. This is correct for every event in the D-05 catalog (each is a one-time transition), but the planner should note it explicitly if a future phase (e.g. Phase 2's `wager.cashed_out`, which can fire multiple times for the same wager across multiple partial cashouts) needs multiple notifications per entity — that event's uniqueness key will need to additionally include something that varies per cashout (e.g. the `wager_cashouts.id` as `related_id` instead of the wager id, or a compound key including a sequence). Flag this in the plan as a note for Phase 2, not a blocker for Phase 1 (D-05 explicitly scopes `wager.cashed_out` as forward-compat-only, not implemented now).

### Pattern 3: Notification content — specific text, minimal but not empty payload

**What:** Per D-09, notification `title`/`body` must include amount and market name where relevant, in Portuguese, matching existing tone (`wagerService`/`marketService` log messages, e.g. `Pagamento da aposta #${wager.id} (mercado #${market.id})`). This means the domain-event payload must carry enough data for `notificationService` to format the message *without* an extra DB round-trip in the common case — e.g. `wager.won`'s payload should include `amount`, `payout`, and `question` (market title), not just IDs that would require `notificationService` to re-query `markets`/`wagers`.

**When to use:** Every event emission. Design the payload shape once, generically, per D-02 — `{ type, userId, ...entityIds, ...amounts }` — so a *future* subscriber (email, WhatsApp) has everything it needs without also having to query the DB back.

**Trade-off vs. Pitfall 8 (milestone PITFALLS.md) guidance to "keep notification content minimal":** PITFALLS.md's IDOR-focused recommendation to keep notification content minimal is about *not leaking cross-user data through a shared/public code path* — it is not in tension with D-09's requirement for rich, specific content shown *to the notification's own owner* via an ownership-scoped endpoint. Since every notification query in this phase is scoped by `user_id = req.user.id` (Pattern 4), there is no shared/public code path for this content to leak through. Resolve this by including full specific content (amount, market name) as D-09 requires, while ensuring — per Pattern 4 — that no route or query ever serves a notification row to anyone but its owner.

### Pattern 4: Ownership-scoping on every notification query, including by-ID routes

**What:** Every notification query — list, mark-as-read — includes `WHERE user_id = $currentUserId`, sourced from `req.user.id` (the JWT-authenticated user), never from a route param or request body. This establishes, in the very first notification endpoint ever written, the ownership-check pattern every later phase's notification types (cashout-available, etc.) will inherit.

**When to use:** All of `notificationRepository`'s methods that take an `id` parameter.

**Why this fits this codebase specifically:** The codebase already has this exact convention for wagers (`wager.user_id !== userId → AuthorizationError`), but notifications are new — there's no existing pattern to copy by habit, which is precisely why milestone `PITFALLS.md` flags this as the highest-value thing to get right first (Pitfall 8). Follow the **404, not 403** convention already implied by this codebase's error-class use elsewhere for ownership mismatches (don't leak "this ID exists but isn't yours"): a mark-as-read for a notification ID that exists but belongs to another user should return `NotFoundError` (404), not `AuthorizationError` (403).

**Example:**
```javascript
// src/repositories/notificationRepository.js
async markRead(id, userId) {
  const result = await query(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL
     RETURNING *;`,
    [id, userId]
  );
  return result.rows[0] || null; // null = not found OR not owned OR already read; caller decides which error
}
```
```javascript
// src/services/notificationService.js
async markRead(id, userId) {
  const updated = await notificationRepository.markRead(id, userId);
  if (!updated) {
    // Distinguish "doesn't exist/not yours" (404) from "already read" (idempotent success)
    // by checking existence+ownership separately only if the UX needs that distinction;
    // simplest correct behavior for v1: treat "no row updated" uniformly as NotFoundError
    // UNLESS a prior findById(id, userId) confirms it exists and is already read, in which
    // case return the existing row (mark-as-read is idempotent, not an error to repeat).
    const existing = await notificationRepository.findById(id, userId);
    if (!existing) throw new NotFoundError('Notificação não encontrada.');
    return existing; // already read — idempotent no-op success
  }
  return updated;
}
```

### Pattern 5: Bounded pagination, keyset-ready

**What:** `GET /api/notifications?page=1&limit=20` (or `?before_id=123&limit=20` if the planner prefers cursor-first API design) returns rows ordered `created_at DESC, id DESC`, with `limit` hard-capped server-side (e.g. `Math.min(Number(query.limit) || 20, 100)`) regardless of what the client requests. This is a **bounded** LIMIT/OFFSET, not the *unbounded* OFFSET pattern `.planning/codebase/CONCERNS.md` flags as tech debt (`listMarkets()`/wager listing have no `LIMIT` at all today) — this phase must not repeat that specific mistake, but a capped, indexed OFFSET query is a materially different (and acceptable) thing.

**Cursor vs. offset — the actual trade-off for this table:**
- **OFFSET/LIMIT** (recommended for v1): simple to implement, matches existing codebase conventions (no other endpoint in this codebase uses cursor pagination), and — because every query is additionally scoped to a single `user_id` (unlike the flagged `listMarkets`/wager-listing bugs, which paginate over the *entire* unscoped table) — the practical row count per user is small enough that `OFFSET` cost is a non-issue at this platform's realistic scale [CITED via milestone STACK.md, consistent with independent websearch confirming OFFSET's O(n) cost scales with *offset depth*, not table size — a user with a few hundred notifications paginating a handful of pages deep never approaches the depth where this matters].
- **Keyset/cursor** (`WHERE (created_at, id) < ($cursor_created_at, $cursor_id) ORDER BY created_at DESC, id DESC LIMIT $n`): recommended if the planner wants to fully future-proof against any per-user notification volume growth, and is a strict correctness improvement under concurrent inserts (new notifications arriving between page requests can't shift OFFSET-based page boundaries) [CITED, general PostgreSQL pagination guidance — LOW/MEDIUM confidence, not codebase-specific].
- **Recommendation:** Ship bounded OFFSET/LIMIT for v1 (simpler, consistent with the rest of the codebase, sufficient at this scale), but write the repository query with the `(created_at DESC, id DESC)` tie-break from day one — that ordering is a prerequisite for a *future*, additive switch to keyset pagination (just replace the `OFFSET $n` clause with a `WHERE (created_at, id) < (...)` clause; the `ORDER BY`/`LIMIT`/index stay identical). This satisfies the same "don't force a rewrite" principle CONTEXT.md applies to NOTIF-10, applied here to pagination specifically per the phase brief's explicit ask.

**Required index:**
```sql
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
```
The second (partial) index makes the unread-count query and any "unread only" list filter fast without scanning read rows.

**Example (repository):**
```javascript
async findByUserId(userId, { page = 1, limit = 20, unreadOnly = false }) {
  const cappedLimit = Math.min(Number(limit) || 20, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * cappedLimit;
  const whereUnread = unreadOnly ? 'AND read_at IS NULL' : '';
  const result = await query(
    `SELECT * FROM notifications
     WHERE user_id = $1 ${whereUnread}
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3;`,
    [userId, cappedLimit, offset]
  );
  const countResult = await query(
    `SELECT COUNT(*) FROM notifications WHERE user_id = $1 ${whereUnread};`,
    [userId]
  );
  return {
    data: result.rows,
    pagination: { total: Number(countResult.rows[0].count), page, limit: cappedLimit },
  };
}
```

### Anti-Patterns to Avoid

- **Inline `notificationRepository.create()` calls scattered across `wagerService`/`marketService`:** Every new notification type would require editing an unrelated financial service, and testing wager placement would require mocking notification writes. Emit an event instead; let `notificationService` be the only importer of `notificationRepository` (Pattern 1).
- **Emitting from inside the `transaction()` callback:** Defeats the entire purpose of D-01 — a rollback would need to also "un-emit," which `EventEmitter` cannot do. Always emit after the `transaction()` promise resolves.
- **Application-level "check-then-insert" for idempotency:** Race-prone; use the `UNIQUE` constraint (Pattern 2) and catch `23505`.
- **Letting a `23505` duplicate-notification error propagate to `catchAsync`/the global error handler:** Given the error handler's `err.code.startsWith('P')` check does not match Postgres's actual `23505` code, this would surface as an opaque 500 instead of a silent idempotent no-op. Catch it in `notificationService.notify()` itself.
- **Unbounded `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC` with no `LIMIT`:** Repeats the exact tech debt `CONCERNS.md` already flags for `listMarkets()`/wager listing. Always cap `limit` server-side.
- **GET list endpoint auto-marking notifications as read:** Explicitly forbidden by D-08. Reading the list and marking read are two separate, explicit actions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-instance event fan-out | A custom pub/sub protocol over Redis right now | Nothing — stay on in-process `EventEmitter` this phase | Single Node process, no multi-instance deployment this milestone; `ARCHITECTURE.md` already documents Redis pub/sub as the correct *future* swap, not needed now |
| Idempotency/deduplication | An in-memory "seen events" cache/set | Postgres `UNIQUE` constraint (Pattern 2) | In-memory dedup is lost on restart and doesn't work across the per-wager resolution loop's potential retries; the DB constraint is durable and race-free |
| Read/unread state | A separate `notification_reads` join table | A nullable `read_at TIMESTAMP` column on `notifications` | Notifications in this design are per-user rows already (not a shared broadcast table), so a join table would be pure overhead; matches the codebase's own `deleted_at`/`resolved_at` idiom |

**Key insight:** Nothing in this phase requires new infrastructure or a new dependency — the entire feature is a data-modeling and service-layer wiring exercise on top of primitives (`EventEmitter`, Postgres `UNIQUE`, `transaction()`) already present in this codebase or Node core.

## Common Pitfalls

### Pitfall 1: Unhandled 'error' event on the shared EventEmitter crashes the whole server

**What goes wrong:** If `domainEvents.emit('error', ...)` is ever called (directly, or indirectly if a listener rethrows in a way Node interprets as an `'error'` emission) with no `'error'` listener registered, Node throws it as an uncaught exception and terminates the process — taking down wager placement and market resolution along with notifications.

**Why it happens:** This is documented, intentional Node.js behavior (not a bug) [CITED: https://nodejs.org/api/events.html] — `'error'` is a magic event name in `EventEmitter`. A shared bus used by multiple unrelated concerns (financial services emitting, notification service listening) makes this more dangerous than a single-purpose emitter: a bug in notification-formatting code must never be able to crash wager placement.

**How to avoid:** Register a top-level `.on('error', ...)` handler on the `domainEvents` singleton at module-load time (Pattern 1 code example), and additionally ensure every listener registered by `notificationService` wraps its body in try/catch (the `safeHandler` wrapper in Pattern 1) so a thrown/rejected error from listener logic is logged, not left as an unhandled promise rejection that Node might otherwise escalate.

**Warning signs:** Any `domainEvents.on(...)` registration without a surrounding try/catch in the handler body; server crashes correlated with a specific event type firing (check logs for the event name in the crash's immediate context).

### Pitfall 2: `23505` duplicate-key error not caught, surfaces as opaque 500 or unhandled rejection

**What goes wrong:** Described fully in Pattern 2. A duplicate event (retry, or two overlapping scheduler-driven resolution paths) hits the `UNIQUE` constraint; if `notificationService.notify()` doesn't explicitly catch `err.code === '23505'`, the error either crashes the notification listener silently (swallowed by `safeHandler`'s generic catch, logged as an "error" when it's actually expected/benign) or — worse, if `notify()` is ever called from a request-handling path directly instead of a listener — propagates to the global error handler, which mis-routes it (its `'P'`-prefix check doesn't match `'23505'`) into a generic, unhelpful 500.

**Why it happens:** The distinction between "real database error" and "expected idempotency rejection" is easy to lose once an error is caught generically upstream.

**How to avoid:** Catch `23505` specifically inside `notify()`, treat it as a successful no-op, and do not let it reach either `safeHandler`'s generic catch (as an "error") or the Express error handler.

**Warning signs:** Log entries showing "notificationService listener failed" for events that should be legitimately idempotent retries; test explicitly by emitting the same event payload twice and asserting no error/crash and exactly one row.

### Pitfall 3: Notification ownership check missing on the mark-as-read route specifically

**What goes wrong:** The list endpoint is built with correct `WHERE user_id = $1` filtering (it's the obvious first thing to get right), but the mark-as-read endpoint — built second, "using the ID we already have" — is written as `UPDATE notifications SET read_at = now() WHERE id = $1` without the `AND user_id = $2` clause, allowing any authenticated user to mark (or, if a delete endpoint is ever added, delete) any other user's notification by guessing/incrementing IDs.

**Why it happens:** This is milestone `PITFALLS.md` Pitfall 8, specific to this exact phase — no established ownership-check pattern exists yet for notifications (unlike wagers), and by-ID routes are typically built as an afterthought once the list endpoint "already filters by user."

**How to avoid:** Every repository method taking an `id` parameter also takes and applies `userId` in the `WHERE` clause (Pattern 4). Write this pattern into the very first notification query, since every later phase's notification types inherit whatever pattern is established here.

**Warning signs:** Any notification repository method with a SQL `WHERE id = $1` and no companion `user_id` condition. Test: as user A, attempt to mark user B's known notification ID as read; expect 404, and expect user B's row to remain unmodified.

### Pitfall 4: Payload under-population forces notificationService to re-query, silently deviating from the transaction's committed state

**What goes wrong:** If a domain-event payload only carries IDs (e.g. `{ wagerId }`) and `notificationService`'s listener re-fetches the wager/market from the DB to build the message text, there's a window where that data could have changed again between the original transaction's commit and the listener's re-query (e.g. rapid consecutive operations on the same entity) — producing a notification whose text doesn't match what actually happened in the triggering transaction.

**Why it happens:** Under-designing the event payload "to keep it simple" and relying on a follow-up query feels natural, but breaks the guarantee that the notification accurately describes the specific committed change.

**How to avoid:** Payloads should carry every field needed to render the message (`amount`, `payout`, `question`/market title, `choice`, etc.) captured from the same data already read/computed inside the triggering transaction — not re-fetched after the fact. This is already the emphasis of Pattern 3's payload-design guidance and directly serves D-09's "specific, not generic" content requirement.

**Warning signs:** Any `notificationService` listener that calls a repository `findById` before formatting a message — this should be rare-to-never in this phase's event catalog, since every emission point already has the relevant data in scope at the moment of emission.

## Code Examples

### Full migration (`src/migrations/003_notifications.js`)

```javascript
// Source: pattern derived from src/migrations/001_initial.js / 002_wallet.js conventions
const migrations = [
  `CREATE TABLE IF NOT EXISTS notifications (
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
    ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;`,
];

module.exports = {
  id: '003_notifications',
  up: migrations,
  down: [
    'DROP TABLE IF EXISTS notifications;',
  ],
};
```

### Route file (`src/routes/notifications.js`)

```javascript
// Source: pattern matches src/routes/wagers.js exactly
const express = require('express');
const notificationsController = require('../controllers/notificationsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, notificationsController.listMyNotifications);
router.get('/unread-count', requireAuth, notificationsController.getUnreadCount);
router.patch('/:id/read', requireAuth, notificationsController.markRead);

module.exports = router;
```

### Controller (`src/controllers/notificationsController.js`)

```javascript
// Source: pattern matches src/controllers/wagersController.js exactly
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

### server.js wiring (route mount + listener registration)

```javascript
// server.js — add alongside existing route requires and startScheduler() call
const notificationsRoutes = require('./src/routes/notifications');
// ...
app.use('/api/notifications', notificationsRoutes);
// ...
require('./src/services/notificationService').register(); // before or alongside startScheduler()
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| N/A — this is net-new infrastructure, no prior notifications system exists in this codebase | Event-driven domain bus + sole-writer service | This phase | Establishes the pattern every later phase (cashout, cancellation v2) reuses |

**Deprecated/outdated:** None applicable — no existing notification code to deprecate.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No dominant npm package exists for Postgres-backed in-app notification centers, hand-rolling is standard | Standard Stack / Alternatives Considered | Low — even if a suitable package existed, hand-rolling remains valid given this codebase's zero-ORM, hand-rolled-SQL convention everywhere else; would only change if a specific package were mandated |
| A2 | Bounded OFFSET/LIMIT pagination is sufficient at this platform's realistic per-user notification volume | Pattern 5 | Low-Medium — if a single user could plausibly accumulate tens of thousands of notifications, OFFSET depth could become a measurable cost; the keyset-ready query design mitigates this even if the assumption is wrong later |
| A3 | A `UNIQUE(user_id, type, related_entity, related_id)` constraint is sufficient idempotency granularity for every event in the D-05 catalog | Pattern 2 | Medium — correct for all 7 events built this phase; explicitly flagged as needing revisiting for Phase 2's `wager.cashed_out` (documented in Pattern 2's trade-off note) |

**If this table is empty:** N/A — see rows above; all three are LOW-MEDIUM risk and each has a documented mitigation already built into the recommended design.

## Open Questions

1. **Should `notify()` be called synchronously (in-process, same tick) or deferred (`setImmediate`/`process.nextTick`) relative to the emitting event?**
   - What we know: `EventEmitter` listeners run synchronously by default in registration order; making a listener `async` doesn't change *when* it starts, only that its internal awaits yield control back to the event loop.
   - What's unclear: Whether any emission point (e.g., `resolveMarket()`'s per-wager loop, which could fire many `wager.won`/`wager.lost` events in a tight loop for a large market) should batch/defer notification writes to avoid blocking the response to the triggering HTTP request (admin's resolve-market call) on N sequential notification INSERTs.
   - Recommendation: For this phase's expected scale (small markets, per milestone-level ARCHITECTURE.md's Scaling Considerations), do not defer — call `notificationRepository.create()` directly inside the async listener. If a future large-market load test shows resolution latency dominated by notification writes, batch them into a single multi-row INSERT then; not a v1 concern.

2. **Bulk "mark all read" — build now or defer?**
   - What we know: NOTIF-07 only requires single mark-as-read; CONTEXT.md leaves this to Claude's Discretion.
   - What's unclear: Whether the planner should scope it into Phase 1's plan or explicitly defer it.
   - Recommendation: Include it — it's a two-line addition (`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`) given the schema and ownership pattern are already in place, and it removes a likely near-term follow-up request. Low cost, moderate value; planner's call.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (with `events` core module) | Domain event bus | ✓ (implied by existing running codebase) | Node core, bundled | — |
| PostgreSQL | `notifications` table | ✓ (existing `pg` pool already connects) | 10+ per `.planning/codebase/STACK.md` | — |
| `pg`, `express`, `joi` (npm) | Existing stack reused | ✓ (already in `package.json`) | ^8.11.3 / ^4.19.2 / ^17.12.0 `[VERIFIED: local package.json]` | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — this phase introduces no new external dependency.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None installed — `package.json` `"test": "echo \"Add tests later\""` `[VERIFIED: local package.json]` |
| Config file | none — see Wave 0 |
| Quick run command | N/A until framework installed |
| Full suite command | N/A until framework installed |

This is a pre-existing, milestone-wide gap already flagged in `.planning/STATE.md` ("No test framework is currently installed... must be resolved before Phase 2's concurrency tests can be written") and `.planning/codebase/CONCERNS.md` ("Missing test coverage" — CRITICAL priority). Phase 1 is the first phase to touch this gap in practice, since NOTIF-08's IDOR requirement and NOTIF-09's idempotency requirement both need automated verification per `requisitos.txt`'s mandated "test attack vectors" process step.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NOTIF-08 | Cross-user notification ID access rejected (list, mark-read) | integration | `<framework> tests/notifications.ownership.test.js` | ❌ Wave 0 |
| NOTIF-09 | Duplicate event delivery produces exactly one notification row | integration | `<framework> tests/notifications.idempotency.test.js` | ❌ Wave 0 |
| NOTIF-06 | Paginated list returns bounded, newest-first, correctly ordered results | unit/integration | `<framework> tests/notifications.pagination.test.js` | ❌ Wave 0 |
| NOTIF-07 | Mark-as-read persists and does not occur as a side effect of listing | integration | `<framework> tests/notifications.read-state.test.js` | ❌ Wave 0 |
| NOTIF-01..05 | Each event type produces correctly-scoped, correctly-worded notification | integration | `<framework> tests/notifications.events.test.js` | ❌ Wave 0 |

`<framework>` is a placeholder — no test runner is chosen yet; this is a Wave 0 gap for the planner to resolve (install Jest or Vitest — either is a reasonable, standard choice for this CommonJS Node/Express codebase; Jest has broader historical adoption for this exact stack shape `[ASSUMED — not verified against a specific comparison this session]`).

### Sampling Rate

- **Per task commit:** run the relevant new test file(s) directly once a framework exists
- **Per wave merge:** run full new-test suite for this phase
- **Phase gate:** Full suite green before `/gsd-verify-work`, per `requisitos.txt`'s "test positive/negative, test attack vectors" mandate

### Wave 0 Gaps

- [ ] Test framework install (Jest or Vitest) — `package.json` currently has no real test runner; this blocks every automated test below
- [ ] `tests/notifications.ownership.test.js` — covers NOTIF-08
- [ ] `tests/notifications.idempotency.test.js` — covers NOTIF-09
- [ ] `tests/notifications.pagination.test.js` — covers NOTIF-06
- [ ] `tests/notifications.read-state.test.js` — covers NOTIF-07
- [ ] `tests/notifications.events.test.js` — covers NOTIF-01 through NOTIF-05
- [ ] Test DB/fixture setup (a way to spin up/reset a test Postgres schema) — none exists in this codebase today; needed before any integration test above can run

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (indirectly) | Existing `requireAuth` JWT+Redis-session middleware, unchanged — every new route mounts behind it |
| V3 Session Management | no (unchanged by this phase) | — |
| V4 Access Control | yes | Ownership-scoping (`WHERE user_id = $currentUserId` on every query, Pattern 4) is this phase's core V4 control — IDOR prevention on notification list/mark-read routes |
| V5 Input Validation | yes | `page`/`limit`/`unread_only` query params validated/coerced server-side (capped `limit`, `Number()` coercion with fallback); `:id` route param parsed as integer, never trusted as a raw string into SQL |
| V6 Cryptography | no | Not applicable — no secrets/crypto introduced by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IDOR on notification `:id` routes (enumerate/mark-read another user's notifications) | Information Disclosure / Tampering | `WHERE user_id = $currentUserId` on every query, `req.user.id` sourced from JWT never from params/body (Pattern 4) |
| Duplicate notification spam via retried/duplicate event delivery | Denial of Service (minor — inbox pollution) | `UNIQUE` constraint + explicit `23505` handling (Pattern 2) |
| Unhandled `EventEmitter` `'error'` crashing the process (notifications-triggered DoS of the entire platform) | Denial of Service | Top-level `.on('error', ...)` handler + per-listener try/catch (Pitfall 1) |
| Unbounded `limit` query param requesting excessive rows | Denial of Service (resource exhaustion) | Server-side hard cap on `limit` regardless of client-requested value (Pattern 5) |

## Sources

### Primary (HIGH confidence)
- Direct read: `/srv/www/apostas/src/config/database.js`, `/srv/www/apostas/src/services/wagerService.js`, `/srv/www/apostas/src/services/marketService.js`, `/srv/www/apostas/src/repositories/walletRepository.js`, `/srv/www/apostas/src/migrations/001_initial.js`, `/srv/www/apostas/src/migrations/002_wallet.js`, `/srv/www/apostas/src/middleware/errorHandler.js`, `/srv/www/apostas/src/routes/wagers.js`, `/srv/www/apostas/src/controllers/wagersController.js`, `/srv/www/apostas/src/utils/errors.js`, `/srv/www/apostas/scripts/migrate.js`, `/srv/www/apostas/package.json`, `/srv/www/apostas/server.js`
- `.planning/research/ARCHITECTURE.md` (milestone-level, this milestone) — source of Pattern 1's exact design, D-04's referenced source
- `.planning/research/PITFALLS.md` (milestone-level, this milestone) — source of Pitfall 3 (ownership scoping)
- `.planning/research/STACK.md` (milestone-level, this milestone) — source of schema design (`read_at TIMESTAMP`, indexes), stack verdict (no new deps)
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/CONCERNS.md` — codebase maps

### Secondary (MEDIUM confidence)
- [Events | Node.js Documentation](https://nodejs.org/api/events.html) — EventEmitter `'error'` special-casing, synchronous listener execution order (official docs)

### Tertiary (LOW confidence — WebSearch only, not independently cross-verified this session)
- [How to Use Event Emitters in Node.js — OneUptime](https://oneuptime.com/blog/post/2026-01-22-nodejs-event-emitters/view)
- [GitHub: ncuillery/single-events-eventemitter](https://github.com/ncuillery/single-events-eventemitter) — singleton pattern confirmation
- [Enforcing Constraints Across Postgres Partitions — pgEdge](https://www.pgedge.com/blog/enforcing-constraints-across-postgres-partitions)
- [How to Implement Webhook Idempotency — Hookdeck](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency)
- [Notifications ADR 001: Database schema — GitLab Handbook](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/notifications/adr/001_database_schema)
- [Guide To Design Database For Notifications In MySQL — Tutorials24x7](https://mysql.tutorials24x7.com/blog/guide-to-design-database-for-notifications-in-mysql)
- [PostgreSQL Keyset Pagination vs Offset — StackSync](https://www.stacksync.com/blog/keyset-cursors-postgres-pagination-fast-accurate-scalable)
- [Optimizing Pagination in PostgreSQL: OFFSET/LIMIT vs. Keyset — DEV Community](https://dev.to/scion01/optimizing-pagination-in-postgresql-offsetlimit-vs-keyset-21dp)
- [Keyset Cursors, Not Offsets, for Postgres Pagination — Sequin](https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/)
- [Five ways to paginate in Postgres — Citus Data](https://www.citusdata.com/blog/2016/03/30/five-ways-to-paginate/)
- [GitHub Issue #54670: Missing 'error' handlers on EventEmitters can be difficult to debug](https://github.com/nodejs/node/issues/54670)

## Project Constraints (from CLAUDE.md)

- Security: every new endpoint validates permissions server-side only, never trusts client-submitted amounts/IDs/status, guards against IDOR, uses parameterized queries (OWASP ASVS/Top 10) — directly drives Pattern 4 (ownership scoping) and the parameterized-query convention already used throughout the code examples above.
- Financial integrity: every operation touching balance/wallet/wager/cashout/cancellation must run inside a PostgreSQL transaction; every balance change must produce an audit/movement record. **Not applicable to notification writes themselves** (they touch no balance), but directly constrains that this phase must not alter the existing transaction boundaries in `wagerService`/`marketService` — emission happens strictly after those boundaries close (Pattern 1).
- Concurrency: must be safe under simultaneous operations — addressed for notifications via the `UNIQUE` constraint (Pattern 2); does not introduce any new lock ordering concern since notification writes take no row locks on `markets`/`wagers`/`wallets`.
- Process: one feature fully implemented, reviewed, and tested before the next starts — this phase (notifications) must reach a tested, reviewed state before Phase 2 (cashout) begins, per the milestone's mandated build order.
- Architecture: new code follows the existing Controller/Service/Repository layering and `.planning/codebase/CONVENTIONS.md` — followed exactly throughout this research's recommended structure and code examples.
- GSD workflow enforcement (`.claude/CLAUDE.md`): file-changing work must go through a GSD command (`/gsd-execute-phase` etc.) rather than direct edits — procedural constraint for execution, not a technical one; noted for the planner/executor, not applicable to this research document itself.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, every recommendation grounded in direct reads of this codebase's existing conventions and the already-completed milestone-level STACK.md research
- Architecture: HIGH — Pattern 1 (event bus) is a direct, unmodified application of the already-locked CONTEXT.md decisions and milestone ARCHITECTURE.md research; Patterns 2-5 are original synthesis grounded in direct codebase reads (errorHandler.js's `'P'`-prefix bug is a concrete, verified finding, not assumed)
- Pitfalls: HIGH for ownership-scoping and idempotency error-handling (both verified against actual codebase files); MEDIUM for EventEmitter error-crash risk (verified against official Node docs, not tested live in this session)

**Research date:** 2026-07-13
**Valid until:** 30 days (stable domain — no fast-moving dependencies; codebase-grounded findings remain valid as long as `errorHandler.js`/`database.js`/service files are unchanged)
