# ApostaE

## What This Is

ApostaE is a Node.js/Express betting platform where users deposit into a wallet, place wagers on markets (currently binary Sim/Não), and get paid out when markets resolve. It has PostgreSQL persistence, Redis caching, a layered Controller/Service/Repository architecture, and an admin panel for managing markets. This milestone expands it with notifications, partial cashout, richer market types, and fee-based cancellation.

## Core Value

Money movement (wallet balance, wagers, cashouts, cancellations) must always be correct and auditable — a user's balance must never diverge from the sum of their recorded transactions, even under concurrent access.

## Business Context

- **Customer**: End users placing real-money bets on markets; platform admins who create/resolve markets
- **Revenue model**: Takes a cut via cancellation fees (5%) and (implicitly) the odds/payout structure of resolved markets
- **Success metric**: Zero financial inconsistencies (balance drift, double-spends, missed audit entries) under concurrent load
- **Strategy notes**: See `prompt.txt` and `requisitos.txt` (repo root) — original feature brief and mandatory quality/security process, in Portuguese

## Requirements

### Validated

- ✓ User auth (session-based), registration, login — existing
- ✓ Wallet with balance tracking — existing (`src/repositories/walletRepository.js`, `src/migrations/002_wallet.js`)
- ✓ Binary (Sim/Não) markets — create, open, resolve — existing (`src/services/marketService.js`)
- ✓ Wager placement and payout calculation on market resolution — existing (`src/services/wagerService.js`)
- ✓ Basic wager cancellation (pending-only, no fee) — existing, to be replaced by fee-based cancellation this milestone
- ✓ Admin panel (`public/admin.html`) for market management — existing
- ✓ PostgreSQL transactions used for financial operations — existing pattern to extend
- ✓ Layered architecture (Controllers → Services → Repositories) — existing pattern to follow for all new code

### Active

- [ ] Market notifications — market closed / resolved / bet won / bet lost / status change / cashout-available, stored in Postgres, read/unread, paginated, dedicated API endpoint. Structure-only this milestone (no WebSocket/SSE — none exists in the codebase today); real-time delivery deferred to a future milestone.
- [ ] Partial cashout — user withdraws part of a wager's value pre-resolution, remainder stays active; backend-calculated value (never trust frontend), transactional, audited, protected against duplicate/simultaneous cashout and race conditions.
- [ ] New market types — Over/Under (admin-configurable threshold, e.g. 2.5/3.5) and multiple-choice (dynamic number of options, not capped at 3), alongside existing binary Sim/Não. Full admin UI for creating both types; all validation server-side.
- [ ] Bet cancellation v2 — replaces existing free/pending-only cancellation. Automatic 5% fee, 95% refunded to wallet, financial movement + audit logged, status → "Cancelada". Blocked when market closed, wager resolved, or a cashout already occurred on that wager.

**Build order** (per requisitos.txt — one feature at a time: implement → review → test positive/negative → test attack vectors → fix → next):
1. Market notifications
2. Partial cashout
3. New market types (Over/Under, multiple-choice)
4. Bet cancellation v2

### Out of Scope

- Full cashout (100% withdrawal) — not requested; only partial cashout is in scope this milestone
- Real-time push (WebSocket/SSE) for notifications — no existing infra; structure is prepared but live delivery is deferred
- Payment gateway / deposit / withdrawal integration — not mentioned in the brief, assumed out of scope
- Any change to the existing binary Sim/Não market resolution logic — extending market types, not replacing the existing one

## Context

- Brownfield codebase — mapped via `/gsd-map-codebase` into `.planning/codebase/` (STACK.md, ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, INTEGRATIONS.md, CONCERNS.md). Read these before planning any phase.
- Source brief: two files at repo root — `prompt.txt` (feature requirements) and `requisitos.txt` (mandatory process: one feature at a time, OWASP ASVS/Top 10 checklist, financial transactions, concurrency testing, code quality rules). Both are Portuguese-language instructions from the project owner and should be treated as binding requirements, not just references.
- `.planning/codebase/CONCERNS.md` flags existing technical debt (e.g. missing pagination on some queries) — worth checking before touching adjacent code.
- Git status at project init showed a deleted `src/middleware/rateLimiter.js` and several modified core files (auth, config, controllers) — in-progress work predating this planning session; verify current state before assuming any file's contents.

## Constraints

- **Security**: Every new endpoint must validate permissions server-side only, never trust client-submitted values (amounts, IDs, status), guard against IDOR, use parameterized queries — per requisitos.txt's OWASP ASVS/Top 10 checklist
- **Financial integrity**: Every operation touching balance/wallet/wager/cashout/cancellation must run inside a PostgreSQL transaction; every balance change must produce a corresponding audit/movement record — no direct balance mutation
- **Concurrency**: Must be safe under simultaneous cashouts, simultaneous cancellations, concurrent market updates, concurrent balance changes — use locking/transactions where needed
- **Process**: One feature fully implemented, reviewed, and tested before starting the next (requisitos.txt) — the roadmap should reflect this as sequential phases, not parallel ones
- **Architecture**: New code must follow the existing Controller/Service/Repository layering and conventions documented in `.planning/codebase/CONVENTIONS.md`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build order: Notifications → Partial Cashout → New Market Types → Cancellation v2 | Follows the brief's listed order; notifications infra can be reused by later features (cashout-available, resolution alerts) | — Pending |
| Notifications: structure-only, no WebSocket/SSE this milestone | No realtime transport exists in the codebase; brief explicitly allows "prepare structure for future implementation" as a fallback | — Pending |
| New market types get full admin UI, not API-only | requisitos.txt explicitly requires the admin panel to support creating these market types | — Pending |
| Existing binary Sim/Não market logic is extended, not replaced | Minimizes regression risk on live financial logic; Validated requirement stays intact | — Pending |
| Partial cashout uses a stake-proportional formula (stake × odds_at_time × fraction, minus fee), not probability-weighted | ApostaE has no live-odds feed; a probability-weighted "fair value" formula would be ungrounded and hard to audit. Stake-proportional is deterministic, transparent, and matches the cancellation-fee mechanism. Confirmed by project owner after research flagged it as needing explicit sign-off. | — Pending |

---
*Last updated: 2026-07-13 after initialization*

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state
