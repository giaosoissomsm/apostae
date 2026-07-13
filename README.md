# Zoeira Market 🎟️

Mercado de apostas "Sim/Não" com odds, pra jogar com os amigos usando créditos fictícios.
Estilo Polymarket, mas caseiro. Agora com agendamento automático, ranking competitivo e gerenciamento completo de contas.

## Como rodar

```bash
npm install
cp .env.example .env   # e troque o JWT_SECRET por uma string aleatória sua
npm start
```

Acesse **http://localhost:3000**.

Na primeira execução um usuário admin é criado automaticamente:

- **usuário:** `admin`
- **senha:** `admin123`

**Troque essa senha assim que entrar** (clica em "Perfil" no menu e altera).

O banco é SQLite e fica em `data/apostas.db` (criado automaticamente).

## O que é possível fazer

### Usuário comum
- **Criar conta**: qualquer amigo se registra em `/login.html` e já começa com 100 fichas.
- **Apostar**: escolhe um mercado aberto, seleciona Sim ou Não, coloca a quantidade de fichas e posta.
- **Cancelar aposta**: se o mercado ainda tá aberto, consegue cancelar e pega a ficha de volta.
- **Ver histórico**: a aba "Minhas fichas" mostra todas as apostas, ganhos e perdas.
- **Ranking**: vê quanto crédito todo mundo tem e **clica em um usuário pra ver as apostas dele** (vitórias, derrotas, saldo).
- **Trocar senha**: vai em "Perfil" → "Trocar senha" (exige a senha atual pra confirmar).

### Admin
- **Criar mercados** com agendamento automático:
  - Define a pergunta, as odds do Sim e do Não.
  - (Opcional) Define uma hora pra as apostas fecharem sozinhas.
  - (Opcional) Define uma hora pra o resultado ser revelado automaticamente.
  - (Opcional) Pré-define o resultado (Sim ou Não) — fica em segredo até a revelação.
- **Resolver manualmente**: marca o resultado de um mercado que ainda tá aberto ou fechado, pagando quem acertou.
- **Fechar manualmente**: bloqueia novas apostas sem resolver ainda.
- **Deletar mercados**: remove um mercado e devolve as fichas de quem apostou.
- **Gerenciar usuários**:
  - Criar novo usuário manualmente com um crédito inicial.
  - Ajustar o saldo de qualquer usuário.
  - Promover/rebaixar admin.
  - **Ativar/desativar contas**: uma conta desativada não consegue logar (e tokens antigos são invalidados).
  - **Deletar permanentemente**: remove um usuário (não dá se ele criou mercados, pra não quebrar o histórico).
- **Ver apostas de cada usuário** e **deletar apostas individuais** (devolvendo a ficha se tava pending).
- **Trocar sua senha** sem comprometer nenhuma outra conta.

## Agendamento automático

Quando você cria um mercado com `closes_at` e/ou `reveal_at`, o servidor roda um scheduler que:
- **A cada ~10 segundos** confere se há mercados pra fechar ou resolver.
- **Fecha automaticamente** na hora de `closes_at` (ninguém consegue mais apostar).
- **Resolve automaticamente** na hora de `reveal_at` com o `scheduled_outcome` pré-definido, pagando quem acertou.
- É idempotente: se o servidor cai e volta, pega os horários que passaram enquanto tava offline.

Exemplo de uso:
1. Cria um mercado perguntando "Vai chover amanhã?" com Sim 2x e Não 1.5x.
2. Define `closes_at` pra daqui a 2 horas (pra gera aquele climão de correr contra o tempo).
3. Define `reveal_at` pra amanhã às 15:00 (quando você vê a previsão).
4. Pré-define `scheduled_outcome` como "yes" ou "no" (só você sabe).
5. No horário, o mercado fecha, revela e paga automaticamente.

## Funcionalidades de Ranking

- **Ver apostas de qualquer usuário**: clica no nome dele no ranking e aparece uma modal com:
  - Quantidade de vitórias e derrotas
  - Saldo final (ganhos - perdas)
  - Histórico de todas as apostas desse usuário
- Admin consegue deletar apostas direto da modal (devolve os créditos se tava pending).

## Segurança

- **Backend nunca confia no frontend**: `user_id`, `owner_id` e `is_admin` são sempre lidos do token JWT assinado pelo servidor, nunca do body/query.
- **Desativação instantânea**: se um admin desativa sua conta, você é bloqueado na próxima requisição (não precisa esperar o token expirar).
- **Senhas com hash**: bcrypt, nunca em texto puro.
- **Transações do SQLite**: operações críticas (apostas, resoluções, deletions) rodam atomicamente.
- **Proteções contra auto-modificação**: um admin não consegue rebaixar a si mesmo ou desativar a própria conta.

## Estrutura

```
server.js                    # entrada + scheduler agora ligado aqui
db.js                        # schema + migrações idempotentes
scheduler.js                 # agendador de mercados (roda a cada ~10s)
middleware/auth.js           # JWT + checagem instantânea de admin/ativo do banco
routes/auth.js               # login/registro
routes/users.js              # perfil próprio (troca de senha), admin de usuários/créditos/status
routes/markets.js            # criação/edição/fechamento/resolução com agendamento
routes/wagers.js             # apostas + admin delete
services/marketService.js    # lógica compartilhada de close/resolve
public/                      # frontend (HTML/CSS/JS puro)
```

## Créditos e limites

- Cada usuário comum começa com **100 fichas**.
- Admin começa com **10.000 fichas** (pra fazer testes).
- Odds têm que estar entre **1.01x** e **1000x**.
- Nenhum limite de apostas simultâneas ou valor máximo (brincadeira entre amigos).

## Próximas ideias (não implementadas)

- Leaderboard em tempo real com atualização WSS.
- Gráficos de histórico de créditos.
- Notificações quando um mercado que você apostou fecha/resolve.
- Cashout parcial (pegar lucro antes do mercado resolver).
- Mercados "over/under" e "múltipla escolha" (além de Sim/Não).
