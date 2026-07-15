const { catchAsync } = require('../middleware/errorHandler');

const WARNING_THRESHOLD_SECONDS = 2 * 60;

/**
 * GET /api/sessions/current - Estado da sessão atual
 * req.sessionTtl (inatividade) e req.sessionAbsoluteRemaining (teto de 30 min)
 * são capturados pelo requireAuth ANTES de renovar, senão o aviso de expiração
 * nunca dispararia (a própria checagem renovaria a sessão). O menor dos dois
 * determina quando a sessão realmente vai expirar.
 */
const getCurrentSession = catchAsync(async (req, res) => {
  const ttl = Math.min(req.sessionTtl, req.sessionAbsoluteRemaining);
  res.json({
    isAboutToExpire: ttl > 0 && ttl <= WARNING_THRESHOLD_SECONDS,
    expiresInSeconds: ttl,
  });
});

/**
 * POST /api/sessions/keep-alive - Mantém a sessão viva
 * requireAuth já renova o TTL em toda requisição autenticada, então essa
 * rota só precisa existir e passar pelo middleware para ter o mesmo efeito.
 */
const keepAlive = catchAsync(async (req, res) => {
  res.json({ ok: true });
});

module.exports = {
  getCurrentSession,
  keepAlive,
};
