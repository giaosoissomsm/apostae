---
phase: 01-notifications-infrastructure
reviewed: 2026-07-14T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/controllers/notificationsController.js
  - src/events/domainEvents.js
  - src/migrations/003_notifications.js
  - src/repositories/notificationRepository.js
  - src/routes/notifications.js
  - src/services/marketService.js
  - src/services/notificationService.js
  - src/services/wagerService.js
  - tests/helpers/testDb.js
  - tests/notifications.emission.test.js
  - tests/notifications.events.test.js
  - tests/notifications.idempotency.test.js
  - tests/notifications.ownership.test.js
  - tests/notifications.pagination.test.js
  - tests/notifications.read-state.test.js
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Reviewed the notifications infrastructure (event bus, repository, service, controller, routes, migration) together with the two money-movement services that now emit domain events (`wagerService.js`, `marketService.js`), and the six notification test suites.

The core requirement this phase was built around — `domainEvents.emit(...)` must fire strictly after (never inside) a `transaction()` closure, so a rollback can never produce a "phantom" notification — is correctly implemented at every call site in `wagerService.js` and `marketService.js`. All four `transaction(...)` usages capture their post-commit payload inside the closure and emit only after `await transaction(...)` resolves; `closeMarket` (which has no `transaction()` wrapper at all) emits only after its write completes. The notification read/write paths in `notificationRepository.js` are consistently scoped by `user_id` in every query (`findByUserId`, `markRead`, `findById`, `countUnread`), and `markRead`'s 404-not-403 behavior correctly avoids leaking existence of another user's notification (verified against `tests/notifications.ownership.test.js`). No IDOR was found in the notifications surface.

However, while reviewing `marketService.js` (in scope, and explicitly called out as part of the platform's money-movement core), I found a real data-loss bug in `deleteMarket`: it deletes **all** wager rows for a market, not just the pending ones being refunded, with no guard against deleting an already-resolved market — this permanently destroys the audit trail of settled bets. I also found several smaller robustness/validation gaps in the notifications surface (unbounded negative `limit`, unvalidated `:id` param, log noise from the idempotency path) and a flakiness risk in the test helper's fixed-delay event-flush pattern.

## Narrative Findings (AI reviewer)

### Critical Issues

#### CR-01: `deleteMarket` deletes ALL wagers for a market, not just the refunded pending ones — irreversible audit-trail loss

**File:** `src/services/marketService.js:196-229` (guard missing at top of method; destructive delete at line 224)

**Issue:** `deleteMarket` has no check on `market.status` before proceeding — it can be called on a market that is `open`, `closed`, or already `resolved` (fully paid out). Inside the transaction it only computes refunds for wagers with `status = 'pending'` (correct, via `wagerRepository.findPendingByMarket`), but then it unconditionally wipes the *entire* `wagers` table for that `market_id`:

```js
await client.query('DELETE FROM wagers WHERE market_id = $1;', [marketId]);
```

If an admin calls `DELETE /api/markets/:id` on a market that has already been resolved (i.e., all its wagers are `won`/`lost`, already paid out and recorded in `wallet_transactions`), this single statement permanently deletes those settled wager rows — the only record of each bettor's choice, odds-at-time, and payout for that market. `wallet_transactions` rows survive (so the wallet balance itself stays reconciled), but the free-text `description` field is the only remaining link back to what happened; the structured, queryable audit record (`wagers` row) is gone forever. This directly violates the project's core value that money movement "must always be correct and auditable." It also breaks referential integrity for any notification whose `related_entity = 'wager'` still points at a now-deleted `related_id`.

There is also no guard preventing this at all — `deleteMarket` is meant for "reembolsa apostas pendentes" (per its own comment and the controller's doc comment "admin deleta o mercado (reembolsa apostas pendentes)"), implying it's designed for markets that still have pending wagers, not resolved ones.

**Fix:**
```js
async deleteMarket(marketId) {
  const { question, refunds } = await transaction(async (client) => {
    const marketResult = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [marketId]);
    const market = marketResult.rows[0];
    if (!market) throw new NotFoundError('Mercado não encontrado.');
    if (market.status === 'resolved') {
      throw new ConflictError('Não é possível deletar um mercado já resolvido.');
    }

    const pendingWagers = await wagerRepository.findPendingByMarket(marketId, client);
    // ... refund loop unchanged ...

    // Only remove the wagers that were actually refunded here, never
    // historical won/lost/refunded/voided rows for this market.
    await client.query(
      "DELETE FROM wagers WHERE market_id = $1 AND status = 'pending';",
      [marketId]
    );
    await marketRepository.delete(marketId, client);

    return { question: market.question, refunds: refundList };
  });
  ...
}
```

## Warnings

### WR-01: Negative `limit`/`page` values reach raw SQL `LIMIT`/`OFFSET`, causing an unhandled DB error instead of a validation error

**File:** `src/repositories/notificationRepository.js:21-24`, `src/controllers/notificationsController.js:10-15`

**Issue:** `listMyNotifications` builds `{ limit: Number(limit) || 20 }` from the raw query string, and `findByUserId` only caps the *upper* bound:

```js
const cappedLimit = Math.min(Number(limit) || 20, 100);
```

`Number(limit) || 20` only falls back to the default when `limit` is falsy (`0`, `NaN`, `''`); a negative value like `?limit=-5` is truthy and survives untouched (`Math.min(-5, 100) === -5`). This negative value is then bound directly into `LIMIT $2 OFFSET $3`, which Postgres rejects with "LIMIT must not be negative" — an unhandled DB error that surfaces as a generic 500 instead of a clean 400 `ValidationError`. The same applies transitively to `OFFSET` when `page` is combined with a negative `limit`.

**Fix:**
```js
const cappedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
const currentPage = Math.max(Number(page) || 1, 1);
```

### WR-02: `PATCH /api/notifications/:id/read` with a non-numeric `:id` leaks a raw Postgres error message via a 500

**File:** `src/controllers/notificationsController.js:33-36`

**Issue:** `markRead` does `Number(req.params.id)` with no validation. A non-numeric id (e.g. `PATCH /api/notifications/abc/read`) produces `NaN`, which is passed straight through to `notificationRepository.markRead(NaN, userId)` and bound as a query parameter against an `integer` column. Postgres rejects this with `invalid input syntax for type integer: "NaN"` (SQLSTATE `22P02`). `errorHandler.js`'s special-casing only matches codes starting with `'P'` (a mismatch with real Postgres SQLSTATE codes, which never start with `P`), so this falls through to the generic branch: `statusCode = err.statusCode || 500` and `message = err.message` — meaning the raw Postgres error text is returned to the client in a 500 response instead of a clean 400. (Note: this `Number(req.params.id)`-without-validation pattern also exists in `marketsController.js`/`wagersController.js`, so it's consistent with existing project convention — but it's still worth hardening here since it directly touches user-facing error text.)

**Fix:**
```js
const markRead = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    throw new ValidationError('id inválido.');
  }
  const updated = await notificationService.markRead(id, req.user.id);
  res.json(updated);
});
```

### WR-03: Expected idempotent duplicate-notification inserts are logged as raw DB errors, polluting logs

**File:** `src/services/notificationService.js:26-36` (interacts with `src/config/database.js` `query()`)

**Issue:** `notify()` relies on the shared `query()` helper to surface the `23505` unique-violation used intentionally for idempotency. But `query()` (in `database.js`) does `console.error('Query error:', err.message, 'SQL:', sql)` for *every* thrown error before rethrowing — including this expected, handled duplicate-key path. Every duplicate event delivery (which, per the design comments, is expected to happen and is explicitly handled as a no-op) therefore prints a scary "Query error: duplicate key value violates unique constraint..." line to production logs. Over time this creates log noise that makes it harder to spot genuine unexpected DB errors, and could mislead an on-call engineer into thinking something is broken when the system is behaving exactly as designed.

**Fix:** Either bypass the generic logging `query()` wrapper for this specific insert (call `pool.query` directly in the repository so the expected-conflict path doesn't get logged as an error), or downgrade this specific log line to `debug`/`warn` when `err.code === '23505'` inside `database.js`'s `query()`. At minimum, document in the repository that this log noise is expected so it isn't mistaken for a real defect.

### WR-04: Fixed `wait(50)` sleep in test helper is a flaky pattern for asserting fire-and-forget event side-effects

**File:** `tests/helpers/testDb.js:118-125`, used throughout `tests/notifications.*.test.js`

**Issue:** `domainEvents.emit(...)` is synchronous and does not await its (async) listeners. Every test that needs to observe a listener's side effect (a DB row being written) does `await wait()` (a flat `setTimeout(resolve, 50)`) and then asserts. This is inherently racy: under CI load, connection-pool contention, or a slow DB round-trip, the listener's `INSERT`/`UPDATE` may not have completed by the time the 50ms timer fires, producing an intermittent false failure (or, worse, a false-negative pass for a "should NOT emit" assertion if the flow being tested is itself slow). This is a source-level reliability concern in the test suite (not the disconnected-DB issue already known/expected in this sandbox).

**Fix:** Replace the fixed sleep with a bounded poll (retry the assertion query every N ms up to a timeout) or, better, have `safeHandler` optionally expose a way to await in-flight listener promises in tests (e.g., a test-only registry of pending listener promises that the helper can `Promise.all` before asserting).

## Info

### IN-01: `relatedId || null` / `body || null` use falsy coercion instead of an explicit null/undefined check

**File:** `src/repositories/notificationRepository.js:14`

**Issue:** `relatedId || null` and `body || null` treat `0` as "absent" and coerce it to `NULL`. Since all current related ids come from `SERIAL` primary keys (always `>= 1`), this is unreachable today, but it's a landmine: if a future notification type uses a 0-based or otherwise falsy-but-valid id, the row would silently lose its `related_id` and the idempotency `UNIQUE` constraint on `(user_id, type, related_entity, related_id)` would stop deduplicating it correctly (see IN-02).

**Fix:** `relatedId: relatedId ?? null, body: body ?? null` (nullish coalescing).

### IN-02: Idempotency `UNIQUE` constraint silently stops working for notifications with a NULL `related_entity`/`related_id`

**File:** `src/migrations/003_notifications.js:18`

**Issue:** `UNIQUE (user_id, type, related_entity, related_id)` relies on standard SQL `NULL <> NULL` semantics — Postgres (pre-15, or without `NULLS NOT DISTINCT`) allows unlimited rows with the same `(user_id, type)` as long as `related_entity`/`related_id` are both `NULL`, since each NULL is considered distinct from every other NULL for uniqueness purposes. Every event type currently registered in `notificationService.register()` always supplies both fields, so this is not exercised today, but it means the documented idempotency guarantee ("a UNIQUE constraint colide... e o service trata como idempotência") is not actually enforced for any future notification type that omits them.

**Fix:** Either always require a non-null `related_entity`/`related_id` for every notification type (documented as a hard invariant, enforced with `NOT NULL` + a sentinel value), or use `NULLS NOT DISTINCT` (Postgres 15+) if the target Postgres version supports it (project states PostgreSQL 10+, so this may not be available — worth a comment either way).

### IN-03: `unread_only` filter only recognizes the exact string `'true'`

**File:** `src/controllers/notificationsController.js:14`

**Issue:** `unread_only === 'true'` means any other truthy-looking value (`1`, `yes`, `True`) silently falls through to "show all notifications" rather than erroring or being coerced. Minor API ergonomics issue, not a correctness bug given the frontend presumably always sends the literal string `'true'`.

**Fix:** Optional — document the expected literal value in the route's JSDoc, or normalize with `String(unread_only).toLowerCase() === 'true'`.

---

_Reviewed: 2026-07-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
