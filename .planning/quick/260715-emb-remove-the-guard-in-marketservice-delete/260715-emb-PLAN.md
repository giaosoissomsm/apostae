---
phase: quick-260715-emb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/services/marketService.js
autonomous: true
requirements: [QUICK-DELMKT-01]
must_haves:
  truths:
    - "marketService.deleteMarket no longer throws ConflictError when market.status === 'resolved'"
    - "Admins can hard-delete a resolved market via DELETE /api/markets/:id, cascade-deleting its settled wager rows"
    - "Pending-wager refund logic in deleteMarket is byte-identical to before"
  artifacts:
    - src/services/marketService.js
  key_links:
    - "wagers.market_id REFERENCES markets(id) ON DELETE CASCADE (src/migrations/001_initial.js:74) — deleting a resolved market cascade-removes its won/lost/refunded wager rows"
---

<objective>
Remove the resolved-market guard in `marketService.deleteMarket` so admins can hard-delete a resolved market via the existing `DELETE /api/markets/:id` route.

Purpose: The project owner explicitly reversed the Phase 1 CR-01 fix. They were warned that `wagers.market_id` is `ON DELETE CASCADE`, so deleting a resolved market cascade-deletes every won/lost/refunded wager row for that market, and confirmed they want true hard delete.
Output: One deleted guard block plus a one-line comment documenting the deletion is intentional.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./.claude/CLAUDE.md
@src/services/marketService.js
@src/migrations/001_initial.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove resolved-market guard in deleteMarket</name>
  <files>src/services/marketService.js</files>
  <action>
In `deleteMarket` (currently lines 371-373), delete the three-line block that throws when the market is resolved:

    if (market.status === 'resolved') {
      throw new ConflictError('Não é possível deletar um mercado já resolvido.');
    }

Replace it with a single Portuguese comment at the removal site, immediately after the `if (!market) throw new NotFoundError(...)` line, documenting the deletion is deliberate so a future reviewer does not restore the guard. Reference intent along these lines (adjust wording to match codebase comment style — do not paste the removed message verbatim): mercados resolvidos PODEM ser deletados por decisão explícita do dono; wagers.market_id é ON DELETE CASCADE, então deletar cascateia as apostas liquidadas — comportamento intencional, reversão consciente do CR-01 (commit 48fddc2). Do NOT paste the literal string "Não é possível deletar um mercado já resolvido." into the comment.

Change NOTHING else: the pending-wager refund loop, the `DELETE FROM wagers ... status='pending'`, `marketRepository.delete`, logger, and `domainEvents.emit('market.deleted', ...)` must remain byte-identical. Leave the `ConflictError` import on line 7 in place — it is still used by `resolveMarket` on line 246.
  </action>
  <verify>
    <automated>grep -c "Não é possível deletar um mercado já resolvido" src/services/marketService.js | grep -qx 0 && grep -q "market.deleted" src/services/marketService.js && grep -q "status = \$1 AND status = 'pending'\|status = 'pending'" src/services/marketService.js && echo GUARD_REMOVED_LOGIC_INTACT</automated>
  </verify>
  <done>The resolved-market throw block is gone; a comment at the removal site marks the deletion intentional; refund/pending-delete/cascade-delete/event-emit logic is unchanged; `node -e "require('./src/services/marketService.js')"` loads without error.</done>
</task>

</tasks>

<verification>
- `grep -n "status === 'resolved'" src/services/marketService.js` returns only line ~246 (resolveMarket), no match inside deleteMarket.
- `npx jest tests/cashout.delete-market-refund.test.js` still passes (pending-refund path unchanged).
- No test asserts the old blocking behavior; `markets.resolution.test.js:252` "já resolvido" is a resolveMarket idempotency test and is unaffected.
</verification>

<success_criteria>
Admin DELETE on a resolved market succeeds (no ConflictError), cascade-deleting settled wagers; pending-wager refund behavior and market.deleted event are preserved exactly.
</success_criteria>

<output>
Create `.planning/quick/260715-emb-remove-the-guard-in-marketservice-delete/260715-emb-SUMMARY.md` when done.
</output>
