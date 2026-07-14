# Stack Research

**Domain:** Feature-expansion stack for an existing Node.js/Express + PostgreSQL + Redis betting platform (notifications, partial cashout, new market types, paid cancellation)
**Researched:** 2026-07-13
**Confidence:** MEDIUM (web-sourced patterns cross-verified across multiple independent sources; codebase-grounded recommendations are HIGH — derived directly from existing migrations/services, not third-party claims)

## Headline Recommendation

**Add zero new core dependencies for this milestone.** Every feature in scope (notifications, partial cashout, new market types, cancellation v2) is a data-modeling and service-layer problem that the existing stack (Express, `pg`, Redis, Joi, the existing `transaction()` helper, the existing `FOR UPDATE` locking pattern already used in `marketService.resolveMarket()`) already solves. The 2025/2026 "standard approach" for all three research questions is **hand-rolled on top of Postgres**, not a new library — pulling in a notification framework or a cashout/ledger package would be over-engineering for this codebase's scale and would fight the existing layered architecture.

The one thing worth *installing* is `helmet` for the security headers gap already flagged in `CONCERNS.md` — not required by this research's three questions, but adjacent enough to mention since new financial endpoints are being added. Not a hard requirement of this doc; see Gaps below.

## Recommended Stack

### Core Technologies

No additions. Reuse:

| Technology | Version (existing) | Purpose for this milestone | Why |
|------------|---------|-----------------|-----------------|
| `pg` | ^8.11.3 (unchanged) | Notifications table, wager_cashouts ledger table, new market-type columns | Already the only DB access layer; raw SQL + prepared statements is the established convention (`CONVENTIONS.md`) |
| Redis (`redis` ^4.6.14) | unchanged | Optional unread-count cache; future pub/sub fan-out hook for realtime | `redis` v4's client already supports `duplicate()` + `subscribe()`/`publish()` natively — no new package needed when realtime is eventually built |
| Joi | ^17.12.0 (unchanged) | Validate notification query params, cashout amount, new market-type payloads | Already a dependency; `ARCHITECTURE.md` flags it as "imported but not consistently applied" — this milestone is a good forcing function to actually use it on every new endpoint |
| Express | ^4.19.2 (unchanged) | New routes: `/api/notifications`, `/api/wagers/:id/cashout`, market-type endpoints | No reason to introduce a router framework change for 4 new resource groups |

### Supporting Libraries (only if you want them — none is required)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `helmet` | ^8.x | Security headers (CSP, X-Frame-Options, etc.) | Not required by this research, but you're touching `server.js` middleware stack anyway this milestone and `CONCERNS.md` already flags the gap as a known risk. Cheap to add, zero architectural impact. Optional — flag to the roadmap owner rather than assume. |
| `pg-listen` | ^1.x | Wraps Postgres `LISTEN`/`NOTIFY` with reconnect handling | **Not needed now.** Only relevant if a *future* milestone chooses Postgres-native pub/sub over Redis pub/sub for realtime notification delivery. Documented here only so the future milestone doesn't have to re-research it. |

### Development Tools

No new dev tools needed for this research's scope. (Test framework selection is out of scope for this document — see `TESTING.md`, which already documents the gap; note the "Mocha+Chai/Sinon" reference in milestone context does not match current `package.json`, which has no test framework installed at all — flag this discrepancy to the roadmap, it is a pre-existing gap, not something this research introduces.)

## Installation

```bash
# Nothing required for this milestone's in-scope features.

# Optional, adjacent hardening (discuss with roadmap owner before adding):
npm install helmet
```

---

## Question 1: In-app notifications (Postgres-backed, read/unread, paginated)

**Verdict: hand-rolled table + repository/service, no library.** There is no dominant, widely-adopted npm package for "in-app notification center on Postgres" the way there is for, say, auth (Passport) or validation (Joi) — every real implementation surveyed hand-rolls the table and a thin CRUD layer, because the domain is simple enough (write on event, read paginated, mark read) that a dependency adds more overhead (schema opinions, migration lock-in) than it saves. **Confidence: MEDIUM** (cross-verified across multiple independent guides/blogs, no single authoritative spec, but the pattern was consistent everywhere).

**Recommended schema** (new migration, following existing `src/migrations/NNN_*.js` convention):

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,        -- 'market_closed' | 'market_resolved' | 'bet_won' | 'bet_lost' | 'status_change' | 'cashout_available'
  title VARCHAR(200) NOT NULL,
  body TEXT,
  related_entity VARCHAR(50),       -- 'market' | 'wager' -- mirrors wallet_transactions.related_entity convention already in the codebase
  related_id INTEGER,
  read_at TIMESTAMP,                -- NULL = unread; timestamp = read (avoids a separate boolean + timestamp pair going out of sync)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
```

Rationale for `read_at TIMESTAMP` over `is_read BOOLEAN`: one column instead of two that must stay consistent, and it directly answers "when was it read" for free (useful for future analytics/UX) without extra storage. This mirrors the codebase's own convention of using `deleted_at`/`resolved_at` timestamps rather than booleans elsewhere (`ARCHITECTURE.md`: "Soft Deletes... use `deleted_at` timestamps instead of hard deletes").

**Pagination — do NOT repeat the existing bug.** `CONCERNS.md` already flags two endpoints (`listMarkets`, wager listing) with unbounded `SELECT * ... ORDER BY created_at DESC` and no `LIMIT`. Do not add a third. Use standard `LIMIT`/`OFFSET` with a hard server-side cap (e.g., `limit = Math.min(Number(query.limit) || 20, 100)`), sorted by `created_at DESC, id DESC` for stable ordering (single-column sorts on non-unique timestamps can reorder/duplicate rows across pages when multiple notifications share a timestamp — `id` as tiebreaker fixes this). Given this platform's per-user notification volume is unlikely to reach page-1000-of-offset-pagination territory, `LIMIT`/`OFFSET` is fine; keyset/cursor pagination is a nice-to-have, not a requirement, at this scale.

**Service-layer shape** (follows existing Controller → Service → Repository convention exactly):
- `notificationRepository.create(client, {userId, type, title, body, relatedEntity, relatedId})` — accepts an optional transaction `client`, same pattern as existing repositories, so it can be called **inside** the same transaction as the event that triggers it (e.g., inside `marketService.resolveMarket()`'s existing transaction, not as a separate fire-and-forget call after commit). This matters for consistency: if the market-resolution transaction rolls back, the notification must not have been written either.
- `notificationService.listForUser(userId, {page, limit, unreadOnly})`, `notificationService.markRead(userId, notificationId)`, `notificationService.markAllRead(userId)`, `notificationService.getUnreadCount(userId)`.
- **Unread count caching (optional):** if the frontend polls an unread-count badge frequently, cache it in Redis (`notif:unread:{userId}`, short TTL, same pattern as existing `REDIS_CACHE_TTL` usage) rather than hitting Postgres on every poll. Invalidate (`redis.del`) on write and on mark-read. This is optional — only add it if the roadmap's UAT reveals polling frequency is high enough to matter; don't pre-optimize.

## Question 2: Partial cashout — payout calculation and data model

**Important context this platform-specific finding changes the standard answer:** the generic "how bookmakers calculate cash-out" formula from web research is `CashOut = PotentialPayout × CurrentWinProbability − HouseMargin`, driven by a **live/current odds feed** (confirmed by every source checked — Wizardslots, Bet442, Bookmakers.bet, betcalcul.com all describe cash-out as algorithm-driven off *live* odds). **This platform has no live odds feed and never will for this milestone** — verified directly in the codebase: `markets.odds_yes`/`odds_no` are admin-set fixed values at market creation (`src/migrations/001_initial.js`), captured once per wager as `wagers.odds_at_time` (`src/services/wagerService.js:32-33`), and never move with volume or time (no parimutuel repricing exists). **Confidence on this specific finding: HIGH** (grounded in reading the actual schema/service code, not a web claim).

This means the textbook cash-out formula cannot be applied honestly — there is no live probability signal to plug in. Two implementation choices, and a recommendation:

**Option A (recommended): stake-proportional partial refund, no payout-based upside.**
`cashoutValue = cashoutStakePortion × (1 − houseMarginPercent)` — i.e., structurally identical to the already-planned cancellation-v2 mechanism (5% fee, 95% refund), just applied to a *portion* of the stake instead of the whole wager, and leaving the remainder of the stake active in the wager at its original odds. This is the safe choice for a fixed-odds house with no live pricing: it never lets a user extract more than they staked before the outcome is known, so there is no window for a user with better information than the house (or a leaked/guessed outcome) to arbitrage a risk-free profit by cashing out a "sure winner" near its full potential payout. Reuse the exact fee-calculation helper being built for cancellation v2 rather than writing a second formula — same math, different trigger.

**Option B (textbook-style, not recommended here without further product input): probability-weighted payout.**
`cashoutValue = cashoutStakePortion × oddsAtTime × impliedProbabilityProxy × (1 − houseMargin)`, using `1/oddsAtTime` as a static probability proxy in place of a live feed. This is closer to "real" bookmaker cash-out UX (locks in a share of the *potential winnings*, not just the stake) but is financially riskier for this platform: since the proxy probability never updates, it can't reflect that an outcome has become more/less likely as the event approaches resolution, which is the entire point of cash-out in real sportsbooks. Building this without a live signal risks giving the house a bad deal in a way that's hard to detect until it's exploited. **Flag Option B to the roadmap owner as a product decision, not a default — do not implement without an explicit choice**, since `PROJECT.md` requirements don't specify the formula and this is exactly the kind of ambiguity `requisitos.txt`'s "server-side only, never trust client" mandate is meant to guard against getting wrong.

**Data model for repeated partial cashouts against one wager** — standard fintech ledger pattern (immutable append-only ledger + a running "remaining" figure), confirmed independently across multiple ledger-architecture sources (Formance, dev.to Postgres-money-transactions writeup, DashDevs). **Confidence: MEDIUM.** This maps directly onto the pattern the codebase already uses for `wallet_transactions` (append-only, `related_entity`/`related_id`, `balance_before`/`balance_after`) — extend that convention rather than inventing a new one:

```sql
-- Add to wagers (new migration)
ALTER TABLE wagers ADD COLUMN cashed_out_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
  CHECK (cashed_out_amount >= 0 AND cashed_out_amount <= amount);
-- status already has a CHECK constraint listing valid values; extend it to include
-- 'partially_cashed_out' (still active, remainder live) — do NOT reuse 'refunded' or 'voided',
-- those mean something different (whole-wager, non-user-initiated).

CREATE TABLE IF NOT EXISTS wager_cashouts (
  id SERIAL PRIMARY KEY,
  wager_id INTEGER NOT NULL REFERENCES wagers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  stake_amount NUMERIC(12, 2) NOT NULL CHECK (stake_amount > 0),   -- portion of original stake being cashed out
  payout_amount NUMERIC(12, 2) NOT NULL CHECK (payout_amount >= 0), -- amount actually credited to wallet
  remaining_stake_after NUMERIC(12, 2) NOT NULL CHECK (remaining_stake_after >= 0),
  idempotency_key UUID NOT NULL,   -- see concurrency note below
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_wager_cashouts_wager_id ON wager_cashouts(wager_id);
```

Every cashout writes one immutable `wager_cashouts` row and increments `wagers.cashed_out_amount` in the same transaction — never edit or delete a past cashout row (matches the codebase's existing "audit trail must be immutable" concern already flagged in `CONCERNS.md`'s cascade-delete finding).

**Concurrency (directly answers "protected against duplicate/simultaneous cashout"):** cross-verified pattern across multiple sources — lock the row, re-validate the invariant *after* acquiring the lock, inside the same transaction as the write. Concretely, reuse the exact pattern `marketService.resolveMarket()` already uses (`FOR UPDATE` inside a transaction, per `ARCHITECTURE.md`):

```sql
BEGIN;
SELECT amount, cashed_out_amount, status FROM wagers WHERE id = $1 FOR UPDATE;
-- validate: status = 'pending' or 'partially_cashed_out'; requested <= (amount - cashed_out_amount)
-- compute payout per Option A formula
INSERT INTO wager_cashouts (...) VALUES (...);  -- idempotency_key UNIQUE constraint rejects duplicate resubmits
UPDATE wagers SET cashed_out_amount = cashed_out_amount + $requested, status = ... WHERE id = $1;
UPDATE wallets SET balance = balance + $payout WHERE user_id = $2;
INSERT INTO wallet_transactions (...) VALUES (..., related_entity = 'wager_cashout', related_id = $wager_cashout_id);
COMMIT;
```

The `idempotency_key` (client-generated UUID, e.g. from a "submit once" frontend token) directly closes the "no idempotency for financial operations" gap `CONCERNS.md` already calls out as a known risk for this exact class of operation (double-submit on retry/double-click). Have the client generate and send it; reject duplicates via the `UNIQUE` constraint rather than an application-level check (removes the TOCTOU race an app-level check would have).

## Question 3: Preparing notifications for a future WebSocket/SSE upgrade without building it now

**Confidence: MEDIUM** (cross-verified across multiple current guides on Node.js realtime patterns; this is architectural judgment applied to those findings, not a single authoritative source).

Two structural choices now avoid a rewrite later, and neither requires installing anything:

**1. Single write-path chokepoint.** All notification creation must go through one function — `notificationService.notify({userId, type, title, body, relatedEntity, relatedId}, client)` — called from inside the existing service-layer transactions that already produce these events (market resolution, wager settlement, cashout). No controller or scheduler code should `INSERT INTO notifications` directly. This is the load-bearing decision: when realtime is eventually added, the *only* change needed is inside this one function — after the Postgres write commits, additionally call `redis.client.publish('notifications:{userId}', payload)` (or an in-process `EventEmitter` if single-instance). Every producer of notifications is already funneled through it, so nothing else in the codebase has to change. Skipping this and letting each service `INSERT` directly would mean hunting down every call site later.

**2. Recommend SSE over WebSocket for the eventual realtime transport** (informational for the roadmap's future milestone, not something to build now): this delivery is server→client only (no client-to-server streaming need — users don't push data back through the notification channel), and for that shape, current guidance consistently favors SSE: it runs over plain HTTP so it passes through the existing reverse-proxy setup this app already documents (`ARCHITECTURE.md` notes a reverse proxy is recommended) without special WebSocket upgrade configuration, auto-reconnects natively in the browser (`EventSource`), and is simpler to operate at this codebase's scale. WebSocket is justified only if a future requirement needs client→server push through the same channel, which nothing in this milestone's scope does. When that future milestone arrives, `redis` v4 (already a dependency) supports `publish`/`subscribe` out of the box via `client.duplicate()` — no new package required even then, unless multi-instance fan-out complexity grows enough to justify a dedicated library (not the case at this app's current scale).

**Do not build either transport now.** `PROJECT.md` is explicit that realtime is out of scope this milestone; the only obligation is that the notify() chokepoint exists so bolting it on later is additive, not a refactor.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Hand-rolled `notifications` table + service | A notification-as-a-service SaaS (Novu, Knock, Courier) | Only if this platform later needs multi-channel delivery (email/SMS/push) with a management UI for templates — massive overkill for "read/unread in-app list" at this scale, and adds an external dependency to a financial-data-adjacent flow |
| Stake-proportional cashout (Option A) | Probability-weighted cashout (Option B) | Only if the product explicitly wants "real bookmaker" cash-out UX and accepts the added exploit-surface risk of a static, non-live probability proxy — requires an explicit product decision, not a default |
| Append-only `wager_cashouts` ledger + running `cashed_out_amount` column | Fully event-sourced wallet (rebuild balance from ledger on every read, no cached balance column) | Only if audit/replay requirements become stricter than "balance must reconcile with transactions" — the codebase already uses cached-balance-plus-audit-log (`wallets.balance` + `wallet_transactions`), so matching that existing pattern is more consistent than switching philosophy for one feature |
| SSE for future realtime | WebSocket for future realtime | Only if a future feature needs the client to push data back over the same persistent connection (this milestone and the "future milestone" described in `PROJECT.md` are both server→client only) |
| Redis pub/sub (existing dependency) for future fan-out | Postgres `LISTEN`/`NOTIFY` (`pg-listen`) | If a future milestone wants to avoid a Redis dependency for pub/sub specifically, or wants transactional guarantees tied to the same DB transaction that wrote the notification row — legitimate alternative, but adds a new package where Redis already does the job with zero new dependencies |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| A generic "notifications" npm package (e.g. framework-specific notification-center libraries) | None has meaningful adoption/maintenance for a plain Express+pg stack; pulls in schema/opinion lock-in for a feature that's ~80 lines of repository code | Hand-rolled table + repository, as above |
| `is_read BOOLEAN` + separate `read_at` column | Two fields that can go out of sync (read=true but read_at null, or vice versa) if a code path updates one and not the other | Single `read_at TIMESTAMP`, `NULL` = unread |
| Cash-out priced against `potential_payout` without a live probability signal (Option B) as a silent default | Creates a risk-free arbitrage window for anyone who can guess/knows the likely outcome before resolution, on a platform with zero live-pricing mechanism to defend against it | Option A (stake-proportional, same mechanism as the already-planned cancellation fee) unless the roadmap owner explicitly signs off on Option B with the risk understood |
| Building WebSocket/SSE infrastructure this milestone | Explicitly out of scope per `PROJECT.md`; no existing infra, and premature realtime work would delay the four in-scope features under `requisitos.txt`'s "one feature at a time" mandate | The single `notify()` chokepoint pattern (Question 3) — all the prep needed, zero transport code |
| `OFFSET`-based pagination without a `LIMIT` cap or stable sort tiebreaker | This is the exact bug already flagged twice in `CONCERNS.md` (`listMarkets`, wager listing) — adding a third unbounded/unstable-sort endpoint repeats known tech debt | `LIMIT` (server-enforced max) + `ORDER BY created_at DESC, id DESC` |
| Application-level "check then insert" duplicate-cashout guard | Time-of-check-to-time-of-use race under concurrent requests — exactly the class of bug `CONCERNS.md` already flags as a gap ("No idempotency for financial operations") | `UNIQUE` constraint on a client-supplied `idempotency_key`, enforced by Postgres, combined with `SELECT ... FOR UPDATE` on the wager row |

## Stack Patterns by Variant

**If notification volume per user stays low (expected for this platform's scale):**
- Plain `LIMIT`/`OFFSET` pagination is sufficient
- No Redis caching of unread count needed initially — add only if UAT shows polling load matters

**If a future milestone adds email/SMS notification fan-out (explicitly out of scope now):**
- Keep the `notify()` chokepoint as the fan-out point — add channel dispatch there, not at every call site
- This is exactly why the chokepoint from Question 3 is worth building now even though realtime itself isn't

**If the product later wants "real" probability-weighted cash-out (Option B):**
- Requires first building *some* probability signal (e.g., admin-adjustable "current likelihood" per market, or volume-weighted pool odds) — that is a separate, larger feature than this milestone's cashout work and should be scoped as its own phase, not folded into partial cashout

## Version Compatibility

No new packages introduced, so no new compatibility surface. Existing constraint worth restating: `wagers.status` and `wallet_transactions.type` are Postgres `CHECK` constraints on fixed value lists (`src/migrations/001_initial.js`, `002_wallet.js`) — any new status/type value (`partially_cashed_out`, `cancelled`, a new `wallet_transactions.type` for cashout credits) requires an `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT` migration, not just an application-side change. Plan migrations for cashout and cancellation-v2 phases accordingly.

## Sources

- WebSearch (multiple queries, cross-verified, confidence MEDIUM per `classify-confidence --provider websearch --verified`):
  - Notification schema/pagination pattern: oneuptime.com, Medium (Rahul Anandeshi), PostgreSQL docs (NOTIFY), andywer/pg-listen (GitHub), pedroalonso.net, dev.to (polliog), bjorngylling.com
  - Cash-out formula: talacote.com, wizardslots.com, bet442.co.uk, bookmakers.bet, easyslots.com, bettingtools.com, boydsbets.com, betcalcul.com
  - Ledger/partial-withdrawal pattern: formance.com, dev.to (igornosatov_15, "$2.3 Million Lesson"), sdk.finance, dashdevs.com
  - SSE vs WebSocket / notification abstraction: grapeup.com, dev.to (young_gao), hirenodejs.com, oneuptime.com, websocket.org, GitHub (triblondon/node-sse-pubsub, schwarzkopfb/sse-broadcast)
- Codebase (confidence HIGH — read directly, not inferred):
  - `/srv/www/apostas/src/migrations/001_initial.js` — `markets`, `wagers` schema (fixed odds confirmed, no live pricing)
  - `/srv/www/apostas/src/migrations/002_wallet.js` — `wallets`, `wallet_transactions` schema (existing ledger convention)
  - `/srv/www/apostas/src/services/wagerService.js` — odds captured at wager time, never updated
  - `/srv/www/apostas/.planning/codebase/CONCERNS.md` — existing pagination gaps, idempotency gap, audit-immutability concern
  - `/srv/www/apostas/.planning/codebase/ARCHITECTURE.md` — `FOR UPDATE` locking convention, transaction helper pattern, soft-delete/timestamp convention
  - `/srv/www/apostas/package.json` — confirms current dependency set, no test framework installed

---
*Stack research for: ApostaE feature-expansion milestone (notifications, partial cashout, new market types, cancellation v2)*
*Researched: 2026-07-13*
