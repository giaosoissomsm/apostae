const marketRepository = require('./repositories/marketRepository');
const marketService = require('./services/marketService');
const logger = require('./utils/logger');

const TICK_MS = 10 * 1000; // confere a cada 10s

async function tick() {
  try {
    const toClose = await marketRepository.findDueToClose();
    for (const m of toClose) {
      await marketService.closeMarket(m.id);
      logger.info(`Mercado #${m.id} fechado automaticamente (closes_at atingido).`);
    }

    const toReveal = await marketRepository.findDueToReveal();
    for (const m of toReveal) {
      await marketService.resolveMarket(m.id, m.scheduled_outcome);
      logger.info(`Mercado #${m.id} resolvido automaticamente como "${m.scheduled_outcome}" (reveal_at atingido).`);
    }
  } catch (err) {
    logger.error('Erro no agendador de mercados', err.message);
  }
}

function startScheduler() {
  tick(); // roda uma vez já na subida do servidor, pra pegar horários que passaram enquanto estava offline
  setInterval(tick, TICK_MS);
}

module.exports = { startScheduler };
