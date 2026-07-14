# Pitfalls Research

**Domain:** Real-money betting/wagering platform — financial feature expansion (notifications, partial cashout, dynamic market types, paid cancellation)
**Researched:** 2026-07-13
**Confidence:** HIGH (verified against OWASP references, PostgreSQL concurrency literature, and the actual ApostaE codebase patterns)

## Codebase Baseline (context for every pitfall below)

The existing codebase already establishes good patterns worth *extending*, and known gaps worth *closing*, before new financial features are added:

- **Good pattern already in use:** `walletRepository.findByUserIdForUpdate()` and inline `SELECT ... FOR UPDATE` on `markets`/`wagers` inside `transaction()` blocks (`src/services/wagerService.js`). New cashout/cancellation code must follow this exact row-locking pattern — lock wager row, lock wallet row, validate state, then mutate, all inside one transaction.
- **Existing gap:** `Math.round(wagerAmount * odds * 100) / 100` in `wagerService.placeWager()` does floating-point math in JS even though the DB column is `NUMERIC(15,2)`. This is a latent rounding-drift bug pattern that partial-cashout math (proportional fractions) will make worse if copied as-is.
- **Existing gap:** No idempotency key on any financial mutation (flagged in CONCERNS.md as "No idempotency for financial operations"). Cashout and cancellation both need this more urgently than wager placement because they are natural retry targets (users double-click, clients time out and retry).
- **Existing gap:** `src/scheduler.js` resolves markets on a 10-second tick with **no distributed lock** and no coordination with manual admin resolution (CONCERNS.md: "Scheduler race condition"). Every new feature that can run concurrently with resolution (cashout, cancellation) inherits this race unless it explicitly locks against it.
- **Existing gap:** `locked_balance` column exists on `wallets` but is never used — true available balance is currently just `balance`, so a user can already place overlapping wagers that combined exceed real capacity. Partial cashout adds a second concurrent debit/credit path against the same balance, doubling the surface for this bug.

## Critical Pitfalls

### Pitfall 1: Double cashout via concurrent requests (TOCTOU on wager state)

**What goes wrong:**
Two simultaneous cashout requests for the same wager both read "wager is active, cashout not yet taken" before either write completes, so both proceed to credit the wallet and mark the wager cashed out — the user is paid twice for one wager.

**Why it happens:**
Node.js request handlers interleave on the event loop; if the cashout service does a plain `SELECT` (no lock) to check wager status, then later does an `UPDATE`, there is a window between check and act where a second request can read the same pre-mutation state. PostgreSQL's default `READ COMMITTED` isolation does not protect against this — it only guarantees you don't read *uncommitted* data, not that a concurrent read-then-write on the same row is race-free.

**How to avoid:**
- Lock the wager row with `SELECT ... FOR UPDATE` as the *first* statement inside the transaction, before any state check, mirroring the existing `wagerService.cancelWager()` pattern.
- Add a wager `status` transition guard in the same query/transaction (`WHERE status = 'pending'` on the UPDATE, check `rowCount === 1`) as a second line of defense — this catches races even if a lock is ever accidentally skipped by future code.
- Add an idempotency key (client-supplied UUID stored on the wager or a dedicated `cashout_requests` table with a unique constraint) so a retried/duplicate request is rejected at the DB constraint level, not just by application logic.

**Warning signs:**
- Load/concurrency test: fire N parallel cashout requests for the same wager, expect exactly 1 success and N-1 rejections (409 Conflict), and wallet balance change of exactly one cashout amount.
- Any cashout code path that does a `SELECT` without `FOR UPDATE` before mutating wager/wallet state.

**Phase to address:**
Partial Cashout phase (build order #2). This must be verified with an explicit concurrency test before the phase is marked done — requisitos.txt mandates "test attack vectors" per feature.

---

### Pitfall 2: Trusting client-submitted cashout amount or value

**What goes wrong:**
The cashout endpoint accepts a `value` or `amount` field from the request body and uses it directly to credit the wallet, instead of computing it server-side from the wager's current odds/state. An attacker submits an inflated cashout value and extracts more than the wager is worth.

**Why it happens:**
Frontend needs to *display* a cashout quote before the user confirms, so a value is computed and shown client-side. It's tempting to just have the confirm request echo that same number back, since "the user already saw it." This conflates "value to display" with "value to trust."

**How to avoid:**
- The confirm endpoint must recompute the cashout value server-side from the wager's stored `amount`, `odds_at_time`, and current market state — never read a value from the request body for anything that affects payout math. PROJECT.md already states this requirement explicitly ("backend-calculated value (never trust frontend)") — treat it as non-negotiable, not aspirational.
- If a "quote" step is needed (show user the amount before confirming), generate a short-lived server-side quote token (e.g., signed value + expiry, or a `cashout_quotes` row with TTL) and have confirm validate against that token/row rather than trusting a raw number.
- Reject the request outright (400) if the body contains an `amount`/`value` field on the confirm endpoint — this makes "someone re-added client trust" a loud, testable failure instead of a silent one.

**Warning signs:**
- Any controller/service function signature where a payout number flows from `req.body` into a wallet credit.
- Code review checklist item: "grep for `req.body` reaching `adjustBalance` or `recordTransaction` without an intervening server-side computation."

**Phase to address:**
Partial Cashout phase. This is the single highest-value negative test case for that phase — write it before implementation as a UAT/attack-vector test per requisitos.txt's process.

---

### Pitfall 3: Cashout or cancellation processed after market resolution (resolution/action race)

**What goes wrong:**
A market resolves (scheduler tick or admin manual resolve) at the same moment a user submits a cashout or cancellation request. If the two operations don't lock against each other, the wager can be cashed out or cancelled *after* it has already been paid out or marked won/lost by the resolution job — resulting in a duplicate payout (resolution payout + cashout/refund) or a refund issued on a wager that already lost (giving the user money they weren't owed).

**Why it happens:**
Resolution (`marketService.resolveMarket()`) and cashout/cancellation are separate code paths that each independently assume they have exclusive access to the wager. Per CONCERNS.md, the scheduler already has no distributed lock and no coordination with admin actions — adding cashout/cancellation as a third actor on the same wager/market rows multiplies an existing unaddressed race rather than being a clean new risk.

**How to avoid:**
- Resolution, cashout, and cancellation must all take `SELECT ... FOR UPDATE` on the **market row** (not just the wager row) as their first step, and re-check `market.status === 'open'` / wager `status === 'pending'` after acquiring the lock, inside the same transaction. PostgreSQL row locks serialize these three code paths against each other automatically once they all lock the same row first.
- Cashout/cancellation must also lock the specific wager row and re-validate wager status (`'pending'`) after lock acquisition — a wager can flip to `'won'`/`'lost'`/`'refunded'` between the initial read and the lock being granted.
- Order locks consistently (always market row before wager row, or always by ascending ID) across all three code paths to avoid introducing a new deadlock while fixing the race.
- Treat the existing scheduler race (CONCERNS.md) as an in-scope blocker for this milestone, not a pre-existing issue to defer — it directly undermines the "safe under simultaneous cashouts/cancellations/market updates" constraint in PROJECT.md.

**Warning signs:**
- Concurrency test: schedule a market to close in 1 second, fire a cashout/cancellation request at T+0.9s to T+1.1s repeatedly, assert exactly one of {resolution payout, cashout, cancellation} wins and the other is cleanly rejected — never both.
- Any resolution or cashout/cancellation code that reads market/wager status without `FOR UPDATE`, or that reads it before the transaction's lock is acquired.

**Phase to address:**
Partial Cashout phase (introduces the first new racer against resolution) and Bet Cancellation v2 phase (introduces the second). Both phases should include this exact concurrency test; the scheduler locking fix should land no later than the Partial Cashout phase since it's a prerequisite for a safe interaction, not just a nice-to-have.

---

### Pitfall 4: Floating-point / rounding errors in proportional payout math

**What goes wrong:**
Partial cashout math and cancellation-fee math both require proportional calculations (e.g., "cash out 40% of a wager," "95% refund after 5% fee"). Doing this arithmetic with JS `Number` (IEEE 754 double) instead of decimal-safe operations produces values like `94.99999999999999` or `95.00000000000001`, which either fail the DB's `CHECK (amount > 0)` / `NUMERIC(15,2)` rounding in surprising ways, or accumulate drift across many transactions so that `SUM(wallet_transactions)` no longer reconciles with `wallet.balance` — silently violating the project's core value ("balance must never diverge from the sum of recorded transactions").

**Why it happens:**
The DB stores `NUMERIC(15,2)` (exact decimal), but the existing `wagerService.placeWager()` already converts to JS `Number` and does `Math.round(x * y * 100) / 100` — a float-based rounding shim, not true decimal arithmetic. It "works" for simple single-multiplication payout math but will not survive being copied into cashout's more complex proportional/partial math or cancellation's percentage-fee math without introducing visible drift, especially at scale (many small transactions compounding).

**How to avoid:**
- Do proportional/fee math in integer cents (multiply by 100, work in integers, divide back) or use a decimal library (`decimal.js`, `big.js`) for any calculation involving percentages or fractions — never chain floating-point multiplication/division for money.
- Always round to 2 decimal places using a single, explicit, well-tested rounding function (banker's rounding or standard half-up — pick one and use it everywhere), not ad hoc `Math.round(x*100)/100` scattered across services.
- Add a reconciliation invariant check (even just a periodic query, or a test) that `wallet.balance === wallet.created_balance + SUM(wallet_transactions signed amounts)` for a sample of wallets — this is the cheapest way to catch drift before it's a production incident.
- When computing the 5% cancellation fee, compute fee and refund from the wager's *original stored amount* (a `NUMERIC` column read from the DB), not a value that has round-tripped through JS floating point more than once.

**Warning signs:**
- Any `amount * 0.05`, `amount * 0.95`, or `amount * fraction` expression in new cashout/cancellation code without an explicit rounding + integer-cents strategy.
- Test case: cash out an amount that doesn't divide evenly (e.g., 33% of R$10.00) and assert the resulting wallet transaction is exactly 2 decimal places and the remainder wager value is internally consistent (original = cashed-out + remaining, to the cent).

**Phase to address:**
Partial Cashout phase (introduces proportional math) and Bet Cancellation v2 phase (introduces percentage-fee math). Both should share one vetted money-math utility rather than each reimplementing rounding.

---

### Pitfall 5: Cancellation fee computed from stale or client-provided wager amount

**What goes wrong:**
The cancellation endpoint computes the 5% fee using a wager amount passed in the request, or using a value fetched *before* the transaction's row lock is acquired (read-then-lock instead of lock-then-read). Either allows a mismatch between the amount the fee is calculated on and the amount actually in the DB at commit time — e.g., a partial cashout that already reduced the wager's remaining value completes between the fee calculation and the cancellation write, so the fee/refund is computed against the original full amount instead of the reduced remaining amount, over- or under-refunding the user.

**Why it happens:**
Once partial cashout exists (this milestone), a wager's "cancellable amount" is no longer a fixed value from creation — it changes over the wager's lifetime. Cancellation code written without accounting for this (e.g., reusing `wager.amount` from the original row instead of `wager.amount - wager.cashed_out_amount`) will look correct in isolation and only fail once cashout and cancellation interact.

**How to avoid:**
- Cancellation must read the wager's *current remaining stake* (post any prior partial cashout) with `FOR UPDATE`, inside the same transaction that computes and applies the fee — never accept a wager amount from the client, and never read it outside the lock.
- Explicitly design the wager schema/logic so "remaining cancellable value" is a derived, always-current field (e.g., `amount - COALESCE(cashed_out_amount, 0)`), and make cancellation and cashout both update/read that same source of truth under lock.
- Block cancellation (per PROJECT.md's explicit requirement) when a cashout has already occurred on that wager if partial-then-cancel is not a supported combination — but if it *is* supported (partial cashout, then cancel the remainder), the fee must apply only to the remaining stake, not the original amount.

**Warning signs:**
- Any cancellation code that references `wager.amount` directly for fee computation without first checking/subtracting prior cashout amounts.
- Test case: partially cash out a wager, then cancel the remainder — assert the fee is 5% of the *remaining* stake, not the original stake, and that total money out (cashout + refund) plus fee equals the original wager amount to the cent.

**Phase to address:**
Bet Cancellation v2 phase (build order #4, after Partial Cashout) — this pitfall only exists *because* cashout is built first, so the cancellation phase plan must explicitly account for cashout's data model.

---

### Pitfall 6: Unbounded / unvalidated option counts in dynamic market types (DoS and payout bugs)

**What goes wrong:**
Multiple-choice markets accept an admin-configurable number of options "not capped at 3" (per PROJECT.md). Without a server-side upper bound, an admin (or a compromised admin session, or a bug in the admin UI) can create a market with an enormous number of options (thousands), which then breaks payout distribution logic (loops proportional to option count, as already flagged for wager-count in `marketService.resolveMarket()`), bloats every market-listing/detail response, and creates a DoS vector on both the create-market and resolve-market endpoints.

**Why it happens:**
"Not capped at 3" is interpreted as "no cap" instead of "a higher, still-bounded cap." Server-side validation for market creation tends to check *presence* of fields (does `options` exist, is it an array) but skip *bounds* checking (length limits), especially when the corresponding UI form only lets an admin add options one at a time and "feels" self-limiting.

**How to avoid:**
- Enforce a hard server-side maximum option count (e.g., 2–20, chosen with product input) on market creation, independent of any UI-side limit — the UI limit is not a security control.
- Enforce a minimum too (Over/Under needs exactly the 2 implicit outcomes; multiple-choice needs at least 2–3 real options) to prevent degenerate markets.
- Reuse the existing resolution-loop concern from CONCERNS.md ("Market resolution with large wager count") when designing resolution for multi-option markets — payout iteration should already be planned to batch, and multi-option markets multiply the per-market row count (one payout branch per option × wagers), so this existing fragility becomes more urgent, not new.
- Validate that the number of options in a resolution request/winning-option selection matches the number of options actually stored for that market — do not trust an option index/count from the client on resolve.

**Warning signs:**
- Admin-facing "add option" UI with no visible max, and a create-market endpoint that doesn't reject a 500-option payload with a 400.
- Load test: create a market with the maximum allowed options and N wagers spread across them, resolve it, and confirm resolution completes within an acceptable time budget and payouts are exactly correct per option.

**Phase to address:**
New Market Types phase (build order #3).

---

### Pitfall 7: IDOR on market option IDs (choosing/paying out the wrong option)

**What goes wrong:**
Option IDs for multiple-choice/Over-Under markets are exposed to clients (e.g., in the wager-placement request, or in an admin resolve-market request selecting the winning option). If the server doesn't verify that the submitted `option_id` actually belongs to the referenced `market_id`, a client can submit an option ID belonging to a *different* market, causing a wager to be recorded against the wrong option, or (worse) causing resolution to mark a wrong/foreign option as the winner.

**Why it happens:**
Once markets have their own `options` table (as multiple-choice/Over-Under requires), it's easy to write `WHERE id = $optionId` without also constraining `AND market_id = $marketId`, especially since a straightforward foreign-key relationship makes the ID *look* validated (it exists, it's a real row) even though it doesn't belong to the market in context.

**How to avoid:**
- Every query that resolves an `option_id` must scope it with `AND market_id = $marketId` (or fetch options via a join through the market, never by bare option ID alone), for both wager placement and market resolution.
- On market resolution, validate the submitted winning `option_id` against the full set of option IDs actually belonging to that market before proceeding, inside the same locked transaction as the rest of resolution.
- Apply the same principle used elsewhere in the codebase for wager ownership (`wager.user_id !== userId → AuthorizationError`) — treat `option belongs to market` as a mandatory authorization-style check, not just a foreign-key nicety.

**Warning signs:**
- Any SQL `SELECT ... FROM options WHERE id = $1` without a companion `market_id` condition.
- Test case: place a wager on market A using an option ID that actually belongs to market B; expect a 400/404, not a successful wager.

**Phase to address:**
New Market Types phase.

---

### Pitfall 8: IDOR/enumeration on notifications, and payout/bet details leaked in notification content

**What goes wrong:**
Two related failure modes: (1) `GET /api/notifications/:id` (or similar) doesn't verify the notification belongs to the requesting user, letting one user read another's notifications by incrementing an ID; (2) notification *content* itself embeds sensitive details (wager amount, market choice, win/loss outcome, opponent-like info) that get exposed through a shared/public code path — e.g., an admin notification-management endpoint that lists all notifications without per-notification ownership filtering, or a notification preview that's reachable without auth.

**Why it happens:**
Notifications are new to this codebase, so there's no established ownership-check pattern to copy yet (unlike wagers, which already check `wager.user_id !== userId`). It's easy to build the read/list/mark-as-read endpoints by ID first and add the ownership filter "later," or to forget it entirely on a mark-as-read/delete endpoint since GET-list already filters by user and the ID-based endpoints feel like an afterthought.

**How to avoid:**
- Every notification query — list, get-by-id, mark-as-read, delete — must include `WHERE user_id = $currentUserId` (or an equivalent ownership join), never just `WHERE id = $notificationId`. Establish this as the first pattern written in the Notifications phase so later phases (which reuse notifications for cashout-available/resolution alerts) inherit it correctly.
- Use the same "409/404, not 403" pattern the codebase likely already favors for ownership mismatches (don't leak "this ID exists but isn't yours" — return not-found) — check `CONVENTIONS.md`/existing error handling for the established style and match it.
- Keep notification content minimal/templated (e.g., "Your wager on Market #123 was resolved" + a link the client resolves via an authorized endpoint) rather than embedding full financial detail (amounts, odds, payout) directly in the notification row — this limits blast radius if an ownership check is ever missed, and matches typical fintech UX of showing detail only after another authorized fetch.
- If notifications ever gain an admin-facing view (e.g., for support), it must be a distinct, explicitly-audited endpoint — never the same route as the user-facing one with an admin bypass flag.

**Warning signs:**
- Any notification route with `:id` in the path that doesn't join/filter on the authenticated user.
- Test case: as user A, request user B's known notification ID directly; expect 404, and expect the response to contain no data about user B's notification.

**Phase to address:**
Notifications phase (build order #1) — this is the first phase, so getting the ownership-check pattern right here has compounding value for every later phase that adds new notification types.

---

### Pitfall 9: Double-spend and TOCTOU on wallet balance from concurrent unrelated operations

**What goes wrong:**
A user with balance R$100 fires a wager placement and a cashout-triggered credit (or two wagers) at nearly the same time. If each operation reads balance, checks sufficiency, and writes independently without a shared lock ordering, both can pass the sufficiency check against the same starting balance and the final balance can go negative (violating the `CHECK (balance >= 0)` constraint at the DB level — which will at least throw, but as an *unhandled* transaction failure rather than a clean user-facing rejection unless explicitly caught) or, worse, if the check and write aren't in the same transaction, the constraint gets bypassed entirely by an intervening commit.

**Why it happens:**
`walletRepository.findByUserIdForUpdate()` already exists and is correctly used for wagers — the risk is specifically in *new* code (cashout credit, cancellation refund) written without reusing this exact helper, e.g., a developer writes a direct `UPDATE wallets SET balance = balance + $1` without first taking `FOR UPDATE`, reasoning that "it's a credit, not a debit, so it can't go negative" — true for that one operation in isolation, but every operation touching the same wallet row must serialize through the same lock or a debit elsewhere can interleave incorrectly with a credit's read of `balance_before` for the audit record, corrupting the audit trail even if the final balance happens to be correct.

**How to avoid:**
- Mandate that **every** wallet-touching operation (wager placement, cashout, cancellation refund, market resolution payout) goes through `walletRepository.findByUserIdForUpdate()` (or an equivalent lock) before reading `balance` for either a sufficiency check or a `balance_before` audit value — no exceptions, including credit-only paths.
- Since `locked_balance` exists but is unused (CONCERNS.md), decide explicitly for this milestone whether to finally implement it (hold funds during a pending cashout quote, if quotes have any lifetime) or formally defer it — but don't let partial cashout add a second unaccounted-for "pending" state on top of the existing gap.
- Set and document the transaction isolation level explicitly for financial transactions rather than relying on the PostgreSQL default (`READ COMMITTED`) implicitly — `SELECT ... FOR UPDATE` is sufficient for these single-row-per-operation cases as currently structured, but this should be a conscious choice recorded in ARCHITECTURE.md/CONVENTIONS.md, not an accident.
- Write a concurrency test harness once (e.g., fire 50 parallel requests against one wallet mixing wagers, cashouts, and cancellations) and reuse it across all three new-feature phases rather than inventing one-off tests per phase.

**Warning signs:**
- Any new repository/service method that mutates `wallets.balance` without calling `findByUserIdForUpdate` first.
- `CHECK (balance >= 0)` constraint violations appearing in logs (these should never happen if locking is correct — their presence means a race got through).
- Balance/audit-trail reconciliation mismatch (see Pitfall 4) even when final balances look plausible.

**Phase to address:**
All three financial phases (Partial Cashout, New Market Types resolution paths, Bet Cancellation v2) — this is the cross-cutting invariant the roadmap should call out as a shared "definition of done" checklist item rather than a one-time fix.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Reusing `Math.round(x*100)/100` float rounding for new proportional cashout/fee math (copying existing `placeWager` pattern as-is) | Fast to write, matches existing code | Rounding drift compounds across cashout + remaining-wager + fee splits; harder to trace once three numbers must sum exactly | Never for new proportional math — extract a shared decimal-safe money utility instead |
| Skipping a distributed/scheduler lock fix and just "hoping" cashout/cancellation rarely overlaps with resolution timing | Ships Partial Cashout faster without touching `scheduler.js` | Directly violates PROJECT.md's concurrency constraint; will surface as intermittent, hard-to-reproduce double-payout bugs in production | Never — this must be fixed no later than the Partial Cashout phase since it's the first feature to race against resolution |
| Deferring the notification ownership-check pattern ("we'll add per-user filtering once we see how it's used") | Faster first notification endpoint | Sets a precedent copied by every later notification type (cashout-available, resolution alerts), multiplying the IDOR surface | Never — bake ownership filtering into the very first notification query written |
| Leaving `locked_balance` unused for this milestone too | Avoids touching wallet schema/semantics under time pressure | Partial cashout with a quote step needs *some* answer for "can this money be spent elsewhere while a cashout is pending" — deferring again compounds an already-flagged gap | Acceptable only if cashout quotes are stateless/instant (compute-and-confirm in one request, no hold period) — otherwise must be addressed |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting client-submitted cashout/fee amounts | Direct financial loss via inflated payout | Server always recomputes from stored wager state under lock; reject requests carrying amount fields on confirm endpoints |
| Missing `AND market_id = ...` scoping on option lookups | Cross-market option ID confusion (IDOR), wrong payout distribution | Always scope option queries by market; validate winning option belongs to market at resolution |
| Missing per-user ownership filter on notification routes | Enumeration of other users' notifications, information leakage | `WHERE user_id = current_user` on every notification query, including by-ID routes; keep notification content minimal |
| No idempotency key on cashout/cancellation endpoints | Retry storms (client timeout + retry) cause duplicate processing | Idempotency key per request, enforced via unique DB constraint, checked inside the same locked transaction |
| Unbounded multiple-choice option counts | DoS via huge option arrays; resolution loop blowup | Server-side min/max option count validation, independent of UI limits |

## "Looks Done But Isn't" Checklist

- [ ] **Partial cashout:** Often missing a true concurrency test (N parallel requests, same wager) — verify exactly one succeeds under load, not just in manual single-request testing.
- [ ] **Partial cashout:** Often missing server-side recomputation on the *confirm* step specifically (the *quote* step is usually done right; confirm is where client-trust regressions creep in) — verify confirm endpoint ignores any amount/value in the request body.
- [ ] **Bet cancellation v2:** Often missing the "already cashed out" block and the "fee applies to remaining, not original, stake" case — verify both with a partial-cashout-then-cancel test.
- [ ] **New market types:** Often missing a max-option-count server-side check even when the admin UI "looks" bounded — verify with a raw API request bypassing the UI.
- [ ] **New market types:** Often missing option-to-market scoping on resolution — verify a foreign option ID is rejected, not silently accepted.
- [ ] **Notifications:** Often missing ownership checks on by-ID routes (get single, mark-as-read, delete) even when the list endpoint correctly filters by user — verify each route independently, not just the list.
- [ ] **All financial endpoints:** Often missing an idempotency mechanism even when the "happy path" transaction logic is correct — verify a duplicate/retried request doesn't double-process.
- [ ] **All financial endpoints:** Often missing a reconciliation check that `wallet.balance` still equals the sum of `wallet_transactions` after a batch of concurrent test operations — verify with an explicit sum-check assertion, not just "the numbers looked right."

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|-----------------|
| Double cashout / double-spend already occurred in production | HIGH | Freeze affected wallet, reconcile `wallet_transactions` against wager/cashout history to compute true correct balance, issue `correction` transaction type (already exists in schema) with full audit trail and admin_id, notify affected user |
| Resolution/cashout race caused wrong payout | HIGH | Same reconciliation approach as above; additionally audit scheduler logs to identify the time window and check for other affected markets in the same tick |
| Rounding drift discovered across many transactions | MEDIUM | Run a reconciliation query across all wallets, quantify total drift, decide correction strategy (per-wallet `correction` entries) before it compounds further; then fix the underlying money-math utility |
| IDOR discovered in production (notifications or options) | LOW–MEDIUM | Patch the missing ownership filter, audit access logs for the affected route to determine exposure scope, notify affected users only if actual cross-user data access is confirmed in logs |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|---------------|
| Double cashout via concurrent requests | Partial Cashout | Concurrency test: N parallel cashout requests on one wager, expect exactly 1 success |
| Trusting client-submitted cashout amount | Partial Cashout | Attack-vector test: submit inflated amount on confirm endpoint, expect rejection/ignored field |
| Cashout/cancellation racing market resolution | Partial Cashout + Bet Cancellation v2 (scheduler lock fix required by first) | Timed concurrency test around scheduled market close |
| Floating-point rounding drift in proportional math | Partial Cashout + Bet Cancellation v2 | Non-round-number cashout/fee test asserting exact-cent reconciliation |
| Cancellation fee on stale/original amount post-cashout | Bet Cancellation v2 | Partial-cashout-then-cancel test asserting fee applies to remaining stake only |
| Unbounded option counts (DoS) | New Market Types | API-level test bypassing UI with oversized option payload |
| IDOR on option IDs | New Market Types | Cross-market option ID test on wager placement and resolution |
| IDOR/enumeration on notifications | Notifications | Cross-user notification ID access test on every route (list, get, mark-read, delete) |
| Wallet double-spend / TOCTOU across all financial ops | All three financial phases (shared checklist item) | Mixed concurrent operation test (wagers + cashouts + cancellations) against one wallet, plus balance/audit reconciliation assertion |

## Sources

- [Business logic vulnerability — OWASP Foundation](https://owasp.org/www-community/vulnerabilities/Business_logic_vulnerability)
- [OWASP Top 10 for Business Logic Abuse](https://owasp.org/www-project-top-10-for-business-logic-abuse/)
- [Business Logic Security — OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html)
- [Insecure Direct Object Reference (IDOR) — OWASP Foundation](https://owasp.org/www-community/attacks/insecure_direct_object_reference)
- [Insecure Direct Object Reference Prevention — OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)
- [Fixing Race Conditions in PostgreSQL for Financial Systems](https://thedanieldallas.com/thoughts/postgresql-race-conditions)
- [Handling Concurrency with Row Level Locking in PostgreSQL](https://dev.to/nickcosmo/handling-concurrency-with-row-level-locking-in-postgresql-1p3)
- [Preventing Postgres SQL Race Conditions with SELECT FOR UPDATE](https://on-systems.tech/blog/128-preventing-read-committed-sql-concurrency-errors/)
- [Precision Matters: Why Using Cents Instead of Floating Point for Transaction Amounts is Crucial — HackerOne](https://www.hackerone.com/blog/precision-matters-why-using-cents-instead-floating-point-transaction-amounts-crucial)
- [Floats Don't Work For Storing Cents — Modern Treasury](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents)
- Direct codebase inspection: `src/services/wagerService.js`, `src/repositories/walletRepository.js`, `src/migrations/002_wallet.js`, `.planning/codebase/CONCERNS.md`

---
*Pitfalls research for: real-money betting platform financial feature expansion*
*Researched: 2026-07-13*
