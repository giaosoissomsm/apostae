# Phase 1: Notifications Infrastructure - Context

**Gathered:** 2026-07-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Users are notified of key wager and market lifecycle events. Notifications are stored in PostgreSQL, support read/unread state, are paginated, and are exposed via a dedicated, ownership-scoped REST API. No push transport (WebSocket/SSE) this phase — structure only, but the design must not require a rewrite when real-time delivery is added later (NOTIF-10). No frontend UI this phase (backend/API only, per decision below).

This phase also establishes the **event-driven architecture** (domain events + single notify() chokepoint) that Phases 2-4 (cashout, new market types, cancellation v2) will reuse to emit their own notification events.

</domain>

<decisions>
## Implementation Decisions

### Architecture — event-driven, not service-coupled
- **D-01:** Notification writing MUST be event-driven via a domain-event bus (e.g. `src/events/domainEvents.js`, a Node `EventEmitter` singleton). `wagerService` and `marketService` MUST NOT call notification-writing code directly — they emit domain events (after their `transaction()` call resolves, matching the codebase's existing transaction-boundary convention). A dedicated `notificationService`, subscribed to the bus, is the sole writer to the `notifications` table.
- **D-02:** This decoupling is explicitly for future extensibility — the user wants future integrations (email, push, WhatsApp, Telegram, mobile apps) to be able to subscribe to the same domain events without touching `wagerService`/`marketService` business logic. Design the event bus/payload shape generically (event type + user id + relevant entity ids/amounts), not as a "notifications-only" mechanism.
- **D-03:** Event processing MUST be idempotent — duplicate delivery/retry of the same underlying event must not create duplicate notification rows. Use a stable idempotency key per (event source, entity id, event type) — e.g. a unique constraint on `(user_id, type, related_entity, related_id)` or an explicit `event_id` column, planner's choice of exact mechanism.
- **D-04:** This matches (and should follow) the pattern already recommended in `.planning/research/ARCHITECTURE.md` — do not diverge from that research without a reason.

### Trigger event catalog (confirmed scope for this phase)
- **D-05:** Full event catalog to wire up this phase:
  1. `wager.placed` — single event covering both "created" and "accepted" (placeWager() creates the wager as `pending` in one atomic step today — there is no separate acceptance/matching step in this codebase, so these do NOT become two events)
  2. `market.closed` — from `marketService.closeMarket()`
  3. `market.resolved` (settled) — from `marketService.resolveMarket()`
  4. `wager.won` — emitted per-wager inside `resolveMarket()`'s payout loop
  5. `wager.lost` — emitted per-wager inside `resolveMarket()`'s payout loop
  6. `wager.cancelled` — from the existing `wagerService.cancelWager()` (which today sets wager status to `'refunded'` — this is the existing free/pending-only cancellation, not the Phase 4 fee-based rework; one event covers it, no separate "refund processed" event needed for this path)
  7. `market.deleted` — from `marketService.deleteMarket()`. This is ALSO what "market cancelled" maps to: there is no separate cancel-market method in the codebase (only close/resolve/delete) — do not build one; treat "market cancelled" as this existing delete flow, which already refunds pending wagers. Refunds triggered by this path notify via this same event, not a separate one.
  8. `wager.cashed_out` — **not implemented this phase** (Phase 2 doesn't exist yet), but the event bus and notification-type enum/schema MUST be designed so this event can be added in Phase 2 without a rewrite (forward compatibility only — no cashout logic in this phase).
- **D-06:** Any other balance-affecting or attention-requiring wager/market status transition not explicitly listed above should flow through the same generic event-bus mechanism rather than being hardcoded as a one-off — the bus/service should not be a fixed switch statement that requires editing for every new event type added by later phases.

### Frontend surface
- **D-07:** Backend API only this phase. No changes to `public/index.html` or other frontend files. Frontend wiring (notification bell/list) is explicitly deferred to a later phase/milestone.

### Read/unread behavior
- **D-08:** Listing notifications (GET, paginated) NEVER changes read state as a side effect. Marking read is an explicit, separate action (single notification and/or bulk "mark all read" — planner's choice on whether both are needed for v1, but at minimum single mark-as-read is required per NOTIF-07).

### Notification content
- **D-09:** Notification text must be specific, not generic — include amount and market name/question where relevant (e.g. "Sua aposta de R$50 em \"Time A vence?\" venceu! +R$95"), matching the existing Portuguese-language tone used elsewhere in the app (see `wagerService.js`/`marketService.js` log/error message style for tone reference).

### Claude's Discretion
- Exact domain-event payload schema (field names/types) — design for extensibility per D-02, but the specific shape is an implementation detail.
- Exact idempotency-key mechanism (unique constraint vs explicit event_id column) — per D-03, either is acceptable.
- Whether bulk "mark all read" ships in v1 or just single mark-as-read (NOTIF-07 only requires single).
- Notifications table schema details (indexes, exact column names) beyond what's required by NOTIF-06/07/08.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & requirements
- `.planning/PROJECT.md` — project context, core value, constraints (financial integrity, security, concurrency)
- `.planning/REQUIREMENTS.md` §Notifications (NOTIF) — NOTIF-01 through NOTIF-10, the locked requirement set for this phase
- `.planning/ROADMAP.md` §Phase 1 — phase goal and success criteria

### Research (produced this milestone)
- `.planning/research/ARCHITECTURE.md` — recommends the exact event-driven pattern locked in D-01/D-02 (domain EventEmitter + notificationService as sole writer); this phase's plan should match it
- `.planning/research/PITFALLS.md` — flags notification IDOR (ownership-check-on-every-query, including by-ID routes) as the precedent-setting pattern for all later phases; flags idempotency as a cross-cutting gap in the codebase today
- `.planning/research/STACK.md` — recommends the `notify()` chokepoint design and no new npm dependencies needed (hand-rolled Postgres + service-layer pattern)
- `.planning/research/FEATURES.md` — table-stakes vs anti-feature breakdown (explicitly: no promotional/marketing notification types, ever — only transactional ones)

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — existing layered architecture (Controllers → Services → Repositories), transaction() helper, existing FOR UPDATE locking pattern to be consistent with
- `.planning/codebase/STACK.md` — confirms no new dependencies needed; existing stack (Express, pg, Redis, JWT auth)

### Source brief (repo root, Portuguese)
- `prompt.txt` — original feature brief, §1 "Notificações de mercados"
- `requisitos.txt` — mandatory process/security requirements (OWASP ASVS/Top 10, transactional financial ops, one-feature-at-a-time)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config/database.js` `transaction()` helper — use for any notification-table writes that need to be atomic with the triggering operation, or fire-and-forget after commit per D-01
- `src/utils/errors.js` error class hierarchy (ValidationError, NotFoundError, AuthorizationError, etc.) — reuse for the new notifications endpoints
- `src/utils/logger.js` — reuse existing structured logging conventions
- Existing `audit_logs` table pattern (action, target user, JSONB changes, created_at) — a useful schema reference for the new `notifications` table, though notifications need read/unread state which audit_logs doesn't

### Established Patterns
- Controller → Service → Repository layering, one file per resource — a new `notificationsController.js` / `notificationService.js` / `notificationRepository.js` triad should follow this exactly
- `catchAsync` wrapper on all controller handlers
- Repositories accept an optional `client` param for transaction support; parameterized queries exclusively
- `requireAuth` middleware attaches `req.user` — all new notification routes must scope queries to `req.user.id`, never trust a user id from params/body (matches D-nothing-new, this is existing convention: "owner is always userId from the token")
- Migrations are numbered sequentially in `src/migrations/`; next migration is `003_*.js` (001_initial.js, 002_wallet.js exist)

### Integration Points
- `marketService.closeMarket()`, `marketService.resolveMarket()`, `marketService.deleteMarket()`, `wagerService.cancelWager()`, `wagerService.placeWager()` — these are the emission points for domain events per D-05. Each should emit AFTER its `transaction()` resolves successfully (don't emit on rollback).
- New route file `src/routes/notifications.js` (or similar), following the existing one-file-per-resource pattern (`src/routes/markets.js`, `src/routes/wagers.js`)
- Server bootstrap (`server.js`) — new route mount point needed alongside existing `/api/markets`, `/api/wagers`, etc.

</code_context>

<specifics>
## Specific Ideas

- Notification copy should read naturally in Portuguese and match the tone already used in service-layer log/error messages (e.g. "Sua aposta #123 no mercado #45 venceu!" style), not a generic templated string.
- The event bus is explicitly meant to outlive this phase — every later phase (cashout, cancellation v2, new market types) is expected to plug into the same mechanism, and eventually non-notification subscribers (email/push/WhatsApp/Telegram) too. Treat this as a piece of shared infrastructure, not a notifications-only detail.

</specifics>

<deferred>
## Deferred Ideas

- **Frontend notification bell/list UI** — explicitly deferred (D-07); backend API only this phase.
- **Real-time delivery (WebSocket/SSE)** — already deferred at the project level (PROJECT.md Out of Scope); this phase only needs to avoid architectural choices that would force a rewrite later.
- **Email/push/WhatsApp/Telegram notification delivery** — not built this phase; only the extensibility (domain events any subscriber can hook into) is required now.
- **Cashout-available notification** — not built this phase (Phase 2 doesn't exist yet); only forward-compatibility in the event catalog/schema (D-05, item 8).

### Reviewed Todos (not folded)
None — no pending todos matched this phase.

</deferred>

---

*Phase: 1-Notifications-Infrastructure*
*Context gathered: 2026-07-13*
