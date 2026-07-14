# Architecture Research

**Domain:** Feature integration into an existing Controller/Service/Repository betting platform (notifications, partial cashout, new market types, cancellation v2)
**Researched:** 2026-07-13
**Confidence:** HIGH for integration patterns (grounded directly in read source: `src/config/database.js`, `src/services/wagerService.js`, `src/services/marketService.js`, `src/repositories/walletRepository.js`, `src/migrations/001_initial.js`, `002_wallet.js`) / MEDIUM-LOW for the generic industry-pattern citations used to validate those choices (single unverified web search per topic — see Sources)

## Standard Architecture (as it exists today)

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ Routes → Controllers → Services → Repositories → PostgreSQL / Redis │
│ (unchanged by this milestone — all 4 features slot into this shape) │
└─────────────────────────────────────────────────────────────────────┘

New pieces this milestone adds, and where they attach:

Services layer                  ┌────────────────────────┐
  wagerService.placeWager   ───▶│  domainEvents (EventEmitter,   │
  wagerService.cashoutWager ───▶│  in-process, singleton)        │──▶ notificationService
  marketService.closeMarket ───▶│  emit AFTER transaction commits│      ───▶ notificationRepository
  marketService.resolveMarket──▶│                                 │            ───▶ notifications table
  wagerService.cancelWagerV2──▶ └────────────────────────┘

Repositories/schema layer
  marketRepository  ──uses──▶ markets (+ market_type discriminator, unchanged odds_yes/odds_no)
                    ──uses──▶ market_options (NEW — over/under thresholds, multiple-choice options)
  wagerRepository   ──uses──▶ wagers (+ market_option_id nullable FK, + cashout tracking columns)
  walletRepository  ──uses──▶ wallets, wallet_transactions (unchanged shape, new related_entity values)
```

The existing request path (`Route → Controller → Service → Repository → DB`) is not changed by any of the four features — they are new services/methods and new/extended tables that plug into the same layering, transaction helper (`transaction()` in `src/config/database.js`), and error-class hierarchy already in place. No new architectural layer is introduced except a small in-process event bus for notifications (see Pattern 1).

### Component Responsibilities

| Component | Responsibility | Typical Implementation Here |
|-----------|----------------|------------------------------|
| `domainEvents` (new) | In-process pub/sub so services announce state changes without knowing who listens | `src/events/domainEvents.js` — a single shared `EventEmitter` instance, module-singleton like `pool`/`redis client` |
| `notificationService` (new) | Subscribes to domain events, decides what notification to write, calls repository | `src/services/notificationService.js` — registers listeners once at startup (from `server.js`, alongside `startScheduler()`) |
| `notificationRepository` (new) | CRUD for `notifications` table, paginated `findByUserId` | `src/repositories/notificationRepository.js` — same shape as existing repositories (accepts optional `client`) |
| `market_options` schema (new) | Type-specific structured data for Over/Under and multiple-choice markets | New table, FK to `markets`, populated by `marketService` when `market_type !== 'binary'` |
| Cashout logic (extends `wagerService`) | Compute + apply partial cashout under lock, write audit row | New method on existing `wagerService`, reusing the `transaction()` + `FOR UPDATE` pattern already used by `placeWager`/`cancelWager` |
| Cancellation v2 (replaces logic in `wagerService.cancelWager`) | Fee-based cancellation with expanded guard clauses | Same method name/route, body replaced — see Pattern 4 |

## Recommended Project Structure (additions only — existing tree unchanged)

```
src/
├── events/
│   └── domainEvents.js       # shared EventEmitter singleton; services `require` and `.emit()`
├── services/
│   ├── notificationService.js   # subscribes to domainEvents, writes notifications
│   ├── wagerService.js          # EXTEND: add cashoutWager(), replace cancelWager() body
│   └── marketService.js         # EXTEND: createMarket()/resolveMarket() branch on market_type
├── repositories/
│   ├── notificationRepository.js   # new
│   ├── marketOptionRepository.js   # new (or fold into marketRepository — see Pattern 3)
│   ├── wagerRepository.js          # EXTEND: cashout columns, market_option_id
│   └── walletRepository.js         # unchanged shape; new related_entity string values only
├── routes/
│   └── notifications.js       # new: GET /, PATCH /:id/read, PATCH /read-all, GET /unread-count
├── controllers/
│   └── notificationsController.js  # new
└── migrations/
    ├── 003_notifications.js       # phase 1
    ├── 004_wager_cashout.js       # phase 2
    ├── 005_market_types.js        # phase 3
    └── 006_wager_cancellation_v2.js # phase 4
```

### Structure Rationale

- **`src/events/`** is new but tiny (one file). It's the seam that lets phase 1 (notifications) exist without every later phase needing to know about `notificationService` internals — later phases just add one `domainEvents.emit(...)` call at the point their transaction commits.
- Migrations are split one-per-phase, matching the mandated one-feature-at-a-time build order in `PROJECT.md`/`requisitos.txt` — each phase ships its own additive migration, never touching a prior phase's migration file.
- No new top-level directories beyond `events/` — everything else fits the existing `controllers/services/repositories/routes` shape, which keeps the four new features indistinguishable in structure from existing code.

## Architectural Patterns

### Pattern 1: Domain-event notification writes (not scattered inline calls)

**What:** Services never call `notificationRepository` or embed "create a notification" SQL directly. Instead, at the point a service's `transaction()` call resolves successfully, the service emits a small, typed event (`market.closed`, `market.resolved`, `wager.won`, `wager.lost`, `wager.cashoutAvailable`) on a shared `EventEmitter`. `notificationService`, registered once at server startup, listens for these events and is the *only* code that writes to the `notifications` table.

**When to use:** Any time a state change should fan out to a concern that isn't essential to the transaction's own correctness (notifications, future analytics, future emails). Not for anything that must be atomic with the money movement itself (that stays inside the `transaction()` callback, using existing repositories directly).

**Why this fits this codebase specifically:** The codebase already has a de facto scheduler-driven event source (`scheduler.js` calling `marketService.closeMarket`/`resolveMarket`), and every financial mutation already goes through the same `transaction(async (client) => {...})` helper. Emitting *after* that promise resolves (not from inside the callback) guarantees a notification is only ever written for a change that actually committed — an emit-inside-rollback bug is structurally impossible because the emit line sits outside the transaction closure.

**Trade-offs:** Notification writes are not atomic with the triggering transaction (a crash between commit and notification write loses a notification). This is explicitly acceptable for this milestone: PROJECT.md scopes notifications as "structure-only," non-realtime, and not part of the financial-integrity constraint (which only binds balance/wallet/wager/cashout/cancellation operations). If this changes later, the fix is to write the notification row inside the same DB transaction as the state change (same `client`) instead of via the event bus — the event-emitter still works for *dispatch* (e.g. future WebSocket push) even if the *write* becomes transactional.

**Example:**
```javascript
// src/events/domainEvents.js
const { EventEmitter } = require('events');
module.exports = new EventEmitter();

// src/services/marketService.js (inside resolveMarket, per-wager loop, after transaction() resolves)
const resolved = await transaction(async (client) => { /* ...unchanged... */ });
domainEvents.emit('market.resolved', { marketId, outcome });
// per-wager win/lose events emitted from inside the loop's results, after commit
return resolved;

// src/services/notificationService.js
domainEvents.on('market.resolved', async ({ marketId, outcome }) => {
  // fetch affected wagers, write one notification per user
});
```

### Pattern 2: Lock-then-revalidate transactions for cashout (reuse existing pattern, don't introduce advisory locks)

**What:** The codebase already has the correct pattern for preventing double-spend races: `SELECT ... FOR UPDATE` on the row being mutated, taken *inside* the `transaction()` helper, followed by re-validating business state (status, balance) using the just-locked row — never using a value read before the lock. `placeWager` does this for `markets` + `wallets`; `cancelWager` and `resolveMarket` do it for `wagers`/`markets`/`wallets`. Partial cashout should do exactly the same: `SELECT * FROM wagers WHERE id = $1 FOR UPDATE`, then re-check `status = 'pending'` and remaining cashoutable amount, all before computing/applying the payout.

**When to use:** Any operation that reads a financial row, computes a value from it, and writes back — which is every operation in this system. Advisory locks (`pg_advisory_xact_lock`) are not needed here: they exist for locking logical resources that aren't rows yet, or that span multiple tables/services with no natural row to lock. Every one of this milestone's operations (cashout, cancellation) maps cleanly to one or two existing rows (`wagers`, `wallets`), so plain row locks are simpler, are enforced by the database (advisory locks are opt-in and can be silently skipped by a forgotten code path), and match the codebase's existing convention exactly.

**Preventing double-cashout specifically:** Two concurrent cashout requests for the same `wager_id` both call `transaction()`. The first to reach `SELECT ... FOR UPDATE` on the wager row wins the lock; the second blocks. When the first commits, the second's `FOR UPDATE` unblocks and re-reads the *post-commit* row — at which point the (new) cashout-state columns show the wager already fully cashed out or in a state that fails validation, and the service throws `ConflictError`. This requires no additional locking primitive beyond what's already used — the correctness comes entirely from re-validating after the lock, not before.

**Lock ordering to avoid deadlocks:** `placeWager` locks `markets` then `wallets`; `resolveMarket` locks `markets` then, per wager, `wagers`/`wallets`. Cashout must follow the same order — lock `markets` (to make sure the market hasn't closed/resolved mid-request), then `wagers`, then `wallets` — every code path that locks more than one of these tables must acquire them in this same global order (markets → wagers → wallets) or a future concurrent cashout + resolution can deadlock.

**Trade-offs:** Row-level locking serializes concurrent cashout attempts on the *same* wager (acceptable — that's the whole point) but does not serialize unrelated wagers, so throughput is unaffected for the common case (different users, different wagers).

**Example (shape to follow, based on `wagerService.cancelWager`):**
```javascript
async cashoutWager(wagerId, userId, requestedAmount) {
  return transaction(async (client) => {
    const wagerRes = await client.query('SELECT * FROM wagers WHERE id = $1 FOR UPDATE;', [wagerId]);
    const wager = wagerRes.rows[0];
    if (!wager) throw new NotFoundError('Aposta não encontrada.');
    if (wager.user_id !== userId) throw new AuthorizationError('Essa aposta não é sua.');

    const marketRes = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [wager.market_id]);
    const market = marketRes.rows[0];
    if (market.status !== 'open') throw new ConflictError('Mercado não está mais aberto pra cashout.');
    if (wager.status !== 'pending') throw new ConflictError('Aposta não elegível pra cashout.');
    // remaining-amount re-check happens here, against the just-locked row — never against a
    // value read before this point, and never against a value sent by the client.

    const cashoutValue = computeCashoutValue(wager, market); // server-side only
    // ...apply to wallet via walletRepository, record wager_cashouts audit row, update wager...
    domainEvents.emit('wager.cashoutExecuted', { wagerId, userId, amount: cashoutValue });
  });
}
```

### Pattern 3: Discriminator column + related table for new market types (not flat polymorphic columns)

**What:** Add a `market_type VARCHAR(20) NOT NULL DEFAULT 'binary'` discriminator column to the existing `markets` table (values: `'binary' | 'over_under' | 'multiple_choice'`). Leave `odds_yes`/`odds_no` exactly as they are today, used only when `market_type = 'binary'`. Add a new `market_options` table (`id, market_id FK, option_key, label, odds, threshold NULLABLE, display_order`) used only by `over_under` and `multiple_choice` markets — one row per option (`over`/`under` for the first, arbitrary N rows for the second).

**When to use:** This is the right call specifically because multiple-choice has an *unbounded* number of options ("dynamic number of options, not capped at 3" — PROJECT.md) — that cannot be flattened into fixed columns on `markets` (which a pure single-table/EAV approach would require). A discriminator + related table is the standard middle ground between single-table inheritance (fast reads, but can't express unbounded per-type children) and full joined-table inheritance (normalized, costs a JOIN for polymorphic reads) — here it's applied selectively: the base type (`binary`) stays flat for zero migration risk to existing code, and only the *new* types get the related table.

**Migration approach that avoids breaking existing binary market code:**
1. `ALTER TABLE markets ADD COLUMN market_type VARCHAR(20) NOT NULL DEFAULT 'binary' CHECK (market_type IN ('binary','over_under','multiple_choice'));` — every existing row backfills to `'binary'` automatically via `DEFAULT`; nothing existing reads or filters on this column yet, so it's a no-op for current behavior.
2. Relax `odds_yes`/`odds_no` from `NOT NULL` to nullable (`ALTER COLUMN ... DROP NOT NULL`), add a table-level `CHECK` that requires them when `market_type = 'binary'` — existing rows already satisfy this (they have values and `market_type = 'binary'`), so the constraint add is safe.
3. `CREATE TABLE market_options (...)` — brand-new table, zero interaction with existing queries.
4. `ALTER TABLE wagers ADD COLUMN market_option_id INTEGER REFERENCES market_options(id);` — nullable, existing wagers keep it `NULL` and keep using `choice` exactly as today.
5. Widen `wagers.choice` from `VARCHAR(3) CHECK (choice IN ('yes','no'))` — the 3-char cap and fixed CHECK list can't hold arbitrary option keys. Drop the CHECK constraint and widen to `VARCHAR(50)`; move the `'yes'/'no'`-only validation for binary wagers into `wagerService` application code (it already validates `choice` there before this — see `placeWager`'s existing `if (choice !== 'yes' && choice !== 'no')`). This is the one migration step that touches an existing column, but it only *relaxes* a constraint — no existing row or query can be invalidated by a widened/loosened check.
6. `marketService.createMarket`/`resolveMarket` and `wagerService.placeWager` stay byte-for-byte unchanged in their binary code path; new branches are added (`if (market_type === 'binary') {...existing code...} else {...new path using market_options...}`), not rewrites. Recommend splitting the per-type resolution logic into small modules (e.g. `src/services/marketResolution/{binary,overUnder,multipleChoice}.js`) that `resolveMarket` dispatches to by `market_type`, rather than growing one large conditional — this is a maintainability recommendation, not a data-model requirement.

**Trade-offs:** Reading a market's full shape (options + odds) now sometimes requires a second query/JOIN against `market_options` for non-binary types, where before it was a single-table read. Given market lists are already small (admin-curated, not user-generated at scale), this is a non-issue at this project's scale.

### Pattern 4: Straight replacement for cancellation v2 (no flag, no versioned endpoint)

**What:** Replace the body of `wagerService.cancelWager` in place, keeping the same method name and the same route (`DELETE /api/wagers/:id` or whatever the existing route is). No `cancelWagerV1`/`cancelWagerV2` dual path, no `X-API-Version` header, no feature flag gating the new behavior.

**When to use:** This is the right call specifically *because* PROJECT.md documents this codebase as pre-production/WIP (uncommitted deletions of `rateLimiter.js`, in-flight modifications across core files at project init) and requisitos.txt's mandated process — implement → review → test positive/negative → test attack vectors → fix, one feature at a time — is itself the safety net that a feature flag or versioned endpoint exists to provide on a *live* system. There is no live traffic or existing financial data this needs to coexist with.

**Why not a flag/versioned endpoint here:** For a money-moving operation, a flag or dual-version setup means two authoritative code paths exist simultaneously, which is precisely the shape of bug class already flagged in `.planning/codebase/ARCHITECTURE.md`'s anti-patterns section ("Unvalidated Market Closing" — validate current state before transition). A dormant "old free-cancel" path left behind a flag is itself new attack surface under the OWASP checklist requisitos.txt mandates (an attacker or a stale frontend build hitting the old path bypasses the new fee/guard logic entirely). Given the codebase has no production users to protect from a cutover, the flag's cost (dead code, doubled test surface, doubled review surface) is pure downside.

**Practical shape of the replacement:**
- Guard clauses added: block when `market.status !== 'open'` (already present), block when `wager.status !== 'pending'` (already present, but now must also explicitly exclude any partial-cashout state introduced in phase 2 — a wager that has had *any* cashout executed must be blocked from cancellation per PROJECT.md's Active requirement), block when a cashout row exists for this wager.
- Fee logic: compute `refund = wager.amount * 0.95` server-side; never accept a client-submitted refund amount.
- Ledger: keep the existing `wallet_transactions` invariant (`amount` always equals the actual balance delta) — credit exactly the 95% refund as one `wallet_transactions` row with `related_entity = 'wager_cancellation'`, and note the 5% fee amount in `description` text rather than inventing a second, zero-balance-impact ledger row (keeps the audit table's meaning — every row is a real balance movement — intact).
- `wagers.status` needs a new allowed value (e.g. `cancelada`) — requires widening the existing `CHECK (status IN ('pending','won','lost','refunded','voided'))` constraint via migration; this is additive (loosens a CHECK), not breaking.
- Same lock-then-revalidate transaction shape as Pattern 2 — lock `wagers` then `markets` (matching existing `cancelWager`'s order) before evaluating any guard clause, so cancellation racing against resolution/closure is handled the same way concurrent cashouts are.

**Sequencing dependency confirmed by this analysis:** Cancellation v2's "blocked if cashout already occurred" guard clause needs the cashout-state columns from phase 2 to exist, which confirms (rather than just asserts) the PROJECT.md-mandated build order Notifications → Cashout → Market Types → Cancellation v2. Market-types awareness (phase 3) is *not* a hard dependency for cancellation — the fee/guard logic is identical regardless of `market_type`, since cancellation never touches `choice`/`market_option_id`.

## Data Flow

### Notifications (phase 1)

```
marketService.closeMarket() / resolveMarket()   [existing methods, extended]
    ↓ (after transaction() commits)
domainEvents.emit('market.closed' | 'market.resolved' | 'wager.won' | 'wager.lost', {...})
    ↓
notificationService (listener registered at server startup)
    ↓
notificationRepository.create(...)
    ↓
notifications table (PostgreSQL)
    ↑
notificationsController.list() ← GET /api/notifications (paginated, read/unread filter)
```

### Partial cashout (phase 2)

```
Client: POST /api/wagers/:id/cashout   (no amount trusted from client beyond "how much to cash out of what's left")
    ↓
wagersController.cashoutWager()
    ↓
wagerService.cashoutWager(wagerId, userId, requestedAmount)
    ↓ transaction()
        SELECT wagers FOR UPDATE → SELECT markets FOR UPDATE → revalidate → compute value server-side
        → walletRepository.adjustBalance() + recordTransaction()
        → wagerRepository update (remaining amount / cashout columns)
        → INSERT wager_cashouts (audit row)
    ↓ (after commit)
domainEvents.emit('wager.cashoutExecuted', {...}) → notificationService
```

### New market types (phase 3)

```
Admin: POST /api/markets  { market_type: 'over_under' | 'multiple_choice', options: [...] }
    ↓
marketsController.createMarket()
    ↓
marketService.createMarket()  — branches on market_type
    ↓                              ↓
  (binary: unchanged path)    (new: validate options[], insert markets row + market_options rows in one transaction)
    ↓
marketRepository.create() + marketOptionRepository.createMany()

Resolution:
marketService.resolveMarket()  — dispatches per-wager payout calc to
  src/services/marketResolution/{binary,overUnder,multipleChoice}.js
  based on market.market_type, using wager.choice (binary) or wager.market_option_id (new types)
```

### Cancellation v2 (phase 4)

```
Client: DELETE /api/wagers/:id   (same endpoint as today)
    ↓
wagersController.cancelWager()   (unchanged)
    ↓
wagerService.cancelWager()   (body replaced)
    ↓ transaction()
        SELECT wagers FOR UPDATE → SELECT markets FOR UPDATE
        → guard: market open? wager pending? no prior cashout row?
        → compute 95%/5% split server-side
        → walletRepository credit 95% + recordTransaction (description notes fee)
        → wagerRepository.updateStatus('cancelada')
    ↓ (after commit)
domainEvents.emit('wager.cancelled', {...}) → notificationService
```

## Scaling Considerations

| Concern | At current scale (single Node process, small user base) | If scaled to multiple instances |
|---------|---|---|
| Domain event bus | In-process `EventEmitter` is sufficient — zero extra infra, matches "structure-only, no realtime" scope | Would need to move to Redis pub/sub (already in the stack) so events fan out across instances — not needed this milestone, but the event-emit call sites don't need to change, only what's listening |
| Row locks (`FOR UPDATE`) on `wagers`/`markets`/`wallets` | Fine — contention only on the same row, which is inherently rare (one user's one wager) | Same — row locking scales with Postgres, not with app instance count; the existing `pool` (`max: 20`) is the real ceiling, already sized for this |
| `market_options` extra JOIN for non-binary markets | Negligible — markets are admin-curated, low cardinality | Same — this table will never be large relative to `wagers`/`wallet_transactions` |

### Scaling Priorities

1. **First realistic bottleneck:** connection pool exhaustion under concurrent cashout/cancellation spikes (each holds a transaction + row lock for the duration of the request) — mitigate by keeping the transaction bodies short (compute values before opening the transaction where possible, not inside it) and monitoring the existing slow-query log in `src/config/database.js` (`query()` already warns >500ms).
2. **Second:** if real-time notification delivery is added in a future milestone, the in-process `EventEmitter` becomes the thing to replace with Redis pub/sub — not a concern for this milestone, but worth knowing the seam (`domainEvents.emit`) is already the right abstraction boundary for that future swap.

## Anti-Patterns

### Anti-Pattern 1: Inline "create notification" calls scattered across services

**What people do:** Add `await notificationRepository.create(...)` directly inside `wagerService`, `marketService`, etc., at every point something notification-worthy happens.

**Why it's wrong:** Every new notification type requires editing an unrelated service; `wagerService`/`marketService` accumulate notification-formatting logic that has nothing to do with wagers/markets; testing wager placement now requires mocking notification writes.

**Do this instead:** Emit a domain event after the transaction commits; let `notificationService` own all notification-writing logic exclusively (Pattern 1).

### Anti-Pattern 2: Reaching for advisory locks by default

**What people do:** Use `pg_advisory_xact_lock` for the cashout/cancellation race because "locking" sounds like it needs a dedicated lock primitive.

**Why it's wrong:** Advisory locks are voluntary (a forgotten call site still races) and solve a different problem (locking a logical resource that isn't a row). This codebase's races are all "read a row, compute, write it back" — exactly what `FOR UPDATE` already handles, and what the codebase already does consistently.

**Do this instead:** `SELECT ... FOR UPDATE` on the specific row(s), inside `transaction()`, re-validate after the lock (Pattern 2).

### Anti-Pattern 3: Flattening multiple-choice options into fixed columns on `markets`

**What people do:** Add `option_1`, `option_2`, `option_3`, `odds_1`, `odds_2`, `odds_3` columns to `markets` to "keep it a single table."

**Why it's wrong:** PROJECT.md explicitly requires multiple-choice to support "a dynamic number of options, not capped at 3" — a fixed-column approach hard-caps it and requires a future migration + code change every time the cap is hit.

**Do this instead:** `market_options` related table, one row per option, unbounded (Pattern 3).

### Anti-Pattern 4: Feature-flagging or versioning a pre-production replacement

**What people do:** Wrap the new cancellation logic in a flag (`CANCELLATION_V2_ENABLED`) or ship it as `POST /api/v2/wagers/:id/cancel` alongside the old route, "to be safe."

**Why it's wrong:** There is no live traffic/data this needs to coexist with (WIP codebase per `PROJECT.md` context notes); a dormant old path is unreviewed attack surface on a money-moving endpoint, which directly conflicts with the OWASP-checklist requirement in `requisitos.txt`.

**Do this instead:** Replace `wagerService.cancelWager`'s body in place, same route, same method name (Pattern 4).

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `wagerService`/`marketService` ↔ `notificationService` | In-process event emit/listen (`domainEvents`), never a direct function call from the wager/market side | Keeps notification logic out of financial services entirely; `notificationService` is the only importer of `notificationRepository` |
| `wagerService.cashoutWager`/`cancelWager` ↔ `walletRepository`/`wagerRepository` | Direct repository calls inside a shared `transaction()` client, same as existing `placeWager` | No new boundary — reuses the exact pattern already in place |
| `marketService` ↔ `market_options` data | Via a new `marketOptionRepository` (or methods added to `marketRepository`) — service layer decides `market_type` branching, repository layer stays dumb CRUD | Keep repository free of `market_type`-conditional logic; branching belongs in the service, consistent with existing convention ("no business logic" in repositories per `STRUCTURE.md`) |
| Scheduler (`src/scheduler.js`) ↔ `marketService` | Unchanged — still calls `closeMarket`/`resolveMarket`; those methods now additionally emit domain events, but the scheduler doesn't need to know that | No change required to `scheduler.js` |

## Sources

- **Primary (HIGH confidence, directly read):** `/srv/www/apostas/src/config/database.js` (transaction helper), `/srv/www/apostas/src/services/wagerService.js`, `/srv/www/apostas/src/services/marketService.js`, `/srv/www/apostas/src/repositories/walletRepository.js`, `/srv/www/apostas/src/migrations/001_initial.js`, `/srv/www/apostas/src/migrations/002_wallet.js`, `/srv/www/apostas/.planning/PROJECT.md`, `/srv/www/apostas/.planning/codebase/ARCHITECTURE.md`, `/srv/www/apostas/.planning/codebase/STRUCTURE.md`
- **Supporting (MEDIUM/LOW confidence — single unverified web search each, used only to validate that the codebase-derived recommendations above match established practice, not as the origin of the recommendation):**
  - [PostgreSQL Concurrency Control: Isolation Levels, Locks, and Real-World Race Conditions](https://nemanjatanaskovic.com/blog/postgresql-concurrency-control-isolation-levels-locks)
  - [Using PostgreSQL advisory locks to avoid race conditions — FireHydrant](https://firehydrant.com/blog/using-advisory-locks-to-avoid-race-conditions-in-rails/)
  - [PostgreSQL: Transactions, Row Locks, and Advisory Locks — David Teather](https://dteather.com/blogs/postgres-advisory-locks/)
  - [PostgreSQL Documentation: Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)
  - [Decoupling Logic with Domain Events — Khalil Stemmler](https://khalilstemmler.com/articles/typescript-domain-driven-design/chain-business-logic-domain-events/)
  - [Domain Event Pattern for Decoupled Architectures — DEV Community](https://dev.to/horse_patterns/domain-event-pattern-for-decoupled-architectures-50mf)
  - [Complete Guide: Inheritance strategies with JPA and Hibernate — Thorben Janssen](https://thorben-janssen.com/complete-guide-inheritance-strategies-jpa-hibernate/)
  - [Mapping Class Inheritance Hierarchies — SQLAlchemy Documentation](https://docs.sqlalchemy.org/en/21/orm/inheritance.html)

---
*Architecture research for: online betting/wagering platform — feature integration into existing layered Node.js/PostgreSQL/Redis architecture*
*Researched: 2026-07-13*
