const marketService = require('../services/marketService');
const { catchAsync } = require('../middleware/errorHandler');
const { ValidationError } = require('../utils/errors');

/**
 * GET /api/markets - lista todos os mercados (qualquer usuário logado)
 */
const listMarkets = catchAsync(async (req, res) => {
  const markets = await marketService.listMarkets(req.user.roleId === 2);
  res.json(markets);
});

/**
 * POST /api/markets - admin cria mercado
 */
const createMarket = catchAsync(async (req, res) => {
  const market = await marketService.createMarket(req.body, req.user.id);
  res.status(201).json(market);
});

/**
 * PUT /api/markets/:id/status - admin fecha apostas manualmente (sem resolver ainda)
 */
const updateMarketStatus = catchAsync(async (req, res) => {
  const { status } = req.body || {};
  if (status !== 'closed') {
    throw new ValidationError("Só é possível fechar um mercado por essa rota (status: 'closed').");
  }
  const market = await marketService.closeMarket(Number(req.params.id));
  res.json(market);
});

/**
 * PUT /api/markets/:id/resolve - admin define o resultado e paga quem acertou.
 * binary: { outcome: 'yes'|'no' }. over_under/multiple_choice: { winning_option_id }.
 * Destructure-and-forward explícito — nunca spread de req.body (mass assignment,
 * T-03-21) — o service decide qual dos dois campos é válido conforme o
 * market_type do mercado travado.
 */
const resolveMarket = catchAsync(async (req, res) => {
  const { outcome, winning_option_id } = req.body || {};
  const market = await marketService.resolveMarket(Number(req.params.id), outcome, winning_option_id);
  res.json(market);
});

/**
 * DELETE /api/markets/:id - admin deleta o mercado (reembolsa apostas pendentes)
 */
const deleteMarket = catchAsync(async (req, res) => {
  const result = await marketService.deleteMarket(Number(req.params.id));
  res.json(result);
});

module.exports = {
  listMarkets,
  createMarket,
  updateMarketStatus,
  resolveMarket,
  deleteMarket,
};
