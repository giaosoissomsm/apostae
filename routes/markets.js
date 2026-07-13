const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { closeMarket, resolveMarket } = require('../services/marketService');

const router = express.Router();

function isValidOdds(n) {
  return Number.isFinite(n) && n >= 1.01 && n <= 1000;
}

// Aceita 'YYYY-MM-DD HH:MM:SS' ou ISO com 'T'/'Z' e normaliza pro formato que o
// SQLite usa em datetime('now'), sempre em UTC, pra dar pra comparar como texto.
function normalizeDateTime(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// Monta e valida os campos de agendamento a partir do body. Retorna { closesAt, revealAt, scheduledOutcome, error }
function parseSchedule(body) {
  const { closes_at, reveal_at, scheduled_outcome } = body || {};

  const closesAt = closes_at ? normalizeDateTime(closes_at) : null;
  const revealAt = reveal_at ? normalizeDateTime(reveal_at) : null;
  let scheduledOutcome = null;

  if (closes_at && !closesAt) return { error: 'Data de fechamento inválida.' };
  if (reveal_at && !revealAt) return { error: 'Data de revelação inválida.' };

  if (scheduled_outcome !== undefined && scheduled_outcome !== null && scheduled_outcome !== '') {
    if (scheduled_outcome !== 'yes' && scheduled_outcome !== 'no') {
      return { error: "Resultado pré-definido precisa ser 'yes' ou 'no'." };
    }
    scheduledOutcome = scheduled_outcome;
  }

  if (scheduledOutcome && !revealAt) {
    return { error: 'Pra pré-definir um resultado, informe também o horário de revelação.' };
  }
  if (closesAt && revealAt && closesAt > revealAt) {
    return { error: 'O horário de revelação precisa ser depois do horário de fechamento.' };
  }

  return { closesAt, revealAt, scheduledOutcome };
}

function sanitizeMarket(market, isAdmin) {
  if (isAdmin) return market;
  // Nunca expor o resultado pré-definido pra quem não é admin - vazaria a resposta antes da hora.
  const { scheduled_outcome, ...rest } = market;
  return rest;
}

// GET /api/markets - lista todos os mercados (qualquer usuário logado pode ver)
router.get('/', requireAuth, (req, res) => {
  const markets = db.prepare('SELECT * FROM markets ORDER BY created_at DESC').all();
  res.json(markets.map((m) => sanitizeMarket(m, req.user.is_admin)));
});

// GET /api/markets/:id
router.get('/:id', requireAuth, (req, res) => {
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(Number(req.params.id));
  if (!market) return res.status(404).json({ error: 'Mercado não encontrado.' });
  res.json(sanitizeMarket(market, req.user.is_admin));
});

// POST /api/markets - somente admin cria mercados.
// created_by é sempre req.user.id (do token), nunca vindo do body.
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { question, description, odds_yes, odds_no } = req.body || {};

  if (typeof question !== 'string' || question.trim().length < 4) {
    return res.status(400).json({ error: 'A pergunta precisa ter ao menos 4 caracteres.' });
  }
  if (!isValidOdds(Number(odds_yes)) || !isValidOdds(Number(odds_no))) {
    return res.status(400).json({ error: 'Odds inválidas. Use valores entre 1.01 e 1000.' });
  }

  const schedule = parseSchedule(req.body);
  if (schedule.error) return res.status(400).json({ error: schedule.error });

  const info = db
    .prepare(
      `INSERT INTO markets (question, description, odds_yes, odds_no, status, closes_at, reveal_at, scheduled_outcome, created_by)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`
    )
    .run(
      question.trim(),
      (description || '').toString().trim(),
      Number(odds_yes),
      Number(odds_no),
      schedule.closesAt,
      schedule.revealAt,
      schedule.scheduledOutcome,
      req.user.id
    );

  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(market);
});

// PUT /api/markets/:id - admin edita pergunta/descrição/odds/agendamento ENQUANTO o mercado estiver aberto
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(id);
  if (!market) return res.status(404).json({ error: 'Mercado não encontrado.' });
  if (market.status !== 'open') {
    return res.status(409).json({ error: 'Só é possível editar mercados abertos.' });
  }

  const { question, description, odds_yes, odds_no } = req.body || {};
  const newQuestion = typeof question === 'string' && question.trim().length >= 4 ? question.trim() : market.question;
  const newDescription = typeof description === 'string' ? description.trim() : market.description;
  const newOddsYes = isValidOdds(Number(odds_yes)) ? Number(odds_yes) : market.odds_yes;
  const newOddsNo = isValidOdds(Number(odds_no)) ? Number(odds_no) : market.odds_no;

  const schedule = parseSchedule(req.body);
  if (schedule.error) return res.status(400).json({ error: schedule.error });
  const newClosesAt = req.body && 'closes_at' in req.body ? schedule.closesAt : market.closes_at;
  const newRevealAt = req.body && 'reveal_at' in req.body ? schedule.revealAt : market.reveal_at;
  const newScheduledOutcome =
    req.body && 'scheduled_outcome' in req.body ? schedule.scheduledOutcome : market.scheduled_outcome;

  db.prepare(
    `UPDATE markets SET question = ?, description = ?, odds_yes = ?, odds_no = ?,
     closes_at = ?, reveal_at = ?, scheduled_outcome = ? WHERE id = ?`
  ).run(newQuestion, newDescription, newOddsYes, newOddsNo, newClosesAt, newRevealAt, newScheduledOutcome, id);

  res.json(db.prepare('SELECT * FROM markets WHERE id = ?').get(id));
});

// POST /api/markets/:id/close - admin fecha apostas manualmente (sem resolver ainda)
router.post('/:id/close', requireAuth, requireAdmin, (req, res) => {
  try {
    res.json(closeMarket(Number(req.params.id)));
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao fechar mercado.' });
  }
});

// POST /api/markets/:id/resolve - admin define o resultado (yes/no) manualmente e paga quem acertou
router.post('/:id/resolve', requireAuth, requireAdmin, (req, res) => {
  try {
    res.json(resolveMarket(Number(req.params.id), (req.body || {}).outcome));
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao resolver mercado.' });
  }
});

// DELETE /api/markets/:id - admin deleta um mercado permanentemente.
// Também deleta todas as apostas associadas a ele (e devolve os créditos de apostas pending).
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const marketId = Number(req.params.id);

  const del = db.transaction(() => {
    const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
    if (!market) throw { status: 404, message: 'Mercado não encontrado.' };

    // Devolve créditos de apostas em aberto
    const pendingWagers = db.prepare("SELECT * FROM wagers WHERE market_id = ? AND status = 'pending'").all(marketId);
    for (const w of pendingWagers) {
      db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(w.amount, w.user_id);
    }

    db.prepare('DELETE FROM wagers WHERE market_id = ?').run(marketId);
    db.prepare('DELETE FROM markets WHERE id = ?').run(marketId);
  });

  try {
    del();
    res.json({ ok: true, message: 'Mercado deletado.' });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao deletar mercado.' });
  }
});

module.exports = router;
