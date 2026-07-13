const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/wagers/user/:username - lista as apostas de um usuário específico
// Acessível a qualquer um logado - é só pra visualizar apostas públicas (quem apostou, no quê, quanto ganhou/perdeu)
router.get('/user/:username', requireAuth, async (req, res) => {
  const username = req.params.username.toLowerCase();
  const targetUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(username);
  if (!targetUser) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const wagers = db
    .prepare(
      `SELECT w.id, w.choice, w.amount, w.odds_at_time, w.potential_payout, w.status, 
              w.created_at, m.question, m.status AS market_status, m.outcome AS market_outcome
       FROM wagers w JOIN markets m ON m.id = w.market_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`
    )
    .all(targetUser.id);

  res.json(wagers);
});

// O dono da aposta é SEMPRE req.user.id (do token). Qualquer user_id/owner_id
// enviado no body é ignorado - nunca é lido daqui.
router.post('/', requireAuth, (req, res) => {
  const { market_id, choice, amount } = req.body || {};

  const marketId = Number(market_id);
  const wagerAmount = Number(amount);

  if (!Number.isFinite(marketId)) {
    return res.status(400).json({ error: 'market_id inválido.' });
  }
  if (choice !== 'yes' && choice !== 'no') {
    return res.status(400).json({ error: "choice precisa ser 'yes' ou 'no'." });
  }
  if (!Number.isFinite(wagerAmount) || wagerAmount <= 0) {
    return res.status(400).json({ error: 'Valor da aposta precisa ser maior que zero.' });
  }

  const result = db.transaction(() => {
    // Trava a leitura do usuário e do mercado dentro da transação para evitar
    // apostar mais de uma vez o mesmo crédito em requisições concorrentes.
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);

    if (!market) throw { status: 404, message: 'Mercado não encontrado.' };
    if (market.status !== 'open') throw { status: 409, message: 'Esse mercado não está mais aberto para apostas.' };
    // Checagem extra além do status: se o horário de fechamento já passou mas o
    // agendador ainda não rodou (roda a cada ~10s), não deixa apostar mesmo assim.
    if (market.closes_at) {
      const closesAtRow = db.prepare("SELECT (? <= datetime('now')) AS expired").get(market.closes_at);
      if (closesAtRow.expired) throw { status: 409, message: 'O prazo pra apostar nesse mercado já acabou.' };
    }
    if (user.credits < wagerAmount) throw { status: 400, message: 'Créditos insuficientes.' };

    const odds = choice === 'yes' ? market.odds_yes : market.odds_no;
    const potentialPayout = Math.round(wagerAmount * odds * 100) / 100;

    db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(wagerAmount, user.id);

    const info = db
      .prepare(
        `INSERT INTO wagers (user_id, market_id, choice, amount, odds_at_time, potential_payout, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(user.id, marketId, choice, wagerAmount, odds, potentialPayout);

    return db.prepare('SELECT * FROM wagers WHERE id = ?').get(info.lastInsertRowid);
  });

  try {
    const wager = result();
    res.status(201).json(wager);
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar aposta.' });
  }
});

// DELETE /api/wagers/:id - cancela a PRÓPRIA aposta (só se o mercado ainda estiver aberto)
// A posse é sempre checada contra req.user.id, nunca contra um campo do body.
router.delete('/:id', requireAuth, (req, res) => {
  const wagerId = Number(req.params.id);

  const cancel = db.transaction(() => {
    const wager = db.prepare('SELECT * FROM wagers WHERE id = ?').get(wagerId);
    if (!wager) throw { status: 404, message: 'Aposta não encontrada.' };
    if (wager.user_id !== req.user.id) throw { status: 403, message: 'Essa aposta não é sua.' };

    const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(wager.market_id);
    if (!market || market.status !== 'open') {
      throw { status: 409, message: 'Não é mais possível cancelar: o mercado já fechou.' };
    }
    if (market.closes_at) {
      const closesAtRow = db.prepare("SELECT (? <= datetime('now')) AS expired").get(market.closes_at);
      if (closesAtRow.expired) throw { status: 409, message: 'Não é mais possível cancelar: o prazo já acabou.' };
    }
    if (wager.status !== 'pending') {
      throw { status: 409, message: 'Essa aposta não pode mais ser cancelada.' };
    }

    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(wager.amount, req.user.id);
    db.prepare("UPDATE wagers SET status = 'refunded' WHERE id = ?").run(wagerId);
  });

  try {
    cancel();
    res.json({ ok: true });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao cancelar aposta.' });
  }
});

// POST /api/wagers/:id/admin-delete - admin deleta uma aposta permanentemente
// (devolve os créditos se estava pending)
router.post('/:id/admin-delete', requireAuth, requireAdmin, (req, res) => {
  const wagerId = Number(req.params.id);

  const del = db.transaction(() => {
    const wager = db.prepare('SELECT * FROM wagers WHERE id = ?').get(wagerId);
    if (!wager) throw { status: 404, message: 'Aposta não encontrada.' };

    if (wager.status === 'pending') {
      db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(wager.amount, wager.user_id);
    }
    db.prepare('DELETE FROM wagers WHERE id = ?').run(wagerId);
  });

  try {
    del();
    res.json({ ok: true, message: 'Aposta deletada.' });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao deletar aposta.' });
  }
});

module.exports = router;
