# Phase 3: New Market Types - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 12
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/migrations/005_market_types.js` | migration | batch/DDL | `src/migrations/004_cashout.js` | exact |
| `src/repositories/marketOptionRepository.js` (new) | repository | CRUD | `src/repositories/wagerRepository.js` (IDOR lock pattern) + `src/repositories/marketRepository.js` (create/findAll shape) | role-match |
| `src/repositories/marketRepository.js` (modified: `findAll`, `create`) | repository | CRUD | itself (current file) | exact |
| `src/repositories/wagerRepository.js` (modified: `SELECT_WITH_MARKET`, `create`) | repository | CRUD | itself (current file) | exact |
| `src/services/marketService.js` (modified: `createMarket`, `resolveMarket`) | service | request-response / CRUD | itself (current file) | exact |
| `src/services/wagerService.js` (modified: `placeWager`) | service | request-response | itself (current file) | exact |
| `src/controllers/marketsController.js` (modified: `createMarket`, `resolveMarket` passthrough) | controller | request-response | itself (current file) | exact |
| `src/controllers/wagersController.js` (modified: `placeWager` passthrough) | controller | request-response | `src/controllers/marketsController.js` (destructure-only convention) | role-match |
| `public/js/admin.js` (modified: `newMarketForm` handler, `loadMarkets` render, resolve controls) | component (vanilla JS render) | request-response | itself (current file) | exact |
| `public/js/dashboard.js` (modified: `ticketTemplate`, `renderMarkets`, `loadMyWagers`, `showUserWagers`) | component (vanilla JS render) | request-response | itself (current file) | exact |
| `public/admin.html` (modified: market-type select + 3 fieldsets) | component (static markup) | — | existing `#newMarketForm` block | exact |
| `public/css/style.css` (additive: `.options-list`, `.option-row`, `.odd-btn.option`, `.odds-row.multi`, `.resolve-select`) | config/style | — | existing `.odd-btn`, `.odds-row`, `.inline-form`, `.field select` rules | role-match |

## Pattern Assignments

### `src/migrations/005_market_types.js` (migration)

**Analog:** `src/migrations/004_cashout.js`

**Exact module shape to copy** (`src/migrations/004_cashout.js:1-42`):
```javascript
const migrations = [
  `CREATE TABLE IF NOT EXISTS wager_cashouts ( ... );
   CREATE INDEX IF NOT EXISTS idx_wager_cashouts_wager_id ON wager_cashouts(wager_id);`,
  `ALTER TABLE wagers ADD COLUMN IF NOT EXISTS cashed_out_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;`,
];

module.exports = {
  id: '004_cashout',
  up: migrations,
  down: [
    'ALTER TABLE wagers DROP COLUMN IF EXISTS cashed_out_amount;',
    'DROP TABLE IF EXISTS wager_cashouts;',
  ],
};
```
Copy this exact shape for `005_market_types.js`: array of SQL strings in `up` (each entry prefixed with a Portuguese comment explaining the business reason, matching 004's style), `id: '005_market_types'`, and `down` as the **exact reverse order** of `up`. RESEARCH.md's Code Examples section already has the full drafted SQL (`market_type`, `threshold`, `market_options` table, `winning_option_id`, `wagers.option_id` + XOR CHECK) — use it verbatim, it was checked against this exact analog.

**Migration runner convention:** confirm how migrations are registered/ordered (likely an index array in `scripts/migrate.js` or a directory scan) before assuming `005_market_types.js` is auto-picked up — check how `004_cashout.js` got wired in.

---

### `src/repositories/marketOptionRepository.js` (NEW file)

**Analog 1 (IDOR-safe lock pattern):** `src/repositories/wagerRepository.js:40-46`
```javascript
// findByIdForUpdate — ownership baked into WHERE, not checked after the fact
async findByIdForUpdate(id, marketId, userId, client) {
  const result = await client.query(
    'SELECT * FROM wagers WHERE id = $1 AND market_id = $2 AND user_id = $3 FOR UPDATE;',
    [id, marketId, userId]
  );
  return result.rows[0] || null;
}
```
Use this exact shape (drop `userId`, since options aren't user-owned, just market-owned) for `findByIdForMarket(id, marketId, client)` — RESEARCH.md Pattern 1 already gives the target implementation:
```javascript
async findByIdForMarket(id, marketId, client) {
  const runner = client || { query: require('../config/database').query };
  const result = await runner.query(
    'SELECT * FROM market_options WHERE id = $1 AND market_id = $2 FOR UPDATE;',
    [id, marketId]
  );
  return result.rows[0] || null;
}
```

**Analog 2 (class/export shape):** `src/repositories/marketRepository.js:1-3,71-73`
```javascript
const { query } = require('../config/database');

class MarketRepository {
  // ...
}

module.exports = new MarketRepository();
```
Copy this singleton-class-instance export pattern exactly. Add methods: `findByMarketId(marketId)` (plain read, no lock, used by `findAll`'s alternative single-market fetch if needed), `createMany(marketId, options[], client)` (bulk parameterized INSERT — see Don't-Hand-Roll note below), `findByIdForMarket` (above).

**Bulk insert pattern — no existing multi-row INSERT precedent in this codebase.** Build parameterized `INSERT INTO market_options (market_id, label, odds, sort_order) VALUES ($1,$2,$3,$4), ($5,$6,$7,$8), ...` by generating placeholders programmatically from the options array — never string-concatenate labels (Security Domain: SQL injection via option labels, RESEARCH.md line ~494). Follow the same `client.query(...)` + `RETURNING *` convention used everywhere else in this file.

---

### `src/repositories/marketRepository.js` (MODIFIED: `findAll`, `create`)

**Current `findAll`** (`src/repositories/marketRepository.js:4-7`):
```javascript
async findAll() {
  const result = await query('SELECT * FROM markets ORDER BY created_at DESC;');
  return result.rows;
}
```
Replace the query with RESEARCH.md's Pattern 3 `json_agg`/`LEFT JOIN`/`GROUP BY` aggregation (already drafted, N+1-safe) — keep the method signature and `return result.rows;` unchanged; only the SQL string changes.

**Current `create`** (`src/repositories/marketRepository.js:15-23`):
```javascript
async create({ question, description, oddsYes, oddsNo, closesAt, revealAt, scheduledOutcome, createdBy }) {
  const result = await query(
    `INSERT INTO markets (question, description, odds_yes, odds_no, status, closes_at, reveal_at, scheduled_outcome, created_by)
     VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8)
     RETURNING *;`,
    [question, description || '', oddsYes, oddsNo, closesAt, revealAt, scheduledOutcome, createdBy]
  );
  return result.rows[0];
}
```
Generalize by adding `marketType` (default `'binary'`) and `threshold` (nullable) to both the destructured params and the INSERT column list — keep `oddsYes`/`oddsNo` nullable-safe (pass `null` for non-binary types) so the existing binary INSERT path stays byte-identical when `marketType === 'binary'`. This method must now accept an optional `client` param (it currently doesn't — `marketService.createMarket` will need to run `create market` + `createMany options` inside one `transaction()`, matching the existing pattern in `resolveMarket`/`deleteMarket` at `src/services/marketService.js:117,208`).

---

### `src/repositories/wagerRepository.js` (MODIFIED: `SELECT_WITH_MARKET`, `create`)

**Current** (`src/repositories/wagerRepository.js:3-9, 12-20`):
```javascript
const SELECT_WITH_MARKET = `
  SELECT w.id, w.user_id, w.market_id, w.choice, w.amount, w.odds_at_time, w.potential_payout,
         w.status, w.created_at, w.resolved_at,
         m.question, m.status AS market_status, m.outcome AS market_outcome
  FROM wagers w
  JOIN markets m ON m.id = w.market_id
`;

async create({ userId, marketId, choice, amount, oddsAtTime, potentialPayout }, client) {
  const result = await client.query(
    `INSERT INTO wagers (user_id, market_id, choice, amount, odds_at_time, potential_payout, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING *;`,
    [userId, marketId, choice, amount, oddsAtTime, potentialPayout]
  );
  return result.rows[0];
}
```
Apply RESEARCH.md's already-drafted extension for `SELECT_WITH_MARKET` (adds `w.option_id`, `m.market_type`, `mo.label AS option_label` via `LEFT JOIN market_options mo ON mo.id = w.option_id`). For `create`, add `optionId` to the destructure and INSERT column list (`choice` becomes nullable — pass `null` when placing a non-binary wager, matching the DB XOR CHECK). Do not touch `findPendingByMarket`, `findByIdForUpdate`, `updateStatus`, `incrementCashedOutAmount` — those are market-type-agnostic already (operate on `wager.id`/`amount`/`cashed_out_amount`, never `choice`).

---

### `src/services/marketService.js` (MODIFIED: `createMarket`, `resolveMarket`)

**Current `createMarket`** (`src/services/marketService.js:62-87`):
```javascript
async createMarket(body, adminId) {
  const { question, description, odds_yes, odds_no } = body || {};

  if (typeof question !== 'string' || question.trim().length < 4) {
    throw new ValidationError('A pergunta precisa ter ao menos 4 caracteres.');
  }
  if (!isValidOdds(Number(odds_yes)) || !isValidOdds(Number(odds_no))) {
    throw new ValidationError('Odds inválidas. Use valores entre 1.01 e 1000.');
  }

  const { closesAt, revealAt, scheduledOutcome } = parseSchedule(body);

  const market = await marketRepository.create({
    question: question.trim(),
    description: (description || '').toString().trim(),
    oddsYes: Number(odds_yes),
    oddsNo: Number(odds_no),
    closesAt, revealAt, scheduledOutcome,
    createdBy: adminId,
  });

  logger.info(`Admin ${adminId} criou o mercado #${market.id}`);
  return market;
}
```
Generalize by branching on `body.market_type` (default `'binary'` if absent, preserving today's implicit contract for any caller that doesn't send it — MARKET-03): keep the `isValidOdds`/`question` checks exactly as-is for the binary branch; add `over_under` (validate `threshold` is `Number.isFinite && > 0`, build 2 `market_options` rows) and `multiple_choice` (validate 2..MAX options — reuse `isValidOdds` per-option, dedupe labels case-insensitive-trim) branches per RESEARCH.md's Architecture Diagram "ADMIN CREATES MARKET". Wrap the market INSERT + options bulk-insert in one `transaction()` (new — `createMarket` doesn't use one today; follow the `transaction(async (client) => {...})` shape already used in `resolveMarket`/`deleteMarket` at lines 117/208 of this same file, and pass `client` through to both `marketRepository.create` and `marketOptionRepository.createMany`).

**Current win/loss check in `resolveMarket`** (`src/services/marketService.js:130-169`, the ONLY generalization point per RESEARCH.md Pattern 2):
```javascript
for (const wager of pendingWagers) {
  if (wager.choice === outcome) {
    await wagerRepository.updateStatus(wager.id, 'won', client);
    // ... remainingFraction / money.multiply / wallet credit — UNCHANGED, do not touch ...
  } else {
    await wagerRepository.updateStatus(wager.id, 'lost', client);
    // ... UNCHANGED ...
  }
}
```
Change ONLY the condition: `const isWinner = market.market_type === 'binary' ? wager.choice === outcome : wager.option_id === winningOptionId; if (isWinner) { ... } else { ... }`. Everything inside both branches (the `money.multiply`/wallet/audit code) must remain character-for-character identical — this is the explicit anti-pattern warning from Phase 2's CR-01/02/03 double-pay bugs (RESEARCH.md Anti-Patterns section). The market-write line (`marketRepository.resolve(marketId, outcome, client)` at line 123) needs its own branch: binary keeps calling `.resolve()` unchanged; new types need a new repository method (e.g. `marketRepository.resolveWithOption(marketId, winningOptionId, client)`) that also validates the option belongs to the market via `marketOptionRepository.findByIdForMarket` (Pattern 1, MARKET-06) before writing `winning_option_id`.

**Label-not-id in the emitted event** (RESEARCH.md Pitfall 5) — at `domainEvents.emit('market.resolved', { marketId, question, outcome, recipients })` (line 178): for non-binary types, resolve `outcome` to the winning option's `label` string (already available from the IDOR-safe lookup) before emitting; for binary, keep emitting the exact same raw `'yes'`/`'no'` value unchanged.

---

### `src/services/wagerService.js` (MODIFIED: `placeWager`)

**Current** (`src/services/wagerService.js:15-47`):
```javascript
async placeWager(userId, { market_id, choice, amount }) {
  const marketId = Number(market_id);
  const wagerAmount = Number(amount);

  if (!Number.isFinite(marketId)) throw new ValidationError('market_id inválido.');
  if (choice !== 'yes' && choice !== 'no') throw new ValidationError("choice precisa ser 'yes' ou 'no'.");
  if (!Number.isFinite(wagerAmount) || wagerAmount <= 0) {
    throw new ValidationError('Valor da aposta precisa ser maior que zero.');
  }

  const wager = await transaction(async (client) => {
    const marketResult = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [marketId]);
    const market = marketResult.rows[0];
    if (!market) throw new NotFoundError('Mercado não encontrado.');
    if (market.status !== 'open') throw new ConflictError('Esse mercado não está mais aberto para apostas.');
    if (market.closes_at && new Date(market.closes_at) <= new Date()) {
      throw new ConflictError('O prazo pra apostar nesse mercado já acabou.');
    }

    const odds = choice === 'yes' ? Number(market.odds_yes) : Number(market.odds_no);
    const potentialPayout = Math.round(wagerAmount * odds * 100) / 100;

    const createdWager = await wagerRepository.create(
      { userId, marketId, choice, amount: wagerAmount, oddsAtTime: odds, potentialPayout },
      client
    );
    // ... wallet debit + audit, UNCHANGED ...
    return createdWager;
  });
  // ...
}
```
Accept `option_id` alongside `choice`/`amount` in the destructure. Move the `choice !== 'yes' && choice !== 'no'` check inside a `market.market_type === 'binary'` branch (it needs `market` loaded first, which currently happens after the check — reorder per RESEARCH.md's drafted `wagerService.placeWager` generalization example). For non-binary: `Number(option_id)` validated finite, then `marketOptionRepository.findByIdForMarket(optionId, marketId, client)` (Pattern 1/MARKET-06) — throw `ValidationError` if null. Replace the pre-existing `Math.round(wagerAmount * odds * 100) / 100` anti-pattern line with `money.multiply(wagerAmount, odds)` while this function is being touched anyway (RESEARCH.md Open Question 3 — recommended, low-risk, same output for binary). Pass `optionId` (nullable) through to `wagerRepository.create`.

---

### `src/controllers/marketsController.js` / `wagersController.js` (MODIFIED, passthrough only)

**Analog:** `src/controllers/marketsController.js:16-19` (existing `createMarket` handler)
```javascript
const createMarket = catchAsync(async (req, res) => {
  const market = await marketService.createMarket(req.body, req.user.id);
  res.status(201).json(market);
});
```
No structural change needed here — `req.body` is already passed through whole to the service (service does the destructuring/validation). This matches the Security Domain rule ("controllers destructure only expected fields... never spread `req.body` into a repository call") — controllers passing the whole body to the *service* is fine and already the convention; it's the service/repository boundary that must destructure explicitly, which `marketService.createMarket` and `wagerService.placeWager` already do and must continue to do for the new `market_type`/`option_id`/`threshold`/`options` fields. `resolveMarket` controller (`src/controllers/marketsController.js:36-39`) needs to also pass through `winning_option_id` from `req.body` alongside `outcome` — same destructure-and-forward shape.

---

### `public/js/admin.js` (MODIFIED: form submit handler, `loadMarkets` render, resolve controls)

**Current form submit** (`public/js/admin.js:40-61`):
```javascript
document.getElementById('newMarketForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    question: document.getElementById('mQuestion').value.trim(),
    description: document.getElementById('mDescription').value.trim(),
    odds_yes: Number(document.getElementById('mOddsYes').value),
    odds_no: Number(document.getElementById('mOddsNo').value),
    closes_at: localToIso(document.getElementById('mClosesAt').value),
    reveal_at: localToIso(document.getElementById('mRevealAt').value),
    scheduled_outcome: document.getElementById('mScheduledOutcome').value || null,
  };
  try {
    await Api.post('/markets', body);
    showToast('Mercado criado!', 'success');
    e.target.reset();
    document.getElementById('mOddsYes').value = '2.00';
    document.getElementById('mOddsNo').value = '1.80';
    loadMarkets();
  } catch (err) {
    showToast(err.message, 'error');
  }
});
```
Branch the `body` construction on `document.getElementById('mMarketType').value` per UI-SPEC's payload contract (binary keeps `odds_yes`/`odds_no`; over_under sends `threshold` + `odds_over`/`odds_under`; multiple_choice sends `options: [{label, odds}, ...]` collected from `.option-row` DOM elements). Keep the `try { Api.post... } catch { showToast(err.message, 'error') }` structure unchanged — this is the codebase's only client error-handling convention and must be reused verbatim (server error messages surface as-is, per UI-SPEC Copywriting Contract).

**Current `loadMarkets` odds cell** (`public/js/admin.js:88`):
```javascript
<td class="mono">${m.odds_yes.toFixed(2)}x / ${m.odds_no.toFixed(2)}x</td>
```
This is the exact line RESEARCH.md Pitfall 4 warns will throw `TypeError` on `.toFixed()` of `undefined` for non-binary markets. Must become a `market_type`-branched template string per UI-SPEC's table contract (binary unchanged; over_under `"Over {threshold}: {oddsOver}x / Under {threshold}: {oddsUnder}x"`; multiple_choice comma-joined `"{label} {odds}x"` per option) — build a small helper function (e.g. `oddsCell(m)`) rather than inlining a 3-way ternary in the template literal, to keep `loadMarkets` readable.

**Current resolve buttons** (`public/js/admin.js:95-98`, `114-121`):
```javascript
${m.status !== 'resolved' ? `
  <button class="btn-ghost" data-resolve="${m.id}" data-outcome="yes">Resolver: Sim</button>
  <button class="btn-ghost" data-resolve="${m.id}" data-outcome="no">Resolver: Não</button>
` : ''}
...
body.querySelectorAll('[data-resolve]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await Api.put(`/markets/${btn.dataset.resolve}/resolve`, { outcome: btn.dataset.outcome });
    loadMarkets();
  });
});
```
Keep this exact two-button/data-attribute/event-delegation pattern for binary markets unchanged (MARKET-03). For non-binary, add the UI-SPEC's `.resolve-select` (populated from `market.options[]`) + single "Resolver" ghost button, wired with its own querySelectorAll block (don't try to force it through the same `[data-resolve]` delegation loop as binary — different payload shape: `{ winning_option_id }` vs `{ outcome }`).

---

### `public/js/dashboard.js` (MODIFIED: `ticketTemplate`, `renderMarkets`, `loadMyWagers`, `showUserWagers`)

**Current `ticketTemplate` odds/buttons block** (`public/js/dashboard.js:94-104`):
```javascript
<div class="odds-row">
  <button class="odd-btn sim ${sel === 'yes' ? 'selected' : ''}" data-choice="yes" ${!isOpen ? 'disabled' : ''}>
    <span class="label">Sim</span>
    <span class="value">${market.odds_yes.toFixed(2)}x</span>
  </button>
  <button class="odd-btn nao ${sel === 'no' ? 'selected' : ''}" data-choice="no" ${!isOpen ? 'disabled' : ''}>
    <span class="label">Não</span>
    <span class="value">${market.odds_no.toFixed(2)}x</span>
  </button>
</div>
```
**Regression guard (MARKET-03):** when `market.market_type === 'binary'` (or field absent — treat as binary for backward compat), this exact block must render unchanged, byte-for-byte, including the plain (non-`.multi`) `odds-row` class. Add a sibling branch: when `market.market_type !== 'binary'`, map `market.options[]` to `.odd-btn.option` buttons (`data-option-id="${o.id}"` instead of `data-choice`), and add the `.multi` modifier class to `.odds-row` per UI-SPEC when `options.length > 2`. Structure as an `if/else` producing two different inner-HTML strings assigned to the same `odds-row` wrapper — do not try to make one shared template branch conditionally per-attribute (that's the exact anti-pattern the UI-SPEC's regression guard warns against: "do not introduce a single shared code path that changes binary's markup as a side effect of generalizing the other two types").

**Current selection handler** (`public/js/dashboard.js:137-145`):
```javascript
grid.querySelectorAll('.odd-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const ticket = btn.closest('.ticket');
    const marketId = Number(ticket.dataset.id);
    selections[marketId] = btn.dataset.choice;
    renderMarkets();
  });
});
```
Since selector is `.odd-btn` (matches both `.odd-btn.sim`/`.odd-btn.nao` and the new `.odd-btn.option`), this loop can stay mostly as-is — just change `selections[marketId] = btn.dataset.choice;` to read `btn.dataset.choice || Number(btn.dataset.optionId)` so `selections[marketId]` holds either a string (`'yes'`/`'no'`) or a number (option id), matching UI-SPEC's "Selection state reuses the existing `selections[marketId]` object unmodified in shape" contract.

**Current submit handler** (`public/js/dashboard.js:147-169`):
```javascript
await Api.post('/wagers', { market_id: marketId, choice, amount });
```
Branch the payload: binary sends `{ market_id, choice, amount }` unchanged; non-binary sends `{ market_id, option_id: choice, amount }` (reusing the `choice` variable name loosely — rename to `selection` for clarity, or branch on `typeof selections[marketId] === 'number'`).

**Current choice-label rendering** (`public/js/dashboard.js:183, 286`):
```javascript
<td>${w.choice === 'yes' ? 'Sim' : 'Não'}</td>
...
<div>Apostou: <span style="color:var(--text);">${w.choice === 'yes' ? 'Sim' : 'Não'} (${fmtCredits(w.amount)})</span></div>
```
Both call sites (in `loadMyWagers` and `showUserWagers`) must become: `w.option_id != null ? escapeHtml(w.option_label) : (w.choice === 'yes' ? 'Sim' : 'Não')` — `option_label` comes from the extended `SELECT_WITH_MARKET` JOIN (`wagerRepository.js` pattern above). This is explicitly named in RESEARCH.md Pitfall 4/UI-SPEC line 178 as one of the four call sites that must not be missed.

---

### `public/admin.html` (MODIFIED: market-type select + fieldsets)

No existing analog needed beyond the current `#newMarketForm` block itself — UI-SPEC's Admin Panel Contract section fully specifies the new markup (`#mMarketType` select with 3 options, 3 `.market-type-fieldset` divs toggled via JS, `#mThreshold`/`#mOddsOver`/`#mOddsUnder` inputs, `.options-list`/`.option-row`/`#addOptionBtn` for multiple-choice). Reuse `.field`/`.field label`/`.field input`/`.field select` classes verbatim (`public/css/style.css:287-308`) for every new input — do not introduce new input styling.

---

### `public/css/style.css` (additive only)

**Existing rules that must NOT be edited** (MARKET-03 hard rule, UI-SPEC Component Inventory):
```css
/* style.css:206-229 */
.odds-row { display: flex; gap: 10px; margin-bottom: 14px; }
.odd-btn { ... }
.odd-btn.sim .value { color: var(--sim); }
.odd-btn.sim.selected { border-color: var(--sim); background: rgba(198,255,61,0.08); }
.odd-btn.nao .value { color: var(--nao); }
.odd-btn.nao.selected { border-color: var(--nao); background: rgba(255,92,122,0.08); }
```
**Analog for new additive rules:** `.inline-form` (`style.css:355-356`, `gap: 8px`) is the direct source for `.options-list`'s `gap: 8px` per UI-SPEC's Spacing Scale section. Add new rules only, appended to the file (not interleaved into the existing `.odd-btn`/`.odds-row` block): `.odd-btn.option { color: var(--text); }` (neutral, no `.sim`/`.nao`), `.odds-row.multi { flex-wrap: wrap; } .odds-row.multi .odd-btn.option { flex: 1 1 120px; min-width: 120px; }`, `.options-list { display:flex; flex-direction:column; gap:8px; }`, `.option-row { display:flex; gap:8px; align-items:center; }`, `.resolve-select` reusing `.field select`/`.inline-form select` declarations (`style.css:299-308`).

---

## Shared Patterns

### Transaction wrapping for multi-step writes
**Source:** `src/services/marketService.js:117-173` (`resolveMarket`), `:208-254` (`deleteMarket`)
**Apply to:** `marketService.createMarket` (new — must wrap market INSERT + options bulk-insert), `wagerService.placeWager` (already wraps; extend to include the option lookup)
```javascript
const result = await transaction(async (client) => {
  const marketResult = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [marketId]);
  // ... all reads/writes use `client`, never the bare `query` import ...
  return { ...dataNeededForEventsAfterCommit };
});
// domainEvents.emit(...) only AFTER the transaction resolves — never inside it (D-01 convention)
```

### IDOR-safe ownership-in-WHERE lookups
**Source:** `src/repositories/wagerRepository.js:40-46` (`findByIdForUpdate`)
**Apply to:** new `marketOptionRepository.findByIdForMarket` — every lookup driven by a client-submitted `option_id` must pair it with `market_id` in the same WHERE clause, never a bare `WHERE id = $1`.

### Error classes / validation
**Source:** `src/utils/errors.js:16-21` (`ValidationError`), used throughout `marketService.js`/`wagerService.js` via `throw new ValidationError('mensagem em português.')`
**Apply to:** all new validation branches (market_type enum check, option count bound, threshold format, duplicate labels) — throw `ValidationError` with a PT-BR message, never a raw `Error` or generic 500.

### Decimal-safe math
**Source:** `src/utils/money.js` (`multiply`, already used in `marketService.js:142` `money.multiply(wager.potential_payout, remainingFraction)`)
**Apply to:** `wagerService.placeWager`'s `potentialPayout` calc (replacing `Math.round(wagerAmount * odds * 100) / 100`); any new payout-adjacent math in `marketOptionRepository`/`marketService` for new types — never hand-roll rounding.

### Controller destructure-and-forward convention
**Source:** `src/controllers/marketsController.js:8-19,36-39`
**Apply to:** no structural controller changes needed for market creation/resolution (body/params already passed through to the service as a whole object) — but any NEW controller code must never `...req.body` spread directly into a repository call; destructure explicit fields, matching the existing `wagersController.cashoutWager`'s `{ amount, idempotency_key }` shape cited in RESEARCH.md.

### Client-side fetch/error convention
**Source:** `public/js/admin.js:51-60`
```javascript
try {
  await Api.post('/markets', body);
  showToast('Mercado criado!', 'success');
  e.target.reset();
  loadMarkets();
} catch (err) {
  showToast(err.message, 'error');
}
```
**Apply to:** all new form-submit/button-click handlers in `admin.js`/`dashboard.js` for the new market types — server error messages surface verbatim via `showToast(err.message, 'error')`, client-side pre-submit checks (UI-SPEC's guardrail copy) are convenience-only and must not replace this pattern.

## No Analog Found

None — every file in scope has a direct in-repo analog (either the exact file being generalized in-place, or a sibling file with the same role/data-flow shape from Phase 1/2). This phase is explicitly scoped as additive generalization of existing, already-reviewed code (RESEARCH.md: "every piece of Phase 3's financial-integrity risk surface... was already built and code-reviewed in Phase 1/2").

## Metadata

**Analog search scope:** `src/migrations/`, `src/repositories/`, `src/services/`, `src/controllers/`, `public/js/`, `public/css/style.css`, `src/utils/errors.js`, `src/utils/money.js`
**Files scanned:** 10 (all fully read; no file exceeded 2,000 lines, no offset/limit paging needed)
**Pattern extraction date:** 2026-07-14
