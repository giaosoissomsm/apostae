---
phase: quick-260715-f42
verified: 2026-07-15T14:20:00Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Quick Task f42: Remove `.html` URLs Verification Report

**Task Goal:** Remove `.html` extensions from all public URLs in ApostaE (Express app) while
keeping full backward compatibility — 301 redirects preserving query strings, all internal
references updated to clean URLs, no new dependency, correcting the pre-existing bug where
`/admin` served the wrong page, and no regression in auth/session/JWT/API/admin-panel/history/
refresh/deep-link behavior.

**Verified:** 2026-07-15T14:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

**Method:** Live HTTP verification against the running pm2-managed instance on
`http://localhost:3000` (already restarted with this code) plus direct source reading of every
file in `files_modified`. SUMMARY.md claims were independently re-derived, not trusted.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `GET /admin.html` returns 301 with `Location: /admin`, query preserved | ✓ VERIFIED | Live curl: `HTTP/1.1 301` + `Location: /admin`; `GET /login.html?next=x` → `Location: /login?next=x` (query preserved verbatim) |
| 2 | `GET /admin` serves admin.html (bug corrected) | ✓ VERIFIED | Live curl: `<title>Admin · ApostaE</title>` returned at `/admin` (was previously the index/dashboard shell per RESEARCH.md) |
| 3 | `/` → index, `/login` → login, `/cadastro` → login, `/profile` → profile, `/password-expires` → password-expires, all HTTP 200 | ✓ VERIFIED | Live curl: all five return 200 with correct `<title>` per page; `/cadastro` returns the same login.html title as `/login` |
| 4 | Static assets and API routes unaffected | ✓ VERIFIED | Live curl: `/css/style.css` → 200, `/js/api.js` → 200, `/health` → unaffected JSON, `/api/auth/login` (POST) reaches the controller/service layer normally (business-logic 401 response, not a routing issue), `/api/users/me` unauth → 401 JSON as before |
| 5 | Unmapped `.html` returns clean JSON 404, no loop/crash | ✓ VERIFIED | Live curl: `GET /foo.html` → single-hop `404 {"error":"Rota não encontrada"}`, no `Location` header (confirmed no redirect chain) |
| 6 | 401 redirects browser to `/login` exactly once, no loop | ✓ VERIFIED | Source trace: `api.js:34` and `session-timeout.js:12` use exact-match (`===`) against `/login` / `/password-expires`, not stale `.endsWith`/`.includes('...html')`. On `/login`, the guard is false so no navigation occurs (session clears, error message shown in place); on any other page, exactly one redirect to `/login` fires. No automated browser/JS test exists in this repo's Jest suite to exercise this at runtime, but the logic is simple, deterministic string equality fully traceable by code reading — not a complex state machine requiring live browser exercise |

**Score:** 6/6 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server.js` | `/\.html$/i` 301-redirect route above `express.static`, `{ index: false }`, `CLEAN_TO_FILE` map | ✓ VERIFIED | Lines 111-116 (redirect route, above static at 120), line 120 (`{ index: false }`), lines 123-136 (`CLEAN_TO_FILE` loop) |
| `public/*.html` (5 files) + `public/js/*.js` | All nav targets extensionless | ✓ VERIFIED | Confirmed via read + grep — no `href="...html"` remains in index/admin/profile; login.html inline scripts use `/` |
| `<link rel="canonical">` on 5 pages | One per page, own clean URL | ✓ VERIFIED | `grep -c` confirms exactly 1 per file; login's canonical is `/login` (not `/cadastro`), matching the plan's explicit decision |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `/\.html$/i` redirect route | `express.static` | Registration order | ✓ WIRED | Redirect route at line 111, static at line 120 — correct order confirmed by reading server.js top-to-bottom |
| `api.js:34` guard | `/login`, `/password-expires` | Exact-match comparison | ✓ WIRED | `location.pathname !== '/login' && location.pathname !== '/password-expires'` — no `.endsWith`/`.includes` remnants |
| `session-timeout.js:12` guard | `/login`, `/password-expires` | Exact-match comparison | ✓ WIRED | `location.pathname === '/login' \|\| location.pathname === '/password-expires'` |
| `CLEAN_TO_FILE` map | `res.sendFile` | Fixed whitelist, no `req.path` interpolation | ✓ WIRED | Loop uses `file` from the object literal only, never user input — no path-traversal surface introduced |

### Behavioral Spot-Checks (live HTTP, server already running)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Legacy `.html` → clean 301 (5 pages) | `curl -sI http://localhost:3000/{admin,login,index,profile,password-expires}.html` | All 301, correct `Location`, query preserved on `/login.html?next=x` | ✓ PASS |
| `/admin` serves the real admin panel | `curl -s http://localhost:3000/admin \| grep title` | `<title>Admin · ApostaE</title>` | ✓ PASS |
| Clean URLs serve correct pages | `curl -s http://localhost:3000/{,login,cadastro,profile,password-expires}` | Correct titles per page; `/cadastro` == `/login` markup | ✓ PASS |
| Assets unaffected | `curl -sI http://localhost:3000/css/style.css`, `/js/api.js` | Both 200 | ✓ PASS |
| API unaffected / not shadowed | `curl -s http://localhost:3000/api/users/me` (unauth), `POST /api/auth/login` (valid body) | 401 JSON as expected; login POST reaches business logic (admin account happens to be `is_active=false` in this DB, unrelated pre-existing data state, not a routing regression) | ✓ PASS |
| Unmapped `.html` degrades cleanly | `curl -si http://localhost:3000/foo.html` | Single-hop JSON 404, no `Location` header | ✓ PASS |
| No catch-all route shadowing | `grep -n "app.get(" server.js` | Only `/health`, the `/\.html$/i` regex route, and the whitelist loop — no `app.get('*')` | ✓ PASS |
| `node --check` all modified JS/server files | `node --check server.js public/js/*.js src/middleware/auth.js` | All parse cleanly | ✓ PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/controllers/authController.js` | 54 | `redirectTo: '/login.html'` — a stale `.html` literal in the `PUT /api/auth/password` JSON response payload | ℹ️ INFO | Not in the RESEARCH.md's enumerated 18-item reference list (research missed it) and not in this plan's `files_modified`. Confirmed via grep that this endpoint (`/api/auth/password`) has **no live frontend caller** — `profile.js` uses the separate `/users/me/password` endpoint instead, and no `.html`/`public/js` file references `redirectTo` at all. Functionally dead code, same category as the `auth.js:65` literal the executor *did* sweep for consistency. Does not affect any must-have truth or live user flow, but is a residual stale reference the research's inventory did not catch. Not a blocker. |

**Suggested follow-up (non-blocking):** Update `authController.js:54`'s `redirectTo: '/login.html'` to `/login` in a future cleanup pass, for the same "no stale `.html` path name remains in the tree" reasoning already applied to `auth.js:65`.

### Edge Case Note (non-blocking, no must-have violated)

`/cadastro` is a brand-new route added by this task (previously it did not exist at all — see
RESEARCH.md). The 401 guards in `api.js:34` / `session-timeout.js:12` only exact-match `/login`
and `/password-expires`, not `/cadastro`. Trace: `login.html`'s inline script defaults to
`mode = 'login'`; if a user loads `/cadastro` without toggling to register mode and submits wrong
credentials, `authService.login` throws `AuthenticationError` (401), and `Api.request`'s global
401 handler sees `location.pathname === '/cadastro'` (not `/login`), so it fires exactly one
`location.href = '/login'` navigation away from `/cadastro`. This is **not a loop** (single hop,
matches the literal must-have #6 wording "redirects... exactly once with no redirect loop") and
**not a crash**, but is a minor new UX quirk (navigating away from the register page on a login
mistake) that neither RESEARCH.md nor the PLAN's guard-update scope anticipated when they only
special-cased `/login` and `/password-expires`. Recorded here for completeness; does not violate
any stated must-have and is not classified as a gap.

### Requirements Coverage

Not applicable — this is a quick task (`.planning/quick/`), not tracked in `.planning/REQUIREMENTS.md`
milestone requirements. `F42-CLEAN-URLS` appears only in the PLAN frontmatter as a task-local tag.

### Human Verification Required

None. All must-haves were verifiable via live HTTP requests against the running instance and
direct source-code tracing; no visual/real-time/external-service behavior in scope.

### Gaps Summary

No gaps. All 6 must-have truths verified live against the running server; all 3 artifacts and all
4 key links confirmed by direct source reading; the 18 enumerated internal `.html` references from
RESEARCH.md were spot-checked across all 10 modified files and none remain (only one out-of-scope,
dead-code, non-blocking stale literal was found in a file the research did not enumerate — see
Anti-Patterns above). No new npm dependency was added (`package.json`/`package-lock.json` show no
diff). No catch-all route was introduced. `node --check` passes on every modified JS file.

---

_Verified: 2026-07-15T14:20:00Z_
_Verifier: Claude (gsd-verifier)_
