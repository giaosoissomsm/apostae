---
phase: 03-new-market-types
plan: 06
subsystem: ui
tags: [vanilla-js, admin-panel, market-types, xss-safe]

# Dependency graph
requires:
  - phase: 03-03
    provides: "marketService.createMarket payload contract (market_type, threshold, odds_over/odds_under, options[])"
  - phase: 03-05
    provides: "marketService.resolveMarket contract (outcome for binary vs winning_option_id for over_under/multiple_choice)"
provides:
  - "Admin creation form: #mMarketType selector + 3 toggled fieldsets (binary/over_under/multiple_choice), per 03-UI-SPEC.md"
  - "Dynamic multiple-choice option-row builder (2-20 bound, client convenience only)"
  - "Admin market list: Tipo column, type-aware odds cell, type-aware result label, non-binary resolve-select + Resolver button"
affects: [03-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "display:contents wrapper toggling to preserve grid-2 layout for the visible fieldset without hand-rolling per-fieldset grid-column overrides"
    - "Per-market-type helper functions (typeLabel/oddsCell/resultLabel/actionsCell) instead of inline ternaries in the loadMarkets template literal, keeping the binary branch's original expression byte-identical inside the new branch structure"

key-files:
  created: []
  modified:
    - public/admin.html
    - public/js/admin.js
    - public/css/style.css

key-decisions:
  - "Fieldset visibility toggled via inline style.display ('contents' for the visible one, 'none' for the other two) rather than a CSS class — 'contents' makes each fieldset wrapper's .field children participate directly in the parent .grid-2 grid, so the binary fieldset renders pixel-identical to the pre-Phase-3 markup (no wrapper-introduced layout shift) while still allowing exactly one fieldset to be shown/hidden as a unit."
  - "Multiple-choice option rows are re-seeded to the 2-row floor only when #optionsList is empty (first selection), not on every toggle back to multiple_choice — preserves any rows the admin already filled in if they toggle away and back, while still satisfying the UI-SPEC's 'selecting multiple_choice seeds 2 empty rows' requirement for the initial case."
  - "oddsCell()/resultLabel()/actionsCell() binary branches use the exact original expressions (m.odds_yes.toFixed(2), m.outcome ternary, the two-button data-resolve markup) rather than a shared/generalized code path, honoring the UI-SPEC's explicit regression-guard instruction not to let one shared template change binary's markup as a side effect of generalizing the other types."
  - "Non-binary resolve wiring uses its own querySelectorAll('[data-resolve-multi]') listener block, entirely separate from the binary [data-resolve] delegation loop — different payload shape (winning_option_id vs outcome), so no shared handler was forced across the two."

patterns-established:
  - "New market-type-aware render helpers live above loadMarkets() and are pure functions of a market row (m) — any future market-type addition extends these switch/if branches without touching the row-rendering template literal itself."

requirements-completed: [MARKET-01, MARKET-02, MARKET-03, MARKET-08]

coverage:
  - id: D1
    description: "Admin creation form has #mMarketType selector; changing it shows exactly one of the binary/over_under/multiple_choice fieldsets and hides the other two"
    requirement: "MARKET-08"
    verification:
      - kind: unit
        ref: "node -e module-shape assertion (mMarketType/mThreshold/mOddsOver/mOddsUnder/options-list/addOptionBtn present in admin.html; odd-btn.option/odds-row.multi/options-list/option-row/resolve-select present in style.css) — plan Task 1 verify block"
        status: pass
      - kind: other
        ref: "node --check public/js/admin.js (syntax) + node -e regex assertion (mMarketType/over_under/multiple_choice/winning_option_id/addOptionBtn/showToast(err.message present in admin.js) — plan Task 2 verify block"
        status: pass
      - kind: automated_ui
        ref: "No live browser/DOM harness in this sandbox — fieldset toggle, option-row add/remove, and submit-payload branching were verified by static source review only, not by driving a real DOM"
        status: unknown
    human_judgment: true
    rationale: "No browser automation (Playwright/Puppeteer/jsdom) exists in this repo's toolchain to click through the form and assert the fieldset show/hide, option-row add/remove-at-floor, and submit-payload branching end-to-end. Source was verified via node --check, regex/structural assertions, and manual re-reading against the diff, but a human should click through the admin panel once to confirm the toggle/option-row/submit UX behaves as UI-SPEC describes."
  - id: D2
    description: "Over/Under fieldset has exactly 3 inputs (#mThreshold, #mOddsOver, #mOddsUnder) with the .5-increment hint text; submit sends market_type:'over_under', threshold, odds_over, odds_under"
    requirement: "MARKET-01"
    verification:
      - kind: unit
        ref: "node -e structural assertion on admin.html/admin.js (Task 1/2 verify blocks)"
        status: pass
      - kind: automated_ui
        ref: "No browser harness — payload construction verified by source review of the over_under branch in the submit handler"
        status: unknown
    human_judgment: true
    rationale: "Same no-browser-automation constraint as D1 — payload shape is correct by source inspection but unexercised against a live form submission."
  - id: D3
    description: "Multiple-choice fieldset lets the admin add/remove option rows, floored at 2 (remove button disabled) and capped at 20 (add button disabled); submit sends market_type:'multiple_choice', options:[{label,odds}]"
    requirement: "MARKET-02"
    verification:
      - kind: unit
        ref: "node -e structural assertion (addOptionBtn/options-list present) — Task 1/2 verify blocks"
        status: pass
      - kind: automated_ui
        ref: "No browser harness — floor/ceiling disable logic (updateOptionRowControls) verified by source review only"
        status: unknown
    human_judgment: true
    rationale: "Same no-browser-automation constraint as D1 — the 2/20 bound logic is implemented and structurally correct, client-side only per MARKET-05 (server remains sole enforcement point, already proven in 03-03), but unexercised end-to-end."
  - id: D4
    description: "Binary creation form and binary market row/resolve buttons render pixel-identical to pre-Phase-3: #mOddsYes/#mOddsNo inputs unchanged, odds cell/result label/two-button resolve path use the exact original expressions"
    requirement: "MARKET-03"
    verification:
      - kind: unit
        ref: "git diff public/admin.html / public/js/admin.js / public/css/style.css manually reviewed: #mOddsYes/#mOddsNo attributes byte-identical (only wrapped in a new div), .odd-btn/.odds-row/.odd-btn.sim/.odd-btn.nao CSS rules unedited (confirmed via git diff showing no deletions in that block), oddsCell()'s binary branch returns the exact original template-literal expression, actionsCell()'s binary branch returns the exact original two-button markup, [data-resolve] delegation loop untouched"
        status: pass
    human_judgment: false
  - id: D5
    description: "Admin market list shows a Tipo column and a non-crashing odds cell for all market types (no .toFixed() TypeError on non-binary rows); non-binary markets resolve via a winning-option select + Resolver button posting { winning_option_id }"
    requirement: "MARKET-08"
    verification:
      - kind: unit
        ref: "node -e structural assertion (winning_option_id string present in admin.js) — Task 2 verify block; source review of oddsCell()/resultLabel()/actionsCell() branches for over_under/multiple_choice"
        status: pass
      - kind: automated_ui
        ref: "No browser harness / no live Postgres in this sandbox (carried-forward blocker) — end-to-end create-then-list-then-resolve flow for a real over_under/multiple_choice market is unexercised"
        status: unknown
    human_judgment: true
    rationale: "Same carried-forward no-test-DB / no-browser-automation blocker as every prior Phase 3 plan (STATE.md). Logic is structurally correct and consistent with the 03-03/03-05 backend contracts (verified by direct comparison against those SUMMARYs' documented payload/response shapes), but a genuine end-to-end signal (real market creation → list render → resolve) requires a human with DB + browser access."

duration: 12min
completed: 2026-07-15
status: complete
---

# Phase 03 Plan 06: Admin Panel UI for New Market Types Summary

**Admin creation form gets a market-type selector toggling binary/Over-Under/multiple-choice fieldsets (display:contents-based, grid-2-preserving), a dynamic 2-20-bounded option-row builder, and the admin market list gets a Tipo column plus a type-aware odds/result/resolve-control render path — all additive, with the binary form/list/resolve UI left byte-identical.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-15T03:35:00Z (approx)
- **Completed:** 2026-07-15T03:47:38Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `#mMarketType` select (binary default, over_under, multiple_choice) added to `#newMarketForm`, toggling exactly one of three `.market-type-fieldset` wrappers via `style.display = 'contents' | 'none'` — `'contents'` makes the wrapper transparent to the parent `.grid-2` layout, so the visible fieldset's `.field` children lay out identically to the pre-Phase-3 form with no wrapper-introduced spacing shift.
- Binary fieldset wraps the existing `#mOddsYes`/`#mOddsNo` inputs completely unchanged (same id/type/step/min/value/required attributes) — only a new parent `<div>` was introduced, satisfying the MARKET-03 hard rule.
- Over/Under fieldset: `#mThreshold` (number, step 0.5, min 0.5), `#mOddsOver`, `#mOddsUnder` (both step 0.01, min 1.01, identical to the binary odds inputs) plus the ".5 increment" hint paragraph.
- Multiple-choice fieldset: `#optionsList` (`.options-list`) + `#addOptionBtn` + "Mínimo 2, máximo 20 opções." helper text. Rows are DOM elements (`.option-row`: text label input + odds number input + `.remove-option` button carrying `aria-label="Remover opção"`), created/removed at runtime — `#addOptionBtn` disables at 20 rows, each remove button disables when exactly 2 rows remain.
- Submit handler branches the POST body on `#mMarketType`'s value: binary keeps `{ odds_yes, odds_no }` verbatim (no `market_type` field sent, preserving the server's existing default-to-binary contract); over_under sends `{ market_type:'over_under', threshold, odds_over, odds_under }`; multiple_choice sends `{ market_type:'multiple_choice', options:[{label,odds},...] }` collected from the `.option-row` DOM. The existing `try { Api.post... } / showToast(err.message,'error')` structure is reused verbatim for all three branches — server errors surface as-is.
- `loadMarkets()`'s odds cell — the exact line RESEARCH.md/03-PATTERNS.md flagged as throwing `TypeError` on `.toFixed()` for non-binary markets — replaced with a small `oddsCell(m)` helper: binary branch returns the original `m.odds_yes.toFixed(2)x / m.odds_no.toFixed(2)x` expression unchanged; over_under renders `"Over {threshold}: {oddsOver}x / Under {threshold}: {oddsUnder}x"`; multiple_choice renders a comma-joined, `escapeHtml`-safe `"{label} {odds}x"` list.
- New `typeLabel(m.market_type)` renders a `.tag`-styled "Tipo" column (binary/Over-Under/Múltipla escolha) inserted after Pergunta; table header and empty-state `colspan` updated from 6 to 7 columns.
- `resultLabel(m)` and `actionsCell(m)` helpers branch the same way: binary keeps the exact original outcome ternary and two-button `data-resolve`/`data-outcome` markup + its existing event-delegation loop, completely untouched; non-binary markets get a `.resolve-select` (populated from `m.options[]`, values are option ids, labels escaped) + single "Resolver" ghost button, wired through its own `[data-resolve-multi]` listener block that posts `{ winning_option_id }` to `PUT /markets/:id/resolve` — matching the 03-05 controller/service contract exactly.
- Additive-only CSS appended to `public/css/style.css`: `.options-list`, `.option-row` (+ its two input styles and `.remove-option` destructive coloring), `.odd-btn.option .value` (neutral `var(--text)` per UI-SPEC's color-budget rule), `.odds-row.multi` + `.odds-row.multi .odd-btn.option`, and `.resolve-select`. Confirmed via `git diff` that no line inside the existing `.odd-btn`/`.odds-row`/`.odd-btn.sim`/`.odd-btn.nao` block was touched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add market-type selector, Over/Under + multiple-choice fieldsets to admin.html; add additive CSS** - `ae5dd24` (feat)
2. **Task 2: Branch admin.js — type-toggle, dynamic option rows, submit payload, odds cell, resolve control** - `75ebf6c` (feat)

_No plan-metadata-only commit — final docs/state commit follows this summary._

## Files Created/Modified
- `public/admin.html` - `#mMarketType` select + 3 `.market-type-fieldset` divs (binary wraps unchanged `#mOddsYes`/`#mOddsNo`; over_under adds `#mThreshold`/`#mOddsOver`/`#mOddsUnder`; multiple_choice adds `#optionsList`/`#addOptionBtn`); market list table gains a "Tipo" `<th>`.
- `public/js/admin.js` - Fieldset toggle (`toggleMarketTypeFieldsets`), option-row builder (`createOptionRow`/`updateOptionRowControls`/`seedOptionRows`), branched submit payload, `typeLabel`/`oddsCell`/`resultLabel`/`actionsCell` render helpers, non-binary `[data-resolve-multi]` listener block. Binary submit path, `[data-resolve]` loop, `[data-close]`/`[data-delete-market]` loops untouched.
- `public/css/style.css` - Appended `.options-list`, `.option-row` (+ children), `.odd-btn.option .value`, `.odds-row.multi` (+ child rule), `.resolve-select`. No existing rule edited.

## Decisions Made
- Fieldset show/hide uses `display:contents` (not a wrapper-preserving flex/grid trick or removing-from-DOM) specifically so the binary fieldset's two `.field` children remain direct participants in the parent `.grid-2` grid — this was the only approach found that keeps the binary form's visual layout byte-identical while still allowing a single wrapper element to be toggled as a unit.
- Multiple-choice option rows seed to the 2-row floor only when the list is empty, not on every re-selection of the type — a minor UX judgment call favoring not losing admin-entered data on accidental type-toggle, without contradicting the UI-SPEC's stated initial-seed behavior.
- `oddsCell`/`resultLabel`/`actionsCell` binary branches were written as literal copies of the pre-Phase-3 expressions (not refactored into a shared parametrized helper) to make the MARKET-03 regression guard mechanically verifiable via `git diff`, per the UI-SPEC's explicit warning against a single shared code path silently changing binary's markup as a side effect.

## Deviations from Plan

None — plan executed exactly as written under Rules 1-3 (no auto-fixes needed). Both task files (`public/admin.html`, `public/css/style.css`, `public/js/admin.js`) had pre-existing uncommitted modifications from before this plan started (per STATE.md's carried-forward "in-progress work predating this planning session" blocker — e.g. the admin brand rename, `.table-wrap` scroll wrapper, `.topbar nav` flex-wrap, and `parseServerDate`'s ISO-8601 rewrite). These pre-existing changes were already present when each file was read at the start of this plan and were carried through in the task commits as part of the whole-file diff, consistent with how 03-05's SUMMARY handled `marketsController.js`'s similar pre-existing untracked state — not a deviation introduced by this plan's own work, and no source content was altered beyond what Task 1/Task 2 specified.

## Issues Encountered

None. No live Postgres test database and no browser/DOM automation harness (Playwright/Puppeteer/jsdom) exist in this sandbox (carried-forward blocker, STATE.md) — the fieldset toggle, dynamic option-row add/remove-at-floor, submit-payload branching, and non-binary resolve flow were verified via `node --check`, the plan's own structural `node -e` assertions, and manual `git diff` review confirming binary-path byte-identity, but not by driving a real browser against a real backend. See `coverage` D1-D3/D5's `human_judgment: true` entries for the specific end-to-end gaps a human should walk through (create an Over/Under market, create a multiple-choice market with 2/20/21 options, resolve each via the new select+button, confirm the binary form/list/resolve path is visually unchanged).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Admin UI now fully supports creating and resolving all 3 market types (MARKET-08), closing the last piece of Phase 3's stated scope alongside 03-01 through 03-05's backend generalization.
- `public/js/dashboard.js` (end-user ticket rendering, wager submission, `loadMyWagers`/`showUserWagers` choice-label rendering) is UI-SPEC-scoped but out of this plan's `files_modified` — 03-UI-SPEC.md's "Dashboard — Option Rendering Contract" section describes that work; if a plan for it doesn't already exist, it belongs before the Phase 3 gate (03-07) since users otherwise have no way to place wagers on the new types even though the admin can create/resolve them.
- Blocker carried forward unchanged: no live `*test*`-named Postgres database and no browser automation harness reachable in this sandbox. This plan's changes are structurally correct and consistent with the 03-03/03-05 backend contracts by direct comparison, but need real-DB + real-browser execution (human/CI) before the 03-07 phase gate — same limitation as every prior Phase 3 plan.

---
*Phase: 03-new-market-types*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: public/admin.html
- FOUND: public/js/admin.js
- FOUND: public/css/style.css
- FOUND: .planning/phases/03-new-market-types/03-06-SUMMARY.md
- FOUND: ae5dd24 (Task 1 commit)
- FOUND: 75ebf6c (Task 2 commit)
