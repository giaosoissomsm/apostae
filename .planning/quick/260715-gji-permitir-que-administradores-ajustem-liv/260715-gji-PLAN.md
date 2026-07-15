---
phase: quick-260715-gji
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/services/userService.js
  - src/controllers/usersController.js
  - src/routes/users.js
autonomous: true
requirements:
  - GJI-01
must_haves:
  truths:
    - "An admin can add credits to any user's wallet through an admin-only endpoint, and the user's balance increases by exactly that amount."
    - "An admin can remove credits from any user's wallet, and the balance decreases by exactly that amount — but never below zero."
    - "Every admin balance adjustment produces both a wallet_transactions row (type='correction', related_entity='admin_adjustment') and an audit_logs row (action='admin_adjust_balance'), committed atomically with the balance change."
    - "A non-admin request to the endpoint is rejected before any balance mutation."
    - "The balance mutation is serialized under concurrent access via a FOR UPDATE row lock on the target wallet."
  artifacts:
    - "src/services/userService.js: adjustUserBalance method"
    - "src/controllers/usersController.js: adjustUserBalance handler"
    - "src/routes/users.js: POST /:id/balance route guarded by requireAuth + requireAdmin"
  key_links:
    - "route POST /:id/balance -> usersController.adjustUserBalance -> userService.adjustUserBalance"
    - "userService.adjustUserBalance -> transaction() -> walletRepository.findByUserIdForUpdate (FOR UPDATE) -> adjustBalance + recordTransaction + audit_logs INSERT (all inside the same client)"
---

<objective>
Add an admin-only endpoint that lets an administrator freely adjust (credit or debit) the wallet balance of any user, with full financial-integrity guarantees: PostgreSQL transaction, FOR UPDATE row lock, an auditable wallet_transactions movement record, and an audit_logs entry — never a direct balance mutation.

Purpose: Admins need to correct/grant/remove chips arbitrarily; the money-movement invariant ("a user's balance must never diverge from the sum of their recorded transactions, even under concurrent access") must hold.
Output: New service method, controller handler, and route wired into the existing Controller/Service/Repository layering.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/260715-gji-permitir-que-administradores-ajustem-liv/260715-gji-CONTEXT.md

# Existing patterns this plan mirrors (already read during planning):
# - src/services/userService.js setActive (validate -> findById -> mutate -> audit -> log -> return)
# - src/services/wagerService.js placeWager (transaction() + walletRepository.findByUserIdForUpdate FOR UPDATE + adjustBalance + recordTransaction)
# - src/repositories/walletRepository.js (adjustBalance, recordTransaction, findByUserIdForUpdate)
# - src/controllers/usersController.js setUserStatus (controller boundary validation + parseInt(req.params.id) + req.user.id + req.ip)
# - src/routes/users.js PUT /:id/status wiring
# - src/migrations/002_wallet.js (wallet_transactions.type CHECK: credit|debit|refund|correction; wallets CHECK balance >= 0)
# - src/migrations/001_initial.js (audit_logs columns: action, admin_id, target_user_id, changes JSONB, ip_address, details)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add adjustUserBalance service method (transactional, locked, audited)</name>
  <files>src/services/userService.js</files>
  <action>
Add an async method `adjustUserBalance(userId, type, amount, description, adminId, ipAddress)` to the UserService class, placed after `setRole`. Import `transaction` from `../config/database` and `walletRepository` from `../repositories/walletRepository` at the top of the file (the file currently imports only `query`; add these two).

Server-side validation FIRST, before any DB work (never trust the client for anything except the literal admin-chosen delta):
- `type` must be exactly `'credit'` or `'debit'` — otherwise throw `ValidationError('type deve ser credit ou debit')`.
- `amount` must be a finite positive number: reject with `ValidationError('Valor deve ser um número positivo')` unless `Number.isFinite(amount) && amount > 0`. Do NOT accept zero or negative.
- `description` must be a non-empty trimmed string: `if (!description || typeof description !== 'string' || description.trim().length === 0) throw new ValidationError('Motivo é obrigatório')`. Trim it into a local before use.
- IDOR guard: `const user = await userRepository.findById(userId); if (!user) throw new NotFoundError('Usuário não encontrado');` — target must exist. Do NOT replicate setActive's `adminId === userId` self-guard: self-adjustment is explicitly allowed per CONTEXT decision.

Then perform the money movement inside `transaction(async (client) => { ... })`, mirroring wagerService.placeWager's lock+record shape:
- Lock the wallet: `const wallet = await walletRepository.findByUserIdForUpdate(userId, client);` If it returns null throw `NotFoundError('Carteira não encontrada')`.
- Compute `const delta = type === 'credit' ? amount : -amount;`
- For a debit, verify sufficient balance BEFORE the UPDATE (inside the lock) so the Postgres `CHECK (balance >= 0)` never surfaces as a generic DB error: `if (type === 'debit' && Number(wallet.balance) < amount) throw new ValidationError('Saldo insuficiente para o débito');`
- `const balanceBefore = wallet.balance;`
- `const updated = await walletRepository.adjustBalance(wallet.id, delta, client);`
- Record the movement via the existing repository method (NEVER a direct balance UPDATE): `await walletRepository.recordTransaction({ walletId: wallet.id, type: 'correction', amount, balanceBefore, balanceAfter: updated.balance, relatedEntity: 'admin_adjustment', description: trimmedDescription, adminId }, client);` — note `amount` stays the positive magnitude (wallet_transactions CHECK requires amount > 0); the credit/debit direction lives in balance_before vs balance_after.
- Insert the audit row on the SAME client so it commits/rolls back atomically with the balance change: `await client.query(\`INSERT INTO audit_logs (action, admin_id, target_user_id, ip_address, changes, details) VALUES ($1, $2, $3, $4, $5, $6);\`, ['admin_adjust_balance', adminId, userId, ipAddress, JSON.stringify({ type, amount, balance_before: balanceBefore, balance_after: updated.balance }), trimmedDescription]);`
- Return `updated.balance` from the transaction callback.

After the transaction resolves, `logger.info(...)` an audit line (mirror setActive's log style, in Portuguese) and return `{ ok: true, balance: newBalance }`.

Use JSDoc in Portuguese matching the existing method style. Use the custom error classes already imported (`ValidationError`, `NotFoundError`) — never raw throws. Do NOT emit any notification (out of scope per CONTEXT).
  </action>
  <verify>
    <automated>node --check src/services/userService.js && grep -q "findByUserIdForUpdate" src/services/userService.js && grep -q "type: 'correction'" src/services/userService.js && grep -q "admin_adjustment" src/services/userService.js && grep -q "admin_adjust_balance" src/services/userService.js && grep -q "Saldo insuficiente" src/services/userService.js</automated>
  </verify>
  <done>userService exports an adjustUserBalance method that: validates type/amount/description server-side, loads the target user (404 if absent), locks the wallet FOR UPDATE inside a transaction, blocks over-drafting debits with a ValidationError, mutates balance only via adjustBalance, records a type='correction'/related_entity='admin_adjustment' wallet_transactions row and an action='admin_adjust_balance' audit_logs row atomically, and returns the new balance. `node --check` passes.</done>
</task>

<task type="auto">
  <name>Task 2: Wire controller handler and admin-only route</name>
  <files>src/controllers/usersController.js, src/routes/users.js</files>
  <action>
In `src/controllers/usersController.js`, add an `adjustUserBalance` handler mirroring `setUserStatus`, wrapped in `catchAsync`:
- Destructure `const { type, amount, description } = req.body;`
- Light boundary validation matching the existing controller style: `if (type !== 'credit' && type !== 'debit') throw new ValidationError("type deve ser 'credit' ou 'debit'");` and `if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new ValidationError('amount deve ser um número positivo');` and `if (!description || typeof description !== 'string' || description.trim().length === 0) throw new ValidationError('description é obrigatório');` (the service re-validates as the authoritative gate; this just returns clean 400s early).
- Call `const result = await userService.adjustUserBalance(parseInt(req.params.id, 10), type, amount, description, req.user.id, req.ip);`
- `res.json(result);`
- Add `adjustUserBalance` to the module.exports object at the bottom.
Add a Portuguese JSDoc header matching the existing handlers (e.g. `/** POST /api/users/:id/balance - Ajusta saldo do usuário (admin) */`).

In `src/routes/users.js`, register the route guarded exactly like the other admin routes: `router.post('/:id/balance', requireAuth, requireAdmin, usersController.adjustUserBalance);`. Place it next to the `PUT /:id/status` route with a matching Portuguese comment block (`/** Admin: Ajustar saldo (créditos) */`). Use POST (not PUT) because a balance adjustment is a non-idempotent money movement — replaying it must not be treated as a safe no-op.
  </action>
  <verify>
    <automated>node --check src/controllers/usersController.js && node --check src/routes/users.js && grep -q "adjustUserBalance" src/controllers/usersController.js && grep -q "'/:id/balance', requireAuth, requireAdmin, usersController.adjustUserBalance" src/routes/users.js</automated>
  </verify>
  <done>POST /api/users/:id/balance is registered behind requireAuth + requireAdmin, the adjustUserBalance controller validates type/amount/description at the boundary, forwards parseInt(id)/type/amount/description/req.user.id/req.ip to the service, and returns the service result as JSON. Both files pass `node --check` and the handler is exported.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → API (POST /:id/balance) | Untrusted admin-supplied body (type, amount, description) and path param (:id) cross here |
| service → PostgreSQL | Balance mutation + audit persistence must be atomic and serialized |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-gji-01 | Elevation of Privilege | POST /:id/balance | critical | mitigate | requireAuth + requireAdmin middleware (role_id===2) rejects non-admins before the controller runs — identical guard to all existing admin routes |
| T-gji-02 | Tampering | request body amount/type | critical | mitigate | Server-side re-validation in service is authoritative: amount must be Number.isFinite && > 0, type ∈ {credit,debit}; client value used only as the literal delta magnitude |
| T-gji-03 | Tampering | wallet balance | critical | mitigate | Balance changed only via walletRepository.adjustBalance inside a transaction; every change writes a corresponding wallet_transactions row — no direct mutation |
| T-gji-04 | Information Disclosure / IDOR | :id path param | high | mitigate | userRepository.findById(userId) 404s a non-existent target; wallet locked by user_id; admin-only route already scopes access |
| T-gji-05 | Denial of Service (race) | concurrent adjustments | high | mitigate | findByUserIdForUpdate takes a FOR UPDATE row lock; concurrent adjustments serialize; debit sufficiency checked inside the lock so CHECK(balance>=0) never fires as a raw error |
| T-gji-06 | Repudiation | admin action | high | mitigate | audit_logs row (action='admin_adjust_balance', admin_id, target_user_id, changes JSONB, details) inserted on the same transaction client — atomic with the balance change; mandatory non-empty description |
| T-gji-SC | Tampering | npm/pip/cargo installs | high | accept | No new packages installed — feature uses only existing deps (pg, existing repos). No package-legitimacy checkpoint needed. |
</threat_model>

<verification>
- `node --check` passes on all three modified files.
- Structural gates confirm the FOR UPDATE lock, type='correction'/related_entity='admin_adjustment' transaction record, action='admin_adjust_balance' audit row, insufficient-balance guard, and admin-guarded POST route are present.
- NOTE (carried-forward blocker from STATE.md): no live *test*-named Postgres is reachable in this sandbox, so runtime integration assertions (concurrent-adjustment serialization, over-draft rejection, audit-row atomicity) cannot get a real pass/fail signal here. If the executor can reach a live DB, add a mock-backed or live dry run exercising: (a) credit increases balance, (b) debit decreases balance, (c) over-draft debit throws ValidationError and leaves balance unchanged, (d) each success writes exactly one wallet_transactions + one audit_logs row, (e) non-admin is rejected — mirroring the compensating-verification approach used across Phases 1-4.
</verification>

<success_criteria>
- An admin can POST a credit or debit adjustment for any user and the balance moves by exactly the amount.
- Debits cannot drive a balance below zero (clean ValidationError, not a DB error).
- Every adjustment writes an atomic (wallet_transactions + audit_logs) pair.
- Non-admins are rejected before any mutation.
- All three files pass `node --check` and follow existing Controller/Service/Repository conventions.
</success_criteria>

<output>
Create `.planning/quick/260715-gji-permitir-que-administradores-ajustem-liv/260715-gji-SUMMARY.md` when done.
</output>
