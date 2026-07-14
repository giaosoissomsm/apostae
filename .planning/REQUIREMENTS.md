# Requirements: ApostaE

**Defined:** 2026-07-13
**Core Value:** Money movement (wallet balance, wagers, cashouts, cancellations) must always be correct and auditable — a user's balance must never diverge from the sum of their recorded transactions, even under concurrent access.

## v1 Requirements

Requirements for this milestone. Each maps to a roadmap phase. Build order: NOTIF → CASHOUT → MARKET → CANCEL (per PROJECT.md).

### Notifications (NOTIF)

- [ ] **NOTIF-01**: User is notified when a market they have a wager in is closed
- [ ] **NOTIF-02**: User is notified when a market's official result is defined (resolved)
- [ ] **NOTIF-03**: User is notified when their wager wins
- [ ] **NOTIF-04**: User is notified when their wager loses
- [ ] **NOTIF-05**: User is notified on any other relevant wager status change (e.g. cancelled)
- [ ] **NOTIF-06**: User can list their notifications paginated, newest first
- [ ] **NOTIF-07**: User can mark a notification as read; unread/read state persists
- [ ] **NOTIF-08**: Every notification has a timestamp and is retrievable only by its owning user (no IDOR — ownership filter on every query, including by-ID lookups)
- [x] **NOTIF-09**: Notification-writing is triggered from a single chokepoint (e.g. a domain-event/notify() call) reused by every feature that emits notifications, not duplicated per call site
- [x] **NOTIF-10**: No push transport (WebSocket/SSE) required this milestone — structure only, but the design must not require a rewrite when real-time delivery is added later

### Partial Cashout (CASHOUT)

- [ ] **CASHOUT-01**: User can request a cashout quote for part of an open, pending wager's value
- [ ] **CASHOUT-02**: Cashout value is computed by the backend using the stake-proportional formula (stake × odds_at_time × fraction cashed out, minus platform fee) — never accepted from the frontend
- [ ] **CASHOUT-03**: After a partial cashout, the wager's remaining stake stays active and continues to be eligible for resolution/payout on the non-cashed-out portion
- [ ] **CASHOUT-04**: A minimum cashout amount is enforced (reject negligible/near-zero cashouts)
- [ ] **CASHOUT-05**: Cashout is only allowed while market.status = 'open' AND wager.status = 'pending'; rejected once market is closed or wager is resolved
- [ ] **CASHOUT-06**: Concurrent cashout requests on the same wager cannot both succeed (row-level locking + re-validation after lock acquisition, reusing the existing `SELECT ... FOR UPDATE` pattern)
- [ ] **CASHOUT-07**: Cashout requests are idempotent (a retried request with the same idempotency key does not double-apply)
- [ ] **CASHOUT-08**: Every cashout produces a wallet transaction record and an audit log entry; wallet balance is only ever changed via a recorded movement, never a direct update
- [ ] **CASHOUT-09**: Cashout logic and schema are market-type-agnostic (works against "wager + odds_at_time + market status", not hardcoded to binary Sim/Não) so Phase 3's new market types don't force a rework
- [ ] **CASHOUT-10**: Money math uses a shared decimal-safe utility (no raw float rounding) to prevent drift across repeated partial cashouts

### New Market Types (MARKET)

- [ ] **MARKET-01**: Admin can create an Over/Under market with a freely configurable numeric threshold (e.g. 2.5, 3.5)
- [ ] **MARKET-02**: Admin can create a multiple-choice market with a dynamic number of options (not capped at 3)
- [ ] **MARKET-03**: Existing binary Sim/Não markets continue to work unchanged (additive migration, no regression)
- [ ] **MARKET-04**: All market-type and option validation happens server-side (option count, threshold format, duplicate options, etc.)
- [ ] **MARKET-05**: Option/outcome count is bounded server-side to prevent unbounded-list DoS; UI limits alone are not sufficient
- [ ] **MARKET-06**: Option IDs are scoped to their parent market server-side (no IDOR — a wager can't reference an option belonging to a different market)
- [ ] **MARKET-07**: Payout/resolution logic is generalized to N outcomes (works for binary, Over/Under, and multiple-choice through the same resolution path where practical)
- [ ] **MARKET-08**: Admin panel UI supports creating both new market types (per requisitos.txt's explicit requirement), not API-only

### Bet Cancellation v2 (CANCEL)

- [ ] **CANCEL-01**: User can cancel a wager when the market permits cancellation
- [ ] **CANCEL-02**: Cancelling automatically charges a 5% fee on the wagered amount and refunds 95% to the user's wallet
- [ ] **CANCEL-03**: Fee is computed off the wager's *remaining* stake (post any prior partial cashout), not its original amount
- [ ] **CANCEL-04**: Cancellation produces a wallet transaction record and an audit log entry
- [ ] **CANCEL-05**: Cancelling sets the wager's status to "Cancelada"
- [ ] **CANCEL-06**: Cancellation is blocked once the market is closed, the wager is resolved, or a cashout has already occurred on that wager
- [ ] **CANCEL-07**: The blocking checks in CANCEL-06 are enforced transactionally (row lock + re-validation) so a cancellation cannot race a concurrent cashout or market resolution on the same wager
- [ ] **CANCEL-08**: Cancellation replaces the existing `cancelWager` logic in place (same route/method, no versioned endpoint or feature flag — codebase is pre-production)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Realtime Notifications

- **RT-01**: Notifications are pushed to connected clients in real time via WebSocket or SSE
- **RT-02**: User sees a live unread-count badge without polling

### Extended Cashout

- **CASHOUT-V2-01**: User can fully (100%) cash out a wager, not just partially

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full (100%) cashout | Only partial cashout requested this milestone; different edge cases (wager fully closes) would expand scope — revisit once partial cashout's concurrency patterns are proven |
| Real-time push (WebSocket/SSE) | No realtime transport exists in the codebase; retrofitting it alongside 4 other new features multiplies risk in one milestone — structure is prepared, delivery deferred |
| Live-odds-driven ("fair value") cashout pricing | ApostaE has no live odds feed or in-play data; a probability-weighted formula would be ungrounded and hard to audit — stake-proportional formula chosen instead (Key Decision, PROJECT.md) |
| Pari-mutuel / pool-based payouts for new market types | Incompatible with ApostaE's fixed-odds-at-placement model; all new market types stay fixed-odds like the existing binary market |
| Promotional/marketing notifications | Anti-feature per research (93% of sportsbook notifications are ad content, flagged as a consumer-protection concern); notification types are strictly the 6 transactional ones listed |
| Velocity/pattern-analysis fraud detection for cancellation abuse | Out of scope for this milestone's size; the hard state-machine cutoff (CANCEL-06) is the practical equivalent — revisit if abuse is observed in production |
| Responsible-gambling tooling (limits, self-exclusion, reality checks) | Not mentioned in original brief; flagged by research as a common requirement for real-money platforms but requires a separate regulatory/product decision outside this milestone |
| Payment gateway / deposit / withdrawal integration | Not mentioned in the brief |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| NOTIF-01 | Phase 1 | Pending |
| NOTIF-02 | Phase 1 | Pending |
| NOTIF-03 | Phase 1 | Pending |
| NOTIF-04 | Phase 1 | Pending |
| NOTIF-05 | Phase 1 | Pending |
| NOTIF-06 | Phase 1 | Pending |
| NOTIF-07 | Phase 1 | Pending |
| NOTIF-08 | Phase 1 | Pending |
| NOTIF-09 | Phase 1 | Complete |
| NOTIF-10 | Phase 1 | Complete |
| CASHOUT-01 | Phase 2 | Pending |
| CASHOUT-02 | Phase 2 | Pending |
| CASHOUT-03 | Phase 2 | Pending |
| CASHOUT-04 | Phase 2 | Pending |
| CASHOUT-05 | Phase 2 | Pending |
| CASHOUT-06 | Phase 2 | Pending |
| CASHOUT-07 | Phase 2 | Pending |
| CASHOUT-08 | Phase 2 | Pending |
| CASHOUT-09 | Phase 2 | Pending |
| CASHOUT-10 | Phase 2 | Pending |
| MARKET-01 | Phase 3 | Pending |
| MARKET-02 | Phase 3 | Pending |
| MARKET-03 | Phase 3 | Pending |
| MARKET-04 | Phase 3 | Pending |
| MARKET-05 | Phase 3 | Pending |
| MARKET-06 | Phase 3 | Pending |
| MARKET-07 | Phase 3 | Pending |
| MARKET-08 | Phase 3 | Pending |
| CANCEL-01 | Phase 4 | Pending |
| CANCEL-02 | Phase 4 | Pending |
| CANCEL-03 | Phase 4 | Pending |
| CANCEL-04 | Phase 4 | Pending |
| CANCEL-05 | Phase 4 | Pending |
| CANCEL-06 | Phase 4 | Pending |
| CANCEL-07 | Phase 4 | Pending |
| CANCEL-08 | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 36 total
- Mapped to phases: 36
- Unmapped: 0

---
*Requirements defined: 2026-07-13*
*Last updated: 2026-07-13 after roadmap creation*
</content>
