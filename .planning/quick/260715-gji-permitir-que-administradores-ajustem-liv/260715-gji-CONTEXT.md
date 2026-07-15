# Quick Task 260715-gji: Permitir que administradores ajustem livremente o saldo (fichas/créditos) de qualquer usuário - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning

<domain>
## Task Boundary

Permitir que administradores ajustem livremente o saldo (fichas/créditos) de qualquer usuário,
adicionando ou removendo o quanto quiserem, através de um endpoint admin-only. Deve respeitar os
requisitos de integridade financeira do projeto (CLAUDE.md): transação PostgreSQL, registro de
auditoria/movement (nunca mutação direta de balance), validação server-side de permissão, safety
sob acesso concorrente (locking), nunca confiar em valores do cliente sem validar.

</domain>

<decisions>
## Implementation Decisions

### Modelo de permissão
- Usar `requireAdmin` (role_id === 2), o mesmo guard usado por TODAS as outras rotas admin
  existentes (setUserStatus, resolveMarket, etc). Não introduzir `requirePermission('manage_wallets')`
  agora — seria a primeira rota do sistema a usar o sistema de permissões granulares, e isso é
  escopo maior do que essa tarefa pede.

### Claude's Discretion
As áreas abaixo não foram discutidas explicitamente pelo usuário — decisões tomadas com base nos
padrões já existentes no código (ver research: `wallet_transactions.type='correction'` e
`related_entity='admin_adjustment'` já estão previstos no schema mas nunca usados):

- **Motivo/descrição:** obrigatório (string não-vazia). É gravado em
  `wallet_transactions.description` e também em `audit_logs.details` — sem motivo, a trilha de
  auditoria fica inútil para uma ação que move dinheiro arbitrariamente.
- **Limites do ajuste:** sem teto máximo artificial (admin já é uma posição de confiança total no
  sistema). Validar apenas que o valor é numérico e positivo, e que o `type` é `credit` ou `debit`.
  Para débito, verificar saldo suficiente **antes** de tentar o UPDATE (dentro da transação, após o
  `FOR UPDATE` lock) e lançar `ValidationError` com mensagem clara em vez de deixar o
  `CHECK (balance >= 0)` do Postgres estourar como erro genérico de banco.
- **Auto-ajuste:** permitir admin ajustar o próprio saldo (não replicar o guard
  `adminId === userId` de `setActive`, que existe para impedir auto-desativação — aqui não há
  motivo análogo para bloquear).
- **Notificação ao usuário:** fora de escopo desta tarefa. A infraestrutura de notifications (fase
  01) existe mas integrá-la aqui é um adicional, não um requisito coberto pelo pedido original.

</decisions>

<specifics>
## Specific Ideas

Reaproveitar os métodos já existentes em `src/repositories/walletRepository.js`:
`adjustBalance(walletId, delta, client)` e `recordTransaction({...}, client)`. Usar
`type: 'correction'`, `related_entity: 'admin_adjustment'` (já antecipados no schema/comentários,
nunca usados por nenhum caller até agora). Seguir o padrão de
`userService.setActive` (`src/services/userService.js:82-115`) para a forma
validar→buscar→mutar→auditar→logar→retornar, e o padrão de lock de
`wagerService` (`findByUserIdForUpdate` + `transaction()` wrapper) para concorrência.

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements fully captured in decisions above. Requisitos vêm do
CLAUDE.md do projeto (seções Financial integrity, Security, Concurrency).

</canonical_refs>
