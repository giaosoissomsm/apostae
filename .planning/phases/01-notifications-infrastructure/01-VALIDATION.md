---
phase: 1
slug: notifications-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-13
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None installed — `package.json` test script is a stub (`"echo \"Add tests later\""`). Wave 0 must install one (Jest or Vitest — either is reasonable for this CommonJS Node/Express codebase). |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | N/A until framework installed |
| **Full suite command** | N/A until framework installed |
| **Estimated runtime** | ~10-20s once installed (small test count this phase) |

This is a pre-existing, milestone-wide gap (flagged in STATE.md Blockers and `.planning/codebase/CONCERNS.md` as CRITICAL). Phase 1 is the first phase that actually needs it in practice: NOTIF-08 (IDOR) and NOTIF-09 (idempotency) both require automated verification per `requisitos.txt`'s "test attack vectors" mandate.

---

## Sampling Rate

- **After every task commit:** Run the relevant new test file(s) directly once the framework exists
- **After every plan wave:** Run the full new-test suite for this phase
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds (small, focused test files; no e2e browser tests this phase)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-xx | 01 | 0 | — | — | Test framework installed and runnable | infra | `npm test` exits 0 (no test files yet) | ❌ W0 | ⬜ pending |
| 01-xx-xx | TBD | TBD | NOTIF-08 | IDOR on notification routes | Cross-user notification access rejected (403/404, not another user's data) | integration | `<framework> tests/notifications.ownership.test.js` | ❌ W0 | ⬜ pending |
| 01-xx-xx | TBD | TBD | NOTIF-09 | Duplicate event delivery | Retried/duplicate event produces exactly one notification row | integration | `<framework> tests/notifications.idempotency.test.js` | ❌ W0 | ⬜ pending |
| 01-xx-xx | TBD | TBD | NOTIF-06 | — | Paginated list is bounded, newest-first, correctly ordered | integration | `<framework> tests/notifications.pagination.test.js` | ❌ W0 | ⬜ pending |
| 01-xx-xx | TBD | TBD | NOTIF-07 | — | Mark-as-read persists; listing never auto-marks read | integration | `<framework> tests/notifications.read-state.test.js` | ❌ W0 | ⬜ pending |
| 01-xx-xx | TBD | TBD | NOTIF-01..05 | — | Each event type produces a correctly-scoped, correctly-worded notification | integration | `<framework> tests/notifications.events.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Task IDs/plan/wave are TBD — the planner assigns final IDs; this table's requirement→test mapping is the binding contract.*

---

## Wave 0 Requirements

- [ ] Install a test framework (Jest or Vitest) and wire `npm test` to run it
- [ ] Test DB/fixture setup — a way to spin up/reset a test PostgreSQL schema (none exists today); required before any integration test below can run
- [ ] `tests/notifications.ownership.test.js` — stub for NOTIF-08
- [ ] `tests/notifications.idempotency.test.js` — stub for NOTIF-09
- [ ] `tests/notifications.pagination.test.js` — stub for NOTIF-06
- [ ] `tests/notifications.read-state.test.js` — stub for NOTIF-07
- [ ] `tests/notifications.events.test.js` — stub for NOTIF-01 through NOTIF-05

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification once Wave 0 lands.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (test framework, fixture DB, all 5 test files above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter (set by planner once Wave 0 tasks are defined)

**Approval:** pending
