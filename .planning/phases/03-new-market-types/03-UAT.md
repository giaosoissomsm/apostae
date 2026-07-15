---
status: partial
phase: 03-new-market-types
source: [03-VERIFICATION.md]
started: 2026-07-15T05:35:00Z
updated: 2026-07-15T05:35:00Z
---

## Current Test

[testing paused — 3 items outstanding, blocked on infrastructure, at user's request to stop UAT and move to Phase 4 (same call as Phase 1 and Phase 2)]

## Tests

### 1. Schema + full suite against real Postgres (MARKET-01 through MARKET-08)
expected: Point DB_* env vars at a reachable *test*-named Postgres, NODE_ENV=test, run migrations 001-006 (confirm 005's down reverses cleanly), then run `npm test` — all 22 suites pass green, specifically confirming the CR-01-fixed seedMarketOptions() CTE query executes without a SQL syntax error, and the full Phase 1/2 regression corpus still passes (no cross-phase regression).
result: blocked
blocked_by: other
reason: "No isolated Postgres test database is reachable from this sandbox (same pg_hba.conf/proxy gap as Phase 1/2). User directed: stop UAT, move to Phase 4, same as the established precedent."

### 2. Browser walkthrough of all 3 market types (MARKET-01, MARKET-02, MARKET-03, MARKET-08)
expected: As admin, create a binary market (form/ticket unchanged), an Over/Under market (threshold 2.5 + Odds Over/Under), and a multiple-choice market with 4+ options. As a user, place a wager on each (binary via Sim/Não, others via option buttons); confirm my-wagers shows correct option label. As admin, resolve each market; confirm winners credited, losers marked lost, resolution notification shows the option LABEL for new types, and the cashed-out-then-resolved case pays only the remaining fraction.
result: blocked
blocked_by: other
reason: "No browser/DOM automation harness exists in this repo and this sandbox has no interactive browser. Deferred alongside test 1 at user's explicit request."

### 3. Attack spot-check — IDOR and option-count bound (MARKET-04, MARKET-05, MARKET-06)
expected: Attempt to place a wager on market B using an option_id from market A → must be rejected. Submit a multiple-choice create with 21 options bypassing the UI → must be rejected server-side. (Note: route-wiring for requireAuth→requireAdmin on POST /api/markets WAS behaviorally verified in this session and passed — only the option-scoping IDOR guard itself and the 21-option live rejection remain unexercised against real data.)
result: blocked
blocked_by: other
reason: "The IDOR guard's core behavior (a WHERE id=$1 AND market_id=$2 lookup genuinely returning no row for a foreign option) can only be proven with real inserted cross-market rows and a live Postgres connection. Deferred alongside tests 1-2 at user's explicit request."

## Summary

total: 3
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 3

## Gaps
