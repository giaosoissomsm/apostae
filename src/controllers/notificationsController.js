const notificationService = require('../services/notificationService');
const { catchAsync } = require('../middleware/errorHandler');

/**
 * GET /api/notifications - lista as notificações do usuário autenticado
 * (paginado, mais recentes primeiro). Identidade vem sempre de req.user.id
 * (JWT) — nunca de query/params/body (NOTIF-08).
 */
const listMyNotifications = catchAsync(async (req, res) => {
  const { page, limit, unread_only } = req.query;
  const result = await notificationService.listForUser(req.user.id, {
    page: Number(page) || 1,
    limit: Number(limit) || 20,
    unreadOnly: unread_only === 'true',
  });
  res.json(result);
});

/**
 * GET /api/notifications/unread-count - contagem de notificações não lidas
 * do usuário autenticado.
 */
const getUnreadCount = catchAsync(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.user.id);
  res.json({ count });
});

/**
 * PATCH /api/notifications/:id/read - marca a notificação como lida.
 * Escopado por req.user.id; id de outro usuário (ou inexistente) resulta em
 * 404, nunca 403, pra não vazar existência (NOTIF-08, Pattern 4).
 */
const markRead = catchAsync(async (req, res) => {
  const updated = await notificationService.markRead(Number(req.params.id), req.user.id);
  res.json(updated);
});

module.exports = {
  listMyNotifications,
  getUnreadCount,
  markRead,
};
