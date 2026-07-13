# Changelog - Zoeira Market

## v2.0.0 - Agendamento, Ranking Avançado & Gestão Completa

### Novidades 🎉

#### Agendamento Automático de Mercados
- Mercados podem ter `closes_at` (hora de fechar apostas) e `reveal_at` (hora de revelar resultado).
- `scheduled_outcome` permite pré-definir o resultado (Sim ou Não) — fica em segredo até a revelação.
- Scheduler roda a cada ~10s, processando mercados que atingiram seus horários.
- Idempotente: recupera mercados agendados que passaram enquanto o servidor estava offline.
- Timers mostram quanto tempo falta pra fechar, criando urgência nas apostas.

#### Páginas e Abas Separadas
- **Dashboard**: mercados agora divididos em 3 abas (Abertos, Fechados, Resolvidos).
- **Ranking Interativo**: clica no nome de qualquer usuário pra ver:
  - Estatísticas (vitórias, derrotas, saldo).
  - Histórico completo de apostas dele.
- **Perfil**: página dedicada pra trocar a própria senha (com validação da senha atual).

#### Gestão de Usuários (Admin)
- **Ativar/Desativar**: desativar uma conta a bloqueia instantaneamente (não precisa esperar token expirar).
- **Deletar Permanentemente**: remove usuário e todas as suas apostas (não dá se ele criou mercados).
- **Ver Apostas**: admin consegue ver as apostas de qualquer usuário e deletá-las (devolvendo fichas).
- **Deletar Mercados**: remove um mercado inteiro (devolve fichas a quem apostou).

#### Segurança Reforçada
- Permissões (`is_admin`) e status (`is_active`) **sempre** lidos do banco, nunca confiando no token.
- Um admin não consegue rebaixar ou desativar a si mesmo.
- Rotas DELETE para apostas e mercados requerem autenticação de admin.

### Mudanças Técnicas

#### Backend
- `db.js`: Adicionadas colunas `is_active`, `closes_at`, `reveal_at`, `scheduled_outcome`.
- Migrações idempotentes para bancos antigos.
- `middleware/auth.js`: Valida `is_active` e relê permissões do banco em cada request.
- `scheduler.js`: Novo serviço que fecha e resolve mercados por horário.
- `services/marketService.js`: Lógica compartilhada entre rota admin e scheduler.
- `routes/markets.js`: Suporte a campos de agendamento; `DELETE /markets/:id` para admin.
- `routes/wagers.js`: Nova rota `POST /wagers/:id/admin-delete` e `GET /wagers/user/:username`.
- `routes/auth.js`: Bloqueia login se conta está desativada.
- `routes/users.js`: Nova rota `PUT /users/:id/status` e `DELETE /users/:id`.
- `server.js`: Inicializa `startScheduler()` na subida.

#### Frontend
- `index.html`: Abas de filtro de mercados (abertos/fechados/resolvidos).
- `admin.html`: Campos de agendamento; tabela de mercados e usuários com ações expandidas.
- `profile.html`: Nova página dedicada a trocar senha (usuário + admin).
- `public/css/style.css`: Botões de filtro `.market-filter-btn`; modal de apostas.
- `public/js/dashboard.js`: Reescrito com filtros, modal de ranking, timers.
- `public/js/admin.js`: Suporte a agendamento, deletar apostas/mercados, ver apostas por usuário.
- `public/js/profile.js`: Nova lógica pra trocar senha.

### Ajustes
- **Créditos iniciais**: reduzidos de 1000 para **100 fichas** (mais equilibrado).
- Admin padrão agora começa com 10.000 fichas (não 1000).

### Bug Fixes
- Previne apostas após `closes_at` mesmo se agendador ainda não rodou (race condition).
- Previne cancelamento após `closes_at` pela mesma razão.

### Segurança
- Resultado pré-definido (`scheduled_outcome`) nunca é exposto em listagens pra não-admins.
- Deletar aposta devolve créditos atomicamente dentro de transação.
- Deletar mercado devolve créditos de todas as apostas pending.
