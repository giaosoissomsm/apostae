# Roadmap: ApostaE — Notifications, Cashout, Market Types, Cancellation v2

## Overview

This milestone adds four features to ApostaE's existing wallet/wager/market platform, in a
build order mandated by `requisitos.txt`: each feature is fully implemented, reviewed, and
tested (positive, negative, and attack-vector) before the next begins. Notifications ships
first because it has zero dependencies and establishes the single `domainEvents` chokepoint
every later feature reuses. Partial Cashout ships second, deliberately before the new market
types, so its schema and formula are designed market-type-agnostically from day one — and
because it is the first phase to introduce a second concurrent actor racing market resolution,
which is where the codebase's pre-existing scheduler-locking gap must finally be closed. New
Market Types ships third, adding Over/Under and multiple-choice alongside the untouched binary
market. Bet Cancellation v2 ships last because its "block if already cashed out" guard has a
hard dependency on Phase 2's cashout schema existing. Every phase touching money reuses the
same lock-then-revalidate, decimal-safe, audit-logged pattern already proven in the existing
`placeWager`/`resolveMarket` code.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Notifications Infrastructure** - Users are notified of wager/market status events and can read/manage their notification inbox
- [ ] **Phase 2: Partial Cashout** - Users can cash out part of an open wager's value pre-resolution, computed and locked safely server-side
- [ ] **Phase 3: New Market Types** - Admins can create Over/Under and multiple-choice markets alongside existing binary markets
- [ ] **Phase 4: Bet Cancellation v2** - Users can cancel a pending wager for a 5% fee, replacing the old free/pending-only cancellation

## Phase Details

### Phase 1: Notifications Infrastructure

**Goal**: Users are notified of key wager and market status events, and can view/manage their notification inbox via a dedicated, ownership-scoped API — establishing the single chokepoint every later feature reuses to emit notifications.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, NOTIF-05, NOTIF-06, NOTIF-07, NOTIF-08, NOTIF-09, NOTIF-10
**Success Criteria** (what must be TRUE):

  1. User receives a notification when a market they wagered in closes, resolves, or their wager wins, loses, or otherwise changes status (e.g. cancelled) (NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, NOTIF-05)
  2. User can retrieve their own notifications as a paginated, newest-first list, each with a timestamp (NOTIF-06, NOTIF-08)
  3. User can mark a notification as read, and the read/unread state persists across requests (NOTIF-07)
  4. Every notification endpoint (list, get-by-id, mark-read) is scoped to the requesting user — a user can never read or mutate another user's notification, including by guessing IDs (NOTIF-08)
  5. All notification writes flow through a single shared chokepoint (e.g. a `domainEvents`/`notify()` call), not duplicated per call site, so later phases (cashout-available, etc.) integrate without rework and no push transport is required this milestone (NOTIF-09, NOTIF-10)

**Plans**: 4 plans
**Wave 1**

- [ ] 01-01-PLAN.md — Foundation: Jest harness + test-DB fixture, notifications migration (idempotency constraint + indexes), domainEvents bus singleton

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 01-02-PLAN.md — Notification data + sole-writer chokepoint: repository (user_id-scoped) + service (idempotent notify, 7-event catalog, read methods)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-03-PLAN.md — Read API: controller + routes (requireAuth, ownership-scoped) + server mount and listener registration
- [ ] 01-04-PLAN.md — Producer wiring: wager/market services emit the 7 catalog events after transaction commit

### Phase 2: Partial Cashout

**Goal**: Users can cash out part of an open, pending wager's value before resolution; the value is computed and locked safely and atomically server-side, and the remaining stake stays active for resolution.
**Mode:** mvp
**Depends on**: Phase 1 (reuses the notification chokepoint to emit a cashout-available/cashout-confirmed event; also the mandated build order)
**Requirements**: CASHOUT-01, CASHOUT-02, CASHOUT-03, CASHOUT-04, CASHOUT-05, CASHOUT-06, CASHOUT-07, CASHOUT-08, CASHOUT-09, CASHOUT-10
**Success Criteria** (what must be TRUE):

  1. User can request a cashout on part of an open, pending wager and receive a value computed entirely server-side using the stake-proportional formula (stake × odds_at_time × fraction cashed out, minus fee) — a client-submitted amount is always rejected (CASHOUT-01, CASHOUT-02)
  2. After a partial cashout, the wager's remaining stake stays active and is still eligible for resolution/payout on the non-cashed-out portion (CASHOUT-03)
  3. Cashouts below a minimum amount are rejected, and any cashout attempt is rejected once the market is closed or the wager is resolved (CASHOUT-04, CASHOUT-05)
  4. Two concurrent cashout requests, or a retried request with the same idempotency key, on the same wager can never both succeed — verified by a concurrency test that fires simultaneous requests (CASHOUT-06, CASHOUT-07)
  5. Every cashout produces a wallet transaction record and an audit log entry, uses shared decimal-safe money math (no float rounding drift across repeated cashouts), and works identically regardless of market type (CASHOUT-08, CASHOUT-09, CASHOUT-10)

**Plans**: TBD

### Phase 3: New Market Types

**Goal**: Admins can create Over/Under and multiple-choice markets (in addition to the existing binary Sim/Não market) through the admin panel UI, with all validation, option scoping, and resolution logic generalized to N outcomes.
**Mode:** mvp
**Depends on**: Phase 2 (mandated build order; cashout schema/formula is finalized market-type-agnostically before market types diversify)
**Requirements**: MARKET-01, MARKET-02, MARKET-03, MARKET-04, MARKET-05, MARKET-06, MARKET-07, MARKET-08
**Success Criteria** (what must be TRUE):

  1. Admin can create an Over/Under market with a freely configurable numeric threshold (e.g. 2.5, 3.5) through the admin panel UI (MARKET-01, MARKET-08)
  2. Admin can create a multiple-choice market with a dynamic number of options, not capped at 3, through the admin panel UI (MARKET-02, MARKET-08)
  3. Existing binary Sim/Não markets continue to work unchanged after the new types are added (MARKET-03)
  4. All market-type and option input (option count, threshold format, duplicate options) is validated and bounded server-side, and an option ID can never be used to reference a different market's option (no IDOR) (MARKET-04, MARKET-05, MARKET-06)
  5. Wagers on any market type — binary, Over/Under, or multiple-choice — resolve and pay out correctly through a generalized N-outcome resolution path (MARKET-07)

**Plans**: TBD
**UI hint**: yes

### Phase 4: Bet Cancellation v2

**Goal**: Users can cancel a pending wager for an automatic 5% fee (95% refunded), fully audited, replacing the old free/pending-only cancellation and blocked whenever market/wager/cashout state makes cancellation unsafe.
**Mode:** mvp
**Depends on**: Phase 2 (the "already cashed out" blocking check requires the cashout schema to exist) and Phase 3 (per mandated build order — must be the last feature implemented)
**Requirements**: CANCEL-01, CANCEL-02, CANCEL-03, CANCEL-04, CANCEL-05, CANCEL-06, CANCEL-07, CANCEL-08
**Success Criteria** (what must be TRUE):

  1. User can cancel a wager while the market permits it; the cancellation automatically charges a 5% fee and refunds 95% of the wagered amount to the wallet, and the wager's status becomes "Cancelada" (CANCEL-01, CANCEL-02, CANCEL-05)
  2. The 5% fee is computed off the wager's remaining stake after any prior partial cashout, never the original wagered amount (CANCEL-03)
  3. Every cancellation produces a wallet transaction record and an audit log entry (CANCEL-04)
  4. Cancellation is blocked once the market is closed, the wager is resolved, or a cashout has already occurred on that wager — enforced transactionally (row lock + re-validation) so it cannot race a concurrent cashout or market resolution, verified by a concurrency test (CANCEL-06, CANCEL-07)
  5. The new logic replaces `cancelWager` in place — same route/method, no versioned endpoint or feature flag (CANCEL-08)

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Notifications Infrastructure | 0/4 | Not started | - |
| 2. Partial Cashout | 0/TBD | Not started | - |
| 3. New Market Types | 0/TBD | Not started | - |
| 4. Bet Cancellation v2 | 0/TBD | Not started | - |
</content>
