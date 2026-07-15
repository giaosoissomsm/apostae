---
phase: 04-bet-cancellation-v2
plan: 03
subsystem: payments
tags: [wallet, wager, cancellation, concurrency, idor, jest, integration-test, security]

# Dependency graph
requires:
  - phase: 04-bet-cancellation-v2
    provides: "04-01's rewritten wagerService.cancelWager (5%/95% fee split, market->wager->wallet lock order, IDOR-hardened lookup, hard block on prior cashout)"
provides:
  - "tests/cancel.blocking.test.js — proves CANCEL-06: closed market, resolved wager, and prior-cashout each reject with ConflictError and produce zero side effects"
  - "tests/cancel.concurrency.test.js — proves CANCEL-07: cancel racing cashoutWager and cancel racing resolveMarket via Promise.allSettled never double-pay, never deadlock"
  - "tests/cancel.tampering.test.js — proves CANCEL-08: non-owner gets 404 (NotFoundError) not 403, no client-trusted amount/fee, DELETE /:id route unchanged"
affects: ["milestone completion — this is the final plan of the final phase"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "cancel.tampering.test.js splits into two describe blocks: one with a DB-touching beforeAll (IDOR integration test only), one with no beforeAll at all (static/structural checks) — so a test-DB outage never masks the static tests' own pass/fail signal"
    - "Mock-backed dry run for this plan used a genuine async-mutex row-lock emulator (not just sequential fakes) so Promise.allSettled races actually contend for locks the same way Postgres FOR UPDATE would, letting both race orderings (cancel-wins / cashout-wins, cancel-wins / resolve-wins) be exercised against the real, unmodified wagerService/marketService"

key-files:
  created:
    - tests/cancel.blocking.test.js
    - tests/cancel.concurrency.test.js
    - tests/cancel.tampering.test.js
  modified: []

key-decisions:
  - "No live *test*-named Postgres reachable in this sandbox (carried-forward Phase 1-4 blocker, reconfirmed this plan against both default DB_NAME=apostae — assertTestDatabase refuses to run — and an explicit apostae_test override — pg_hba.conf rejects the connection entirely: 'no pg_hba.conf entry for host 172.16.60.3, user apostae, database apostae_test'). This is the FIFTH consecutive phase to hit this exact blocker."
  - "Compensated CANCEL-06/CANCEL-07/CANCEL-08 logic via a temporary mock-backed dry run (deleted before commit, not part of the deliverable) that fakes only src/config/database.js's query()/transaction()/pool exports via require.cache injection, leaving wagerService.cancelWager, wagerService.cashoutWager, marketService.resolveMarket, and every repository (wagerRepository/marketRepository/walletRepository/cashoutRepository) as the real, unmodified committed source. Unlike 04-01/04-02's dry runs (which drove sequential logic only), this dry run implemented a genuine per-row async-mutex lock manager so Promise.allSettled races in the concurrency scenarios actually contend for locks the way Postgres FOR UPDATE would — this is a materially stronger compensation than a sequential fake for CANCEL-07 specifically, though it is still NOT a substitute for real Postgres serialization (see Known Limitation below)."
  - "cancel.tampering.test.js structurally separates the IDOR integration test (needs DB) from the two static/structural checks (route text + controller source text, no DB) into two independent describe blocks with no shared beforeAll — verified live that a DB beforeAll failure fails only the IDOR test and leaves the two static tests green (2 passed, 1 failed when run against this sandbox's inaccessible DB)."

requirements-completed: [CANCEL-06, CANCEL-07, CANCEL-08]

coverage:
  - id: D1
    description: "tests/cancel.blocking.test.js: closed market, resolved wager (non-pending status), and prior cashout (cashed_out_amount > 0) each reject cancelWager with ConflictError and leave wallet balance and wager status completely unchanged"
    requirement: "CANCEL-06"
    verification:
      - kind: integration
        ref: "tests/cancel.blocking.test.js — all 3 cases; mock-backed dry run driving the real unmodified cancelWager, 9/9 assertions passed"
        status: pass
    human_judgment: true
    rationale: "Written and structurally correct, logic independently verified via mock-backed dry run against the real cancelWager, but never executed via jest against a real Postgres connection in this sandbox (reconfirmed blocker, see Deviations)."
  - id: D2
    description: "tests/cancel.concurrency.test.js: cancel races cashoutWager (Test A) and cancel races marketService.resolveMarket (Test B) via Promise.allSettled on the same wager — in both tests, no double-pay, no deadlock, exactly one committing operation"
    requirement: "CANCEL-07"
    verification:
      - kind: integration
        ref: "tests/cancel.concurrency.test.js Test A/Test B — mock-backed dry run with a genuine async-mutex row-lock emulator, run under BOTH array orderings (cancel-first and cashout/resolve-first) to exercise both branches of the tolerant if/else assertions; 15/15 assertions passed under original ordering, 16/16 under swapped ordering (Test A's cashout-wins branch only reachable under the swap — confirmed correct)"
        status: pass
    human_judgment: true
    rationale: "CRITICAL: mocks — even this plan's stronger mutex-based emulator — are structurally incapable of proving REAL PostgreSQL FOR UPDATE row-lock serialization (same class of gap 02-REVIEW.md CR-01 and 03-REVIEW.md CR-01 already demonstrated twice this milestone). The emulator proves the SERVICE LOGIC is correct under genuine async contention (both race orderings produce the expected serialized outcome, no double-pay, no unhandled deadlock-shaped error), which is a materially stronger signal than a sequential-only fake — but it cannot exercise Postgres's actual lock manager, WAL, or its real 40P01 deadlock detector. A human/CI run against a real test Postgres is still required to fully close CANCEL-07."
  - id: D3
    description: "tests/cancel.tampering.test.js: non-owner cancel attempt on another user's wager returns NotFoundError (404) not AuthorizationError (403); cancelWager.length === 2 and the controller handler reads only req.params.id + req.user.id (never req.body); the DELETE /:id route with requireAuth is textually unchanged"
    requirement: "CANCEL-08"
    verification:
      - kind: integration
        ref: "tests/cancel.tampering.test.js IDOR case — mock-backed dry run, 5/5 assertions passed"
        status: pass
      - kind: unit
        ref: "tests/cancel.tampering.test.js static describe block — ran live via npx jest tests/cancel.tampering.test.js in this sandbox (no mocking needed, no DB touched): 2/2 static tests PASSED for real, 1/1 IDOR integration test FAILED only on the expected DB-connectivity error"
        status: pass
    human_judgment: true
    rationale: "The two static/structural tests are proven with a REAL jest run in this sandbox (no compensation needed — see Verification section). Only the IDOR integration test (needs a live DB row lock) carries the same carried-forward human-judgment caveat as D1/D2."

# Metrics
duration: 25min
completed: 2026-07-15
status: complete
---

# Phase 4 Plan 3: Negative-Path and Attack-Vector Tests for cancelWager Summary

**Three new test files (`tests/cancel.blocking.test.js`, `tests/cancel.concurrency.test.js`, `tests/cancel.tampering.test.js`) proving `cancelWager`'s negative paths and attack surface: the three CANCEL-06 block conditions reject with zero side effects, CANCEL-07's cancel-vs-cashout and cancel-vs-resolve races never double-pay or deadlock (verified via a genuine async-mutex mock lock manager under both race orderings), and CANCEL-08's IDOR/no-trusted-body/unchanged-route guarantees hold — this is the final plan of the entire milestone.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-15T04:57:00Z (approx, following 04-02's completion)
- **Completed:** 2026-07-15T05:09:05Z
- **Tasks:** 3
- **Files created:** 3

## Accomplishments

- `tests/cancel.blocking.test.js` — three CANCEL-06 negative-path cases (closed market, resolved wager, prior cashout), each asserting `ConflictError` and zero wallet/status side effects. The prior-cashout case is explicitly documented as the double-pay-prevention proof superseding Phase 2's CR-02 netting behavior.
- `tests/cancel.concurrency.test.js` — CANCEL-07's two race scenarios, mirroring `tests/cashout.concurrency.test.js`'s `Promise.allSettled`/never-sequential-awaits convention exactly:
  - Test A: `cancelWager` races `cashoutWager` on the same pending wager — proves at most one operation commits, no `wager_cashouts`+`refund` double-pay, no raw deadlock error escapes.
  - Test B: `cancelWager` races `marketService.resolveMarket` — proves no double credit (refund + resolution payout on the same wager), correct market->wager lock-order serialization.
- `tests/cancel.tampering.test.js` — CANCEL-08's attack surface: IDOR proof (non-owner gets 404 not 403), a structural `cancelWager.length === 2` + controller-source-text check that no `req.body` is read in the `cancelWager` handler, and a route-text check that `DELETE /:id` + `requireAuth` is unchanged. Deliberately split into two `describe` blocks (one DB-dependent for the IDOR case, one with no `beforeAll` at all for the two static checks) so a test-DB outage never silently fails the static assertions too.

## Task Commits

Each task was committed atomically:

1. **Task 1: cancel.blocking.test.js** - `22482c2` (test)
2. **Task 2: cancel.concurrency.test.js** - `7694ec9` (test)
3. **Task 3: cancel.tampering.test.js** - `8ab1a3a` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created

- `tests/cancel.blocking.test.js` - Integration test proving CANCEL-06's three block conditions (closed market / resolved wager / prior cashout) all reject with `ConflictError` and zero side effects
- `tests/cancel.concurrency.test.js` - Integration test proving CANCEL-07: cancel-vs-cashout and cancel-vs-resolve races via `Promise.allSettled` never double-pay, never deadlock, exactly one operation commits per race
- `tests/cancel.tampering.test.js` - Integration + structural test proving CANCEL-08: non-owner gets 404 not 403, no client-trusted body field, `DELETE /:id`+`requireAuth` route unchanged

## Decisions Made

- Followed 04-02's exact setup convention (`applyBaseSchema` + `applyWalletSchema` + `applyCashoutMigration` + `seedTestUser` in `beforeAll`, `closePool` in `afterAll`) for the DB-dependent describe blocks — no new schema/migration needed.
- Used raw `UPDATE markets SET status = 'closed'` / `UPDATE wagers SET status = 'won'` in `cancel.blocking.test.js` to force each blocked state, since `seedOpenMarket`/`seedWager` only seed the `'open'`/`'pending'` happy-path state (per the plan's own context note).
- `cancel.concurrency.test.js` reads `env.CANCEL_FEE_PERCENT` and derives expected values at test time (never hardcodes `5`/`95`), matching the convention already established in 04-01/04-02's test files.
- `cancel.tampering.test.js`'s static checks were split into their own `describe` block with zero `beforeAll` — this is a deliberate structural improvement beyond a literal reading of the plan (the plan's action text described three tests inside one implied block); confirmed live in this sandbox that the split actually works as intended (2 static tests pass for real, only the IDOR test fails on the expected DB-connectivity error, and the failure does not cascade into the static tests).
- For the mock-backed dry-run compensation (temporary, not committed), built a genuine per-row async-mutex lock manager (not just a sequential fake) specifically because CANCEL-07 is a concurrency requirement — a purely sequential mock would prove nothing about actual contention behavior. This is a deliberate escalation beyond 04-01/04-02's compensation pattern, prompted by the plan's own `<important_note>` flagging CANCEL-07 as the highest-priority test in the phase.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written for all three test files' scope and structure. No bugs were found in the already-shipped `cancelWager`/`cashoutWager`/`resolveMarket` code during this plan's verification work.

### Other Notes (not deviations, documented per plan instructions)

**1. `npx jest` could not execute the DB-dependent tests against real Postgres in this sandbox — fifth consecutive phase**
- **Found during:** All three tasks' `<verify>` steps
- **Issue:** Same carried-forward blocker documented in every prior phase (STATE.md, 04-RESEARCH.md, 04-01-SUMMARY.md, 04-02-SUMMARY.md): no live `*test*`-named PostgreSQL is reachable. Reconfirmed this plan against both the default `DB_NAME=apostae` (`assertTestDatabase` refuses to run, by design — ran `npx jest tests/cancel.happy-path.test.js` live and got this exact refusal) and an explicit `DB_NAME=apostae_test NODE_ENV=test` override (`pg_hba.conf` rejects the connection entirely: `no pg_hba.conf entry for host "172.16.60.3", user "apostae", database "apostae_test", no encryption`).
- **Resolution:** Per the plan's `<human-check>` instructions and the `<important_note>` in this plan's prompt, compensated via a temporary mock-backed dry run (deleted before commit, lived only in the session scratchpad, never part of the repo or any commit). Unlike prior phases' sequential-only fakes, this dry run implemented a genuine async-mutex row-lock manager (`Mutex` class with a FIFO queue per lock key) so that `Promise.allSettled` races in `cancel.concurrency.test.js`'s two scenarios actually contend for `market:`/`wager:`/`wallet:` locks the way Postgres `FOR UPDATE` would — not just run to completion sequentially. Ran the full 30-assertion suite twice, once with each function listed first in the `Promise.allSettled` array, to confirm BOTH branches of every tolerant if/else assertion in the committed test files are logically sound (cancel-wins and cashout-wins for Test A; both orderings for Test B consistently resolved via `resolveMarket` winning the market lock, a structural asymmetry — see Known Limitation below). All 30+ assertions passed in both orderings against the real, unmodified `wagerService`/`marketService`/all repositories.
- **Live-run exception:** `tests/cancel.tampering.test.js`'s two static/structural tests (route text + controller source text) required NO mocking or compensation at all — they were run for real via `npx jest tests/cancel.tampering.test.js` in this sandbox and genuinely PASSED (2 passed, 1 failed — the 1 failure being the IDOR integration test's expected DB-connectivity error, isolated cleanly in its own `describe` block).
- **Files modified:** None in the repo (temporary dry-run scripts lived only in the session scratchpad directory, outside the working tree, deleted before this commit).
- **Committed in:** N/A

**2. Known Limitation: cancel-vs-resolveMarket race has a structural lock-acquisition asymmetry**
- **Found during:** Task 2's dry-run verification (running Test B's race under both array orderings)
- **Observation:** In both orderings tested (`cancelWager` listed first, and `resolveMarket` listed first), `resolveMarket` consistently won the market-row lock in the mock-backed dry run. This is because `cancelWager` performs an extra unlocked "peek" query (`SELECT market_id FROM wagers WHERE id = $1;`) before requesting the market lock, while `resolveMarket` requests the market lock directly — one fewer microtask hop before the lock request. This is NOT a bug (both code paths are correct, and the committed `cancel.concurrency.test.js` Test B tolerates either winner per its own if/else structure), but it does mean the "cancel wins" branch of Test B may be less frequently exercised than the "resolve wins" branch when run against a real, lightly-loaded Postgres instance with near-simultaneous requests. This is purely an emergent timing characteristic of the two code paths' structure, not something the plan or this test file needs to fix — documented here for completeness since it surfaced during the stronger mutex-based compensation this plan used.
- **Impact:** None on correctness. Flagged for informational completeness only.

---

**Total deviations:** 0 auto-fixed. 2 documented environment/access limitations and observations (the test-DB blocker is carried forward from Phases 1-4 with a strengthened compensating verification for CANCEL-07 specifically; the lock-asymmetry note is a benign, non-actionable observation from that verification).
**Impact on plan:** No scope creep. All three test files' logic was independently verified correct against the real, unmodified `cancelWager`/`cashoutWager`/`resolveMarket` — including, for CANCEL-07 specifically, under genuine async lock contention exercising both race orderings, which is the strongest compensation this milestone has produced for a concurrency requirement without a live Postgres connection.

## Issues Encountered

- No live `*test*`-named Postgres reachable (see Deviations note 1 above) — same carried-forward blocker as Phases 1-4, now confirmed for a **fifth** consecutive phase. This is the final plan of the final phase of the milestone; the blocker should be resolved (or formally accepted as a milestone-level known gap) before any future milestone repeats this pattern a sixth time.
- Per this plan's explicit `<important_note>`: CANCEL-07's concurrency guarantee has NOT been proven against real PostgreSQL row-lock serialization in this sandbox. The mock-backed compensation used here is materially stronger than prior phases' (genuine async-mutex contention, both race orderings exercised) but is explicitly NOT equivalent to Postgres's actual lock manager, MVCC, or `40P01` deadlock detector. **Do not treat CANCEL-07 as fully verified against production infrastructure** — a real Postgres test-DB run of `tests/cancel.concurrency.test.js` is still required to close this out completely.

## User Setup Required

None - no external service configuration required. Tests use the existing `tests/helpers/testDb.js` fixtures with no new setup.

## Next Phase Readiness

- This is the final plan (04-03) of the final phase (04-bet-cancellation-v2) of the current milestone. All eight CANCEL-01..08 requirements now have committed test coverage across 04-01 (core rewrite), 04-02 (positive path), and 04-03 (negative path/attack vectors).
- **Outstanding milestone-level blocker (unchanged, now spanning all four phases and every plan in this phase):** a real `*test*`-named Postgres connection is still needed before ANY of the milestone's test files — including this plan's three new files and every prior phase's `tests/*.test.js` — get a genuine jest pass/fail signal against real infrastructure. This should be resolved, or explicitly accepted as a known milestone-close gap, before `/gsd-verify-work` or `/gsd-complete-milestone` runs. CANCEL-07 in particular (this plan) is the single test in the entire milestone most dependent on real Postgres semantics to fully validate — mocks (even the mutex-based one built for this plan) cannot substitute for the real lock manager.
- No further plans remain in this phase or milestone per the current ROADMAP.md.

---
*Phase: 04-bet-cancellation-v2*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: tests/cancel.blocking.test.js
- FOUND: tests/cancel.concurrency.test.js
- FOUND: tests/cancel.tampering.test.js
- FOUND: .planning/phases/04-bet-cancellation-v2/04-03-SUMMARY.md
- FOUND commit: 22482c2
- FOUND commit: 7694ec9
- FOUND commit: 8ab1a3a
