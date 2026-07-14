const wagerService = require('../services/wagerService');
const { catchAsync } = require('../middleware/errorHandler');

/**
 * POST /api/wagers - registra uma aposta
 */
const placeWager = catchAsync(async (req, res) => {
  const wager = await wagerService.placeWager(req.user.id, req.body);
  res.status(201).json(wager);
});

/**
 * DELETE /api/wagers/:id - cancela a própria aposta
 */
const cancelWager = catchAsync(async (req, res) => {
  const result = await wagerService.cancelWager(Number(req.params.id), req.user.id);
  res.json(result);
});

/**
 * GET /api/wagers/user/:username - lista as apostas de um usuário (visível a qualquer logado)
 */
const getUserWagers = catchAsync(async (req, res) => {
  const wagers = await wagerService.getWagersByUsername(req.params.username);
  res.json(wagers);
});

/**
 * POST /api/wagers/:id/cashout - solicita cashout parcial da própria aposta
 */
const cashoutWager = catchAsync(async (req, res) => {
  const { amount, idempotency_key } = req.body;
  const result = await wagerService.cashoutWager(Number(req.params.id), req.user.id, {
    amount,
    idempotencyKey: idempotency_key,
  });
  res.json(result);
});

module.exports = {
  placeWager,
  cancelWager,
  getUserWagers,
  cashoutWager,
};
