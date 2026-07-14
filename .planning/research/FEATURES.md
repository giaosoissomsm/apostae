# Feature Research

**Domain:** Online betting/wagering platform — feature expansion (notifications, partial cashout, new market types, paid cancellation)
**Researched:** 2026-07-13
**Confidence:** MEDIUM (cross-corroborated across multiple sportsbook sources; ApostaE's specific architecture — no live odds feed, admin-driven resolution — means some patterns must be adapted, not copied verbatim)

## Context Note (read before the tables)

ApostaE is **not** a live in-play sportsbook. It has no continuous odds feed, no live game-state ingestion, and odds are fixed at bet time (`odds_at_time`) then resolved by admin action or scheduler. This matters a lot for how "industry standard" cashout and market patterns should be adapted:

- Real sportsbooks price cashout off a **live win-probability model** (in-play odds engine). ApostaE has no such engine and none is in scope this milestone. The cashout formula must therefore be **deterministic and backend-computable from data ApostaE already has** (stake, odds_at_time, market status, time-to-resolution) — not a live "fair value" recalculation.
- ApostaE's markets resolve at a single discrete event (admin/scheduler reveals outcome), not a continuously evolving live event. So "cash out suspended during volatility" becomes "cash out disabled once market is closed" — a much simpler, binary cutoff ApostaE already has the state machine for (open → closed → resolved).

This adaptation is reflected throughout the tables below.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Bet status notifications (settled won/lost, market closed/resolved) | Every major sportsbook (bet365, FanDuel, Betfair) shows won/lost status prominently in a "My Bets" area; users expect to know the outcome of a bet without re-checking the market manually | LOW–MEDIUM | Matches scope exactly: closed, resolved, won, lost, status change, cashout-available. Structure-only (DB + read/unread + paginated API) this milestone — no push transport exists yet, which is acceptable per PROJECT.md |
| Partial cashout with deterministic, backend-computed value | Betfair, FanDuel, bet365, William Hill, Bovada all offer partial cashout as a standard feature; users expect to lock in part of a win without abandoning the rest of the bet | MEDIUM–HIGH | Frontend must never submit or influence the value — only requests a quote, backend computes and re-validates atomically at confirm time (classic TOCTOU risk — see PITFALLS) |
| Minimum cashout amount enforcement | Common across real platforms — prevents degenerate/near-zero partial cashouts that create audit noise for negligible value | LOW | Simple threshold check (e.g. remaining stake or cashout value must exceed some minimum, e.g. R$1 or 5% of original stake) |
| Cashout disabled once market is closed/resolved | Universal pattern — cashout only exists while genuine uncertainty remains; every sportsbook cuts off cashout once the event/market is no longer "live" | LOW | Maps directly onto ApostaE's existing market state machine (open → closed → resolved); enforce cashout only when market.status === 'open' AND wager.status === 'pending' |
| Over/Under market type (admin-set threshold) | Standard bet type across virtually all sportsbooks (totals/over-under is one of the "big three" bet types alongside moneyline/spread) | MEDIUM | Structurally a 2-outcome market like Sim/Não, but with a numeric threshold value (e.g. 2.5) instead of Sim/Não labels — payout mechanics identical to existing binary logic once the threshold is fixed and the actual value is compared against it |
| Multiple-choice market type (dynamic option count) | Standard for prediction-market-style products (elections, tournaments, "who will win X") — users expect to pick from N labeled outcomes, not just Yes/No | MEDIUM–HIGH | Requires a genuine schema change: child options table instead of a fixed Sim/Não column, since option count isn't 2 or 3 but arbitrary and admin-defined |
| Fee-based cancellation with clear fee disclosure | Users expect to know the fee before confirming — showing "you will receive 95% of your stake (R$X of R$Y)" before commit is standard UX for any fee-charging cancel/refund flow | LOW | Backend computes 95% figure; frontend only displays it, never computes or submits it |
| Cancellation blocked once market closes / wager resolves / a cashout occurred | Prevents the exact abuse vector called out in research (cancelling right before an unfavorable resolution) and prevents double-dipping (cashout + cancel on the same wager) | LOW–MEDIUM | Directly specified in PROJECT.md's Active requirements; matches the universal "cutoff once outcome is effectively determined" pattern found in research |
| Audit trail for every cashout/cancellation | Every real platform logs cash-out/void/cancel events for compliance and dispute resolution; ApostaE already has this pattern for financial ops (`audit_logs` table) | LOW | Extend existing audit_logs pattern rather than invent a new one |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Cashout-available notification (proactive) | Most sportsbooks show cashout value passively inside the bet slip; proactively notifying "your bet is now eligible for cashout at R$X" is a smaller/simpler feature than live push, but the *structure* (a notification row triggered when a wager crosses a cashout-eligibility condition) differentiates ApostaE from doing nothing until the user opens the app | LOW (given notification infra already built for other events) | Reuses the notification infrastructure built for feature #1 — a good sequencing argument for building notifications first (already reflected in PROJECT.md's build order) |
| Fully dynamic multiple-choice markets (not capped at 3) | Most simple betting-platform clones hardcode 2–3 outcomes; PROJECT.md explicitly calls for uncapped dynamic option count, which is closer to prediction-market products (Polymarket-style) than typical sportsbook clones | MEDIUM–HIGH | This is the single highest-complexity item in the milestone from a data-modeling perspective — see Feature Dependencies below |
| Transparent, formulaic (non-negotiated) partial cashout | Real sportsbooks apply an opaque "10-30% below fair value" house margin baked into a live pricing algorithm users can't audit. ApostaE, lacking live odds, is better served by a **transparent, fixed formula** (e.g., proportional to stake × odds_at_time, possibly minus a small platform fee) that the user can understand and that is trivially auditable/testable — this is more defensible than trying to fake a "live pricing engine" | MEDIUM | Recommend documenting the formula in-app; avoids the complexity and audit risk of building something that mimics live-odds pricing without the live data to back it |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Live-odds-driven cashout pricing (mimicking Betfair/bet365 in-play algorithm) | "Real" sportsbooks do this, so it looks more sophisticated/legitimate | ApostaE has no live odds feed, no in-play probability engine, and no continuously-updating market data — building a fake "live pricing" system either requires inventing an ungrounded probability model (arbitrary, hard to justify/audit) or silently degrades to a fixed formula anyway, at much higher implementation and testing cost | Deterministic formula off data ApostaE already has: stake × odds_at_time, minus platform fee/margin, computed server-side at request time and re-validated at confirm time |
| Full cashout (100% withdrawal) | Natural adjacent feature once partial cashout exists ("why not let them cash out everything?") | Explicitly out of scope per PROJECT.md; scope creep risk — full cashout has different edge cases (wager becomes fully closed vs partially reduced) that would expand this phase's surface area | Ship partial cashout only this milestone; revisit full cashout as a follow-on once partial cashout's transactional/concurrency patterns are proven in production |
| Real-time push notifications (WebSocket/SSE) | Users expect instant notification delivery like real sportsbooks (push alerts) | No realtime transport exists in the codebase today; retrofitting WebSocket/SSE alongside 4 other new features in one milestone multiplies scope and risk, and PROJECT.md explicitly defers this | Build notification structure only (DB table, read/unread, paginated REST endpoint) this milestone; poll-based or on-load fetching is sufficient for now, real-time delivery is a clean follow-on milestone |
| Promotional/marketing notifications mixed into the notification feed | "While we're building notifications, let's add odds-boost/promo alerts too" — common sportsbook pattern | Research found 93% of major sportsbook app notifications are promotional and this is flagged as a consumer-protection concern (NCL); mixing marketing into a transactional notification feed also dilutes signal for the actually-important alerts (won/lost/cashout-available) and isn't in this milestone's scope | Keep notification types strictly to the 6 specified in PROJECT.md (closed, resolved, won, lost, status change, cashout-available); no promotional content |
| Unlimited free-form cancellation windows / no cutoff near resolution | Users will ask "why can't I cancel right up until the market resolves?" | This is precisely the abuse vector research identifies — cancelling (or partial-cashing-out) right before an unfavorable outcome, exploiting information asymmetry the moment an admin is about to reveal/has revealed the outcome | Hard cutoff already specified in PROJECT.md: block cancellation once market closed, wager resolved, or a cashout occurred on that wager — enforce this as a database-level status check inside the same transaction, not just a UI-level restriction |
| Client-computed cashout/cancellation amounts (even "for display speed") | Feels natural to compute the 95% or cashout estimate in JS for instant UI feedback | PROJECT.md explicitly requires backend-calculated values that are never trusted from frontend; a client-side estimate that isn't re-verified server-side at commit time is a direct path to a financial exploit (IDOR/tampering equivalent for money amounts) | Backend always computes and returns the authoritative quote; frontend may show a rough client-side *preview* using the same formula for perceived responsiveness, but the commit endpoint must independently recompute and reject if the value has changed materially (see Pitfalls research on race conditions) |
| Pari-mutuel / pool-based payouts for the new market types | Superficially appealing for multiple-choice markets (like a horse-racing tote pool) since payout naturally scales with number of participants per outcome | Fundamentally incompatible with ApostaE's existing wager model, which captures `odds_at_time` and `potential_payout` at bet placement (fixed-odds semantics) — switching any market type to pool semantics means the bettor doesn't know their payout until the pool closes, breaking the "immutable wager economics at placement" invariant PROJECT.md relies on for the existing binary markets | Keep all new market types (Over/Under, multiple-choice) as fixed-odds, exactly like the existing binary market — odds/payout multiplier locked at bet time, admin/scheduler determines the winning outcome, no pool math |

## Feature Dependencies

```
[Market Notifications]
    └──provides infra for──> [Cashout-available notification] (Differentiator)
    └──provides infra for──> [Resolution/status notifications for new market types]

[New Market Types (Over/Under, Multiple-Choice)]
    └──must exist before──> [Partial Cashout applies uniformly across all market types]
    └──must exist before──> [Cancellation v2 applies uniformly across all market types]
       (in practice: build order in PROJECT.md is Notifications → Cashout → Market Types → Cancellation,
        which means Cashout and Cancellation v1 scope should be written against the CURRENT binary-only
        model, then re-verified/extended once new market types land — see Note below)

[Partial Cashout]
    └──conflicts with (must check against)──> [Cancellation v2]
       (a wager that already had a cashout must be blocked from cancellation, and vice versa —
        PROJECT.md explicitly requires this mutual exclusion)

[Multiple-Choice Market] ──shares data model with──> [Over/Under Market]
       (both are "N-outcome market" generalizations of the existing binary market;
        Over/Under is the N=2 case with a numeric threshold instead of Sim/Não labels)
```

### Dependency Notes

- **Notifications enhances Cashout:** the "cashout-available" notification type depends on the notification infrastructure existing first — this is *why* PROJECT.md sequences notifications before cashout, not the reverse. Confirmed as correct sequencing by this research.
- **Partial Cashout precedes New Market Types in the build order, but the cashout formula must be market-type-agnostic from day one.** Since cashout is built (phase 2) before Over/Under and multiple-choice exist (phase 3), the cashout formula, edge-case handling, and schema should be designed generically against "a wager with stake + odds_at_time + market status," not hardcoded to binary Sim/Não — otherwise phase 3 forces a rework of phase 2. Flag this explicitly for the phase 2 plan.
- **Cancellation v2 conflicts with Partial Cashout on the same wager:** both mutate wager state and wallet balance; PROJECT.md requires cancellation blocked if "a cashout already occurred on that wager." This must be enforced transactionally (row lock / status check) since both endpoints could race on the same wager row.
- **Multiple-Choice and Over/Under share a data model problem:** both need a way to represent a variable/parameterized set of outcomes per market, which the current binary model (fixed Sim/Não columns or enum) doesn't support. This is the highest-complexity single item in the milestone — expect it to need a dedicated options/outcomes table with a foreign key to markets, and payout/resolution logic that operates over "the outcome selected by the wager" rather than a hardcoded boolean.

## MVP Definition

Per PROJECT.md, all four features are the scope of this milestone — there's no larger "would be nice" set to trim from. The MVP framing here is about internal sequencing and depth, not feature selection.

### Launch With (v1 — this milestone, per PROJECT.md's fixed build order)

- [ ] Market notifications (closed, resolved, won, lost, status change, cashout-available), structure-only, paginated, read/unread — foundation for cashout-available notification later
- [ ] Partial cashout — backend-computed deterministic formula (not live-odds-driven), transactional, minimum-amount enforced, blocked once market closed/wager resolved
- [ ] Over/Under market type — admin-configurable threshold, reuses binary payout mechanics
- [ ] Multiple-choice market type — dynamic option count, dedicated options table, resolution/payout logic generalized to N outcomes
- [ ] Cancellation v2 — 5% fee / 95% refund, blocked on closed market / resolved wager / prior cashout, full audit trail

### Add After Validation (v1.x — explicitly deferred by PROJECT.md, not this research's call to change)

- [ ] Real-time notification delivery (WebSocket/SSE) — once structure-only notifications are proven in production and a transport layer decision is made
- [ ] Full (100%) cashout — once partial cashout's transactional/concurrency patterns are validated

### Future Consideration (v2+)

- [ ] Live/dynamic odds movement (would require rethinking cashout pricing entirely — currently out of scope and likely a much larger architectural change)
- [ ] Promotional notification types — deliberately excluded as an anti-feature (see above); would need a separate opt-in/consent and regulatory review before consideration
- [ ] Responsible-gambling tooling (deposit/wager limits, reality checks, self-exclusion) — not in current scope, but flagged here because regulatory research surfaced it as a common requirement for real-money betting products; ApostaE's PROJECT.md doesn't mention regulatory/licensing status, so this is a gap worth raising with the project owner if ApostaE is intended for real-money production use

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Market notifications (structure-only) | MEDIUM | LOW | P1 |
| Partial cashout | HIGH | HIGH | P1 |
| Over/Under market type | MEDIUM | MEDIUM | P1 |
| Multiple-choice market type | HIGH | HIGH | P1 |
| Cancellation v2 (fee-based) | MEDIUM | MEDIUM | P1 |
| Cashout-available notification | LOW-MEDIUM | LOW (reuses infra) | P2 (bundle into notifications or cashout phase) |
| Full cashout | MEDIUM | HIGH | P3 (deferred) |
| Real-time push delivery | HIGH (engagement) | HIGH | P3 (deferred) |

**Priority key:**
- P1: In scope this milestone (per PROJECT.md, all four core features are must-have)
- P2: Should have, natural extension of P1 work, low incremental cost
- P3: Explicitly out of scope this milestone per PROJECT.md

## Competitor Feature Analysis

| Feature | Betfair/bet365/FanDuel (live sportsbooks) | ApostaE's constraint | Our Approach |
|---------|--------------------------------------------|-----------------------|--------------|
| Cashout pricing | Live win-probability model, algorithmic, 10-30% below fair value, opaque to user | No live odds feed, no in-play data | Deterministic formula from stake × odds_at_time (+ platform fee), transparent and auditable, computed server-side per request |
| Cashout availability window | Suspended during high-volatility live moments (scoring plays, reviews) | No continuous "live" state — only open/closed/resolved | Binary cutoff: cashout allowed only while market.status = 'open' AND wager.status = 'pending' |
| Multi-outcome markets | Race/multi-outcome markets modeled as market + N outcome rows, fixed-odds per outcome at bet time | Same fixed-odds paradigm already used for binary markets | Extend with an `options` (or `market_outcomes`) table; wager references the specific option chosen, not a boolean |
| Notification content | Mostly promotional (93% ad content) + settlement status | N/A — greenfield feature for ApostaE | Strictly transactional: closed/resolved/won/lost/status-change/cashout-available only, no promo content |
| Cancellation/void abuse prevention | Velocity checks, pattern analysis, hard cutoff at outcome determination, account-level restrictions | Simpler product (no multi-account, no bonus system in scope) | Adopt the cutoff pattern only (block once market closed/resolved/cashed-out) — velocity/pattern-analysis-style fraud detection is out of scope for this milestone's size but worth flagging as a v2+ consideration if abuse is observed |

## Sources

- [Cash Out Betting: How It Works and When It's Worth It](https://www.sportsboom.us/betting/cash-out-betting-explained)
- [Cash Out Sports Betting Guide: How It Works & Top Tips](https://www.boydsbets.com/cash-out-in-sports-betting/)
- [Cash Out Calculator | See If You Should Cash Out Or Stay](https://bettingtools.com/calculators/cash-out/)
- [What is the Cash Out Feature? - FanDuel Support](https://support.fanduel.com/s/article/What-is-the-Cash-Out-Feature)
- [Cash Out - Betfair Sportsbook Support](https://support.betfair.com/app/answers/detail/4-sportsbook-what-is-cash-out-and-how-does-it-work/)
- [Cash Out – William Hill Support](https://help.williamhill.com/hc/en-gb/articles/30100205127709-Cash-Out)
- [Cash Out Feature: How it works & Important Reminders - Bovada Help Center](https://www.bovada.lv/help/sports-faq/how-does-the-cash-out-feature-work)
- [bet365 Cash Out Explained (July 2026)](https://www.aceodds.com/features/bet365-cash-out.html)
- [Sports Betting Cash Out Rules: Legal Requirements Explained | OddsIndex](https://oddsindex.com/guides/cash-out-rules-legal)
- [Cash Out Features - bet365 Help Center](https://help.bet365.com/en/product-help/sports/betting-features/cash-out/cash-out)
- [When will my bet be settled? - bet365 Help Center](https://help.bet365.com/s/en/sports/bet-settlement)
- [How Push Notifications Help Betting Sites & Apps Win Big - PushEngage](https://www.pushengage.com/growth-playbook-for-betting-sites-and-apps/)
- [Advertising sports betting with smartphone notifications - National Consumers League](https://nclnet.org/advertising-sports-betting-with-smartphone-notifications-what-ncl-learned-and-how-regulators-can-act/)
- [Bonus Abuse in Gambling: Types, Risks & How to Prevent It - Sumsub](https://sumsub.com/blog/promo-abuse-fraud-how-to-avoid-it/)
- [Arbitrage Betting: Help! My Sportsbook Account Is Closed! - SportsBettingDime](https://www.sportsbettingdime.com/guides/strategy/avoiding-sportsbook-restrictions-arbitrage-betting/)
- [How to Spot and Prevent Online Gambling Fraud - OddsMatrix](https://oddsmatrix.com/online-gambling-fraud/)
- [How to Address Arbitrage Betting - OddsMatrix](https://oddsmatrix.com/sports-betting-arbitrage/)
- [Pari-Mutuel Horse Racing: How Pool Betting Works](https://www.thesportsgeek.com/sports-betting/horse-racing/pari-mutuel-betting/)
- [Calculating Payoffs from a Parimutuel Pool | RiskingTime](https://riskingtime.com/calculate-payoffs-from-a-parimutuel-pool/)
- [Fixed odds: Meaning, Criticisms & Real-World Uses](https://diversification.com/term/fixed-odds)
- [Responsible Online Gambling: Limits, Tools, Self-Exclusion - esports.gg](https://esports.gg/guides/betting/responsible-gambling/)
- [Responsible Gaming Regulations and Statutes Guide - American Gaming Association](https://www.americangaming.org/resources/responsible-gaming-regulations-and-statutes-guide/)
- [Internet Responsible Gambling Standards Rev. 12-2023 - NCPG](https://www.ncpgambling.org/wp-content/uploads/2024/01/Internet-Responsible-Gambling-Standards-Rev.-12-2023-FINAL.pdf)

---
*Feature research for: online betting/wagering platform feature expansion (ApostaE)*
*Researched: 2026-07-13*
