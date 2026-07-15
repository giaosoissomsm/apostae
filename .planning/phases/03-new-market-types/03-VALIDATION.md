---
phase: 03
slug: new-market-types
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest ^30.4.2 |
| **Config file** | `jest.config.js` (repo root) — `testMatch: ['**/tests/**/*.test.js']`, `testEnvironment: 'node'` |
| **Quick run command** | `npx jest tests/markets.<name>.test.js` |
| **Full suite command** | `npm test` (== `jest --runInBand`, serialized — integration tests share one Postgres test DB) |
| **Estimated runtime** | ~5s (mirrors Phase 2's `npm test` timing) |

---

## Sampling Rate

- **After every task commit:** Run the relevant single test file (`npx jest tests/markets.<name>.test.js`).
- **After every wave merge:** Run the full suite (`npm test`) — includes Phase 1/2 regression coverage.
- **Phase gate (before `/gsd-verify-work`):** Full suite green against real Postgres (not mocks) — per Phase 2's own review lesson (CR-01 was a real bug that only mocked tests missed).

---

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MARKET-01 | Admin creates Over/Under market with freeform threshold | integration | `npx jest tests/markets.creation.test.js` | ❌ Wave 0 |
| MARKET-02 | Admin creates multiple-choice market, dynamic option count | integration | `npx jest tests/markets.creation.test.js` | ❌ Wave 0 |
| MARKET-03 | Existing binary markets unaffected (regression) | integration | `npx jest tests/markets.creation.test.js` (binary case) + rerun Phase 2's existing `tests/cashout.*.test.js` unmodified | ❌ Wave 0 (new file); Phase 2 files already exist |
| MARKET-04 | Server-side validation (count/threshold/duplicates) rejects bad input | unit + integration | `npx jest tests/markets.validation.test.js` | ❌ Wave 0 |
| MARKET-05 | Option count bounded server-side regardless of UI | integration | `npx jest tests/markets.validation.test.js` (over-max-options case) | ❌ Wave 0 |
| MARKET-06 | option_id cannot cross-reference another market's option (IDOR) | integration | `npx jest tests/markets.idor.test.js` | ❌ Wave 0 |
| MARKET-07 | N-outcome resolution pays out correctly for all 3 market types | integration | `npx jest tests/markets.resolution.test.js` | ❌ Wave 0 |
| MARKET-08 | Admin panel UI creates both new types; dashboard renders N options | manual-only (no browser-automation framework in this repo — Jest is Node-only, no Playwright/Cypress) | N/A — human verification checkpoint | N/A |

---

## Wave 0 Gaps

- [ ] `tests/markets.creation.test.js` — covers MARKET-01, MARKET-02, MARKET-03
- [ ] `tests/markets.validation.test.js` — covers MARKET-04, MARKET-05
- [ ] `tests/markets.idor.test.js` — covers MARKET-06
- [ ] `tests/markets.resolution.test.js` — covers MARKET-07 (all 3 market types, plus a cashed-out-then-resolved regression reusing Phase 2's `seedWager({ cashedOutAmount })` pattern)
- [ ] `tests/helpers/testDb.js` extension: `applyMarketTypesMigration()`, `seedMarketOptions(marketId, options[])`, extend `seedOpenMarket()`/`seedWager()` to accept `marketType`/`threshold`/`optionId`
- [ ] Framework install: none — Jest already present

---

## Known Environment Constraint

Same carried-forward limitation as Phase 1 and Phase 2: no live `*test*`-named Postgres database is reachable in this sandbox. All Wave 0 test files above will be written to the real interface contract (ready to run against a real test DB) and compensated with mock-backed dry runs where needed, exactly as every prior phase's plans did. This does not change the sampling rate or test map above — it changes only how "passing" is provisionally confirmed until a live test DB is reachable (see 03-07's phase-gate human-verify checkpoint).
