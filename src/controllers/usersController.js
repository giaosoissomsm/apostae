const userService = require('../services/userService');
const { catchAsync } = require('../middleware/errorHandler');
const { ValidationError } = require('../utils/errors');

/**
 * GET /api/users - Lista usuários com paginação
 */
const listUsers = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search = '',
    roleId = null,
    isActive = null,
    sortBy = 'created_at',
    sortOrder = 'DESC',
  } = req.query;

  if (limit > 100) {
    throw new ValidationError('Limite máximo de 100 usuários por página');
  }

  const result = await userService.listUsers({
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    search,
    roleId: roleId ? parseInt(roleId, 10) : null,
    isActive: isActive === 'true' ? true : isActive === 'false' ? false : null,
    sortBy,
    sortOrder,
  });

  res.json(result);
});

/**
 * GET /api/users/me - Dados do usuário atual
 */
const getMe = catchAsync(async (req, res) => {
  const user = await userService.getUser(req.user.id);
  res.json(user);
});

/**
 * GET /api/users/:id - Dados de um usuário específico
 */
const getUser = catchAsync(async (req, res) => {
  const user = await userService.getUser(parseInt(req.params.id, 10));
  res.json(user);
});

/**
 * GET /api/users/search/:query - Busca usuários
 */
const searchUsers = catchAsync(async (req, res) => {
  const users = await userService.searchUsers(req.params.query);
  res.json(users);
});

/**
 * PUT /api/users/:id/status - Ativa/desativa usuário
 */
const setUserStatus = catchAsync(async (req, res) => {
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    throw new ValidationError('is_active deve ser true ou false');
  }

  const result = await userService.setActive(
    parseInt(req.params.id, 10),
    is_active,
    req.user.id,
    req.ip
  );

  res.json(result);
});

/**
 * PUT /api/users/:id/role - Altera role do usuário
 */
const setUserRole = catchAsync(async (req, res) => {
  const { role_id } = req.body;

  if (!role_id || typeof role_id !== 'number') {
    throw new ValidationError('role_id deve ser um número');
  }

  const result = await userService.setRole(
    parseInt(req.params.id, 10),
    role_id,
    req.user.id,
    req.ip
  );

  res.json(result);
});

/**
 * DELETE /api/users/:id - Deleta usuário
 */
const deleteUser = catchAsync(async (req, res) => {
  const result = await userService.deleteUser(
    parseInt(req.params.id, 10),
    req.user.id,
    req.ip
  );

  res.json(result);
});

/**
 * GET /api/users/stats/overview - Estatísticas de usuários
 */
const getUserStats = catchAsync(async (req, res) => {
  const stats = await userService.getStats();
  res.json(stats);
});

/**
 * GET /api/audit-logs - Logs de auditoria
 */
const getAuditLogs = catchAsync(async (req, res) => {
  const { page = 1, limit = 50, userId = null } = req.query;

  const result = await userService.getAuditLogs({
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    userId: userId ? parseInt(userId, 10) : null,
  });

  res.json(result);
});

module.exports = {
  listUsers,
  getMe,
  getUser,
  searchUsers,
  setUserStatus,
  setUserRole,
  deleteUser,
  getUserStats,
  getAuditLogs,
};
