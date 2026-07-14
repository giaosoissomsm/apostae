# Phase 1: Notifications Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-13
**Phase:** 1-Notifications-Infrastructure
**Areas discussed:** Trigger scope, Wager events mapping, Market cancel mapping, Frontend surface, Read/unread behavior, Notification content

---

## Trigger scope

Initial multi-select question (frontend surface / trigger scope / read-unread / content) was interrupted by the user, who chose to clarify trigger scope directly with a detailed freeform answer instead of picking from presented options.

**User's answer (freeform):** Include all user-facing wager lifecycle events: new wager created, wager accepted, market closed, market settled, wager won, wager lost, wager cancelled, market cancelled, market deleted, refund processed, partial cashout completed (future phase compatibility), and any status transition that changes the user's balance or requires user attention. Notification system must be event-driven, decoupled from wagerService/marketService directly (domain events so future integrations — email, push, WhatsApp, Telegram, mobile — can subscribe without changing business logic), and duplicate notifications must be prevented via idempotent event processing.

**Notes:** This significantly expanded the initial NOTIF-05 "any other relevant status change" framing into an explicit event catalog, and added an architecture mandate (event-driven, decoupled, idempotent) that aligns with — and reinforces — the pattern already recommended in `.planning/research/ARCHITECTURE.md`.

---

## Wager events mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Single event: wager placed | One 'wager.placed' event covers both created+accepted, matching how placeWager() actually works today (one atomic step, no separate acceptance) | ✓ |
| Two separate events | Emit 'wager.created' and 'wager.accepted' as distinct events for future-proofing | |

**User's choice:** Single event: wager placed
**Notes:** Confirmed against the codebase — `wagerService.placeWager()` has no separate acceptance/matching step.

---

## Market cancel mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Same as market deleted | Treat 'market cancelled' as the existing deleteMarket() flow (already refunds pending wagers); just emit a notification event from it | ✓ |
| New capability needed | Build an actual distinct 'cancel market' action, different from delete — new scope beyond notifications infrastructure | |

**User's choice:** Same as market deleted
**Notes:** No cancel-market method exists in `marketService.js` today (only close, resolve, delete). Avoids scope creep into building new market-management capability during a notifications phase.

---

## Frontend surface

| Option | Description | Selected |
|--------|-------------|----------|
| Backend API only | Domain-events + notification service + DB + paginated REST endpoint, no frontend changes | ✓ |
| Include a minimal frontend widget | Also add a basic notification bell/list to public/index.html this phase | |

**User's choice:** Backend API only
**Notes:** Matches REQUIREMENTS.md's "structure only" framing; ROADMAP.md doesn't flag Phase 1 as having a UI (unlike Phase 3).

---

## Read/unread behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit mark-as-read only | Listing never changes read state; separate mark-as-read endpoint required | ✓ |
| Auto-mark-read on fetch | Fetching/viewing the list automatically marks returned items as read | |

**User's choice:** Explicit mark-as-read only

---

## Notification content

| Option | Description | Selected |
|--------|-------------|----------|
| Specific with amount/market name | e.g. "Sua aposta de R$50 em \"Time A vence?\" venceu! +R$95" | ✓ |
| Generic status-only | e.g. "Sua aposta mudou de status" | |

**User's choice:** Specific with amount/market name
**Notes:** Matches existing Portuguese-language app tone.

---

## Claude's Discretion

- Exact domain-event payload schema (field names/types)
- Exact idempotency-key mechanism (unique constraint vs explicit event_id column)
- Whether bulk "mark all read" ships in v1 or just single mark-as-read
- Notifications table schema details beyond what NOTIF-06/07/08 require

## Deferred Ideas

- Frontend notification bell/list UI — later phase/milestone
- Real-time delivery (WebSocket/SSE) — already deferred at project level
- Email/push/WhatsApp/Telegram delivery — only extensibility required now, not built
- Cashout-available notification — Phase 2 doesn't exist yet; only forward-compat in event catalog
