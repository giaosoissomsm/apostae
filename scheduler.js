const db = require('./db');
const { closeMarket, resolveMarket } = require('./services/marketService');

const TICK_MS = 10 * 1000; // confere a cada 10s - suficiente pra um grupo de amigos

function tick() {
  try {
    const toClose = db
      .prepare(
        "SELECT id FROM markets WHERE status = 'open' AND closes_at IS NOT NULL AND closes_at <= datetime('now')"
      )
      .all();
    for (const m of toClose) {
      closeMarket(m.id);
      console.log(`>> Mercado #${m.id} fechado automaticamente (closes_at atingido).`);
    }

    const toReveal = db
      .prepare(
        `SELECT id, scheduled_outcome FROM markets
         WHERE status != 'resolved' AND reveal_at IS NOT NULL AND scheduled_outcome IS NOT NULL
           AND reveal_at <= datetime('now')`
      )
      .all();
    for (const m of toReveal) {
      resolveMarket(m.id, m.scheduled_outcome);
      console.log(`>> Mercado #${m.id} resolvido automaticamente como "${m.scheduled_outcome}" (reveal_at atingido).`);
    }
  } catch (err) {
    console.error('Erro no agendador de mercados:', err);
  }
}

function startScheduler() {
  tick(); // roda uma vez já na subida do servidor, pra pegar horários que passaram enquanto estava offline
  setInterval(tick, TICK_MS);
}

module.exports = { startScheduler };
