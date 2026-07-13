const db = require('../db');

/**
 * Fecha um mercado pra novas apostas (não paga nada ainda).
 * Idempotente: se já não estiver 'open', não faz nada.
 */
function closeMarket(marketId) {
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
  if (!market) throw { status: 404, message: 'Mercado não encontrado.' };
  if (market.status !== 'open') return market;

  db.prepare("UPDATE markets SET status = 'closed' WHERE id = ?").run(marketId);
  return db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
}

/**
 * Resolve um mercado com o resultado dado, pagando quem apostou certo.
 * Roda tudo em uma transação. Idempotente: se já estiver resolvido, lança erro.
 */
function resolveMarket(marketId, outcome) {
  if (outcome !== 'yes' && outcome !== 'no') {
    throw { status: 400, message: "O resultado precisa ser 'yes' ou 'no'." };
  }

  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
  if (!market) throw { status: 404, message: 'Mercado não encontrado.' };
  if (market.status === 'resolved') throw { status: 409, message: 'Esse mercado já foi resolvido.' };

  const run = db.transaction(() => {
    db.prepare(
      "UPDATE markets SET status = 'resolved', outcome = ?, resolved_at = datetime('now') WHERE id = ?"
    ).run(outcome, marketId);

    const wagers = db.prepare("SELECT * FROM wagers WHERE market_id = ? AND status = 'pending'").all(marketId);
    for (const w of wagers) {
      if (w.choice === outcome) {
        db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(w.potential_payout, w.user_id);
        db.prepare("UPDATE wagers SET status = 'won' WHERE id = ?").run(w.id);
      } else {
        db.prepare("UPDATE wagers SET status = 'lost' WHERE id = ?").run(w.id);
      }
    }
  });

  run();
  return db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId);
}

module.exports = { closeMarket, resolveMarket };
