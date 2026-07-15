# Quick Task f42: Remove `.html` from public URLs — Research

**Researched:** 2026-07-15
**Domain:** Express 4 static/routing, client-side navigation, HTTP 301 redirects
**Confidence:** HIGH (codebase fully inspected; no external deps involved)

## Summary

ApostaE is **not** a true SPA — it is a multi-page app. Each page is a standalone
`public/*.html` file with its own `<script>` set. The `app.get(['/', '/dashboard', '/admin', '/profile'])`
route in `server.js:100` is misleading SPA-leftover: it sends `index.html` for those paths, but
real navigation uses hard `.html` URLs (`/admin.html`, `/profile.html`, `/index.html`, `/login.html`)
which are served directly by `express.static` (`server.js:97`) — which runs **before** that route.
So today `/admin` actually serves the dashboard shell, while the admin panel is only reachable at
`/admin.html`. This quirk must be corrected, not preserved.

**Primary recommendation:** Add ONE redirect middleware *before* `express.static` that 301s any
`*.html` path to its clean equivalent (carrying the query string), keep `express.static` for assets,
and replace the vestigial SPA route with an explicit clean-URL → `sendFile` map. Then rewrite ~18
internal `.html` references across 6 files. No new npm package — Express built-ins are sufficient
(`express-rate-limit`, `joi` etc. already present; no clean-url middleware installed, and none needed).

## Current State Map

### Every `public/*.html` file, how it is reached today

| File | Served today at | New clean URL | Notes |
|------|-----------------|---------------|-------|
| `index.html` | `/index.html` (static) and `/`, `/dashboard`, `/admin`, `/profile` (SPA route `server.js:100`) | `/` | Dashboard w/ tabs (markets/mine/ranking) |
| `login.html` | `/login.html` (static) | `/login` | Also contains the **register** toggle (no separate page) |
| `admin.html` | `/admin.html` (static) | `/admin` | Real admin panel. NOTE: `/admin` today wrongly serves `index.html` |
| `profile.html` | `/profile.html` (static) | `/profile` | Change-password page |
| `password-expires.html` | `/password-expires.html` (static) | `/password-expires` | Forced password change |

**No `cadastro.html` / `register.html` exists.** Registration is an in-page mode toggle inside
`login.html` (`switchBtn`, lines 51–67). **[DECISION NEEDED]** `/cadastro` must therefore serve
`login.html`. Two clean URLs (`/login`, `/cadastro`) will serve the same shell → set a `<link rel="canonical">`
to `/login` on that page to avoid duplicate-content, or optionally have `/cadastro` preselect register mode.

**Assets (must keep working unchanged):** `/css/style.css`, `/js/*.js`. No `favicon`, `manifest`,
`robots.txt`, or `sitemap.xml` exist in `public/` — the SEO requirement for those is net-new/optional.

### Every internal `.html` reference (file:line → change)

**HTML `href` attributes:**
- `index.html:18` `/admin.html` → `/admin`
- `index.html:19` `/profile.html` → `/profile`
- `admin.html:15` `/index.html` → `/`
- `admin.html:16` `/profile.html` → `/profile`
- `profile.html:15` `/index.html` → `/`
- `profile.html:16` `/admin.html` → `/admin`
- `profile.html:17` `/profile.html` → `/profile`

**Inline `<script>` navigation:**
- `login.html:49` `location.href = '/index.html'` → `/`
- `login.html:80` `location.href = '/index.html'` → `/`

**`public/js/api.js`:**
- `api.js:34` guard `!location.pathname.endsWith('login.html')` → `!location.pathname.endsWith('/login')` (⚠ see Pitfall 2)
- `api.js:34` guard `.endsWith('password-expires.html')` → `.endsWith('/password-expires')`
- `api.js:35` `location.href = '/login.html'` → `/login`
- `api.js:42` `location.href = '/password-expires.html'` → `/password-expires`
- `api.js:65` `location.href = '/login.html'` → `/login`
- `api.js:81` `location.href = '/index.html'` → `/`
- `api.js:108` `location.href = '/login.html'` → `/login`

**`public/js/session-timeout.js`:**
- `session-timeout.js:12` `location.pathname.includes('login.html')` → `location.pathname === '/login'` (or `.endsWith('/login')`); and `.includes('password-expires.html')` → `/password-expires` (⚠ Pitfall 2)

**`public/js/password-expires.js`:**
- `password-expires.js:6` `location.href = '/index.html'` → `/`
- `password-expires.js:37` `location.href = '/login.html'` → `/login`

**`public/js/dashboard.js`, `public/js/admin.js`:** grep-confirmed **no** `.html` references.

**Server-side reference:**
- `src/middleware/auth.js:65` checks `req.path === '/password-expires.html'`. `requireAuth` is only
  mounted on `/api/*` routers, so `req.path` is never a page path here — this branch is effectively
  dead. Update the literal to `/password-expires` for consistency, but it changes no behavior.

### How 401 → login works today (server vs client)

- **Server:** `src/middleware/auth.js` returns JSON `401`/`403` (`auth.js:102`, `:68`). It **never**
  issues an HTTP redirect to a login page. The CLAUDE.md note "login.html served on 401 by backend"
  is inaccurate — redirect-to-login is purely client-side.
- **Client:** `api.js:31-44` handles it: on `401` it clears the session and sets
  `location.href = '/login.html'` (unless already on login/password-expires page); on `403` with
  `password_expires_next_login` it goes to `/password-expires.html`. These are the redirects to
  repoint at `/login` and `/password-expires`.

### `/admin` page protection today

There is **no server-side gate on the admin HTML shell** — `admin.html` is a public static file.
Protection is client-side: `admin.js`/`requireAdminPage()` (`api.js:73-90`) fetches the user, checks
`user.roleId === 2`, and redirects non-admins to `/index.html`. The admin **API** is separately
guarded by `requireAdmin` (`auth.js:151`). Serving `/admin`'s shell is orthogonal to API authorization
— **preserve the client-side check exactly**; only its redirect target changes (`/index.html` → `/`).

## Recommended Implementation

No new dependency (Express `res.redirect` + `express.static` + `res.sendFile` suffice). Order in `server.js`:

```js
// 1) BEFORE express.static — 301 any legacy *.html to its clean URL (keeps ?query)
const HTML_TO_CLEAN = {
  '/index.html': '/',
  '/login.html': '/login',
  '/admin.html': '/admin',
  '/profile.html': '/profile',
  '/password-expires.html': '/password-expires',
};
app.get(/\.html$/i, (req, res, next) => {
  const target = HTML_TO_CLEAN[req.path];
  if (!target) return next();               // unknown .html → 404 downstream
  const qs = req.originalUrl.slice(req.path.length); // preserves ?query verbatim
  res.redirect(301, target + qs);
});

// 2) Static assets (css/js/images). index:false so it never emits /index.html itself.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// 3) Clean-URL page map (replaces the old SPA app.get on line 100)
const CLEAN_TO_FILE = {
  '/': 'index.html',
  '/login': 'login.html',
  '/cadastro': 'login.html',            // register is a toggle inside login.html
  '/admin': 'admin.html',
  '/profile': 'profile.html',
  '/password-expires': 'password-expires.html',
};
for (const [route, file] of Object.entries(CLEAN_TO_FILE)) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
}
```

- The `/\.html$/i` regex route must sit **above** `express.static`, otherwise static serves the
  `.html` with a 200 and the redirect never fires.
- `{ index: false }` prevents `express.static` from auto-serving `index.html` at `/`; the explicit
  `/` route owns that instead (single source of truth, avoids a `/` vs `/index.html` split).
- Query string: `req.originalUrl.slice(req.path.length)` yields `?a=b` (or `''`). `res.redirect`
  emits it in `Location`. **Hash `#…` is never sent to the server** (browser-only) — no server code
  can or needs to touch it; the browser re-appends the original hash after following the 301. State
  this explicitly in the plan; the requirement "preserve `#`" is satisfied automatically, not by code.

## Don't Hand-Roll

| Problem | Don't build | Use instead |
|---------|-------------|-------------|
| Path traversal / directory listing safety | Custom file resolver from `req.path` | `express.static` (no dir listing by default; blocks `../`) + a fixed `CLEAN_TO_FILE` whitelist (never interpolate `req.path` into a filename) |
| Clean-URL rewriting | `connect-history-api-fallback` / clean-url middleware | Explicit route map — 5 pages, no library warranted |
| Query preservation | Re-parsing `req.query` back to a string | `req.originalUrl.slice(req.path.length)` |

## Common Pitfalls

**Pitfall 1 — Route ordering / asset shadowing.** The `.html` redirect must precede `express.static`;
the clean-URL page routes must follow it. Because page routes are an explicit whitelist (not a
`app.get('*')` catch-all), they cannot swallow `/css/*`, `/js/*`, `/api/*`, or `/health`. Do **not**
introduce a catch-all page route — it would shadow real assets and the API 404 handler.

**Pitfall 2 — Broken login-page guards → redirect loop.** `api.js:34` and `session-timeout.js:12`
detect "am I on the login page?" via `pathname.endsWith('login.html')` / `.includes('login.html')`.
After the switch the path is `/login` (no `.html`), so these guards silently return `false`, and a
`401` on the login page would redirect `/login` → `/login` repeatedly. **Must** update both guards to
match the new paths (`=== '/login'`, `=== '/password-expires'`). This is the single highest-risk item.

**Pitfall 3 — Redirect loop between steps 1 and 3.** Only `.html` paths redirect (step 1); clean
paths `sendFile` a 200 (step 3). Since step 1 targets are clean URLs that never match `/\.html$/`,
no loop is possible. Verify no clean route value accidentally ends in `.html`.

**Pitfall 4 — `/cadastro` duplicate content.** `/login` and `/cadastro` serve identical HTML. Add
`<link rel="canonical" href="/login">` (or resolve which is canonical) to keep SEO clean.

**Pitfall 5 — auth.js:65 dead literal.** Harmless but update `/password-expires.html` → `/password-expires`
so no stale `.html` path names remain in the tree.

## SEO (optional / net-new, confirm scope)

- No `<link rel="canonical">` tags exist today — add one per page pointing at its clean URL.
- No `robots.txt` / `sitemap.xml` exist — creating them is net-new work beyond the redirect task;
  confirm whether in scope for this quick task.
- 301 (permanent) is correct per requirement; the map above uses `res.redirect(301, …)`.

## Verification Checklist (for the plan)

- `curl -sI http://localhost:3000/admin.html` → `301` + `Location: /admin`
- `curl -sI 'http://localhost:3000/login.html?next=x'` → `Location: /login?next=x` (query kept)
- `curl -s http://localhost:3000/admin` → serves `admin.html` (not the dashboard as today)
- `curl -sI http://localhost:3000/css/style.css` → `200` (asset unaffected)
- `curl -sI http://localhost:3000/api/health` unaffected; unknown `/foo.html` → JSON 404
- Manual: login flow, 401 auto-redirect to `/login` (no loop), admin non-admin bounce to `/`,
  password-expires flow, F5 on each clean URL, deep link to `/profile`.

## Assumptions Log

| # | Claim | Risk if wrong |
|---|-------|---------------|
| A1 | `/cadastro` should serve `login.html` (no dedicated registration page exists) | If owner expects a separate page, a new HTML file is needed — small scope add |
| A2 | robots.txt/sitemap.xml/canonical are optional net-new, not blocking the redirect task | If mandatory, adds file-creation subtasks |
| A3 | Dev server listens on port 3000 (env `PORT`) — verify `.env` before curl checks | Only affects verification commands |

## Sources

- Codebase (HIGH): `server.js`, `src/middleware/auth.js`, all `public/*.html`, all `public/js/*.js`, `package.json` — read/grepped this session.
- Express `res.redirect` / `express.static` behavior (query preservation, no dir-listing, index option): Express 4 built-in [ASSUMED from training, stable API].
