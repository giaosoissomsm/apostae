const express = require('express');
const usersController = require('../controllers/usersController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * Usuário atual
 */
router.get('/me', requireAuth, usersController.getMe);

/**
 * Admin: Listar todos os usuários
 */
router.get('/', requireAuth, requireAdmin, usersController.listUsers);

/**
 * Admin: Buscar usuários
 */
router.get('/search/:query', requireAuth, requireAdmin, usersController.searchUsers);

/**
 * Admin: Estatísticas
 */
router.get('/stats/overview', requireAuth, requireAdmin, usersController.getUserStats);

/**
 * Admin: Obter usuário específico
 */
router.get('/:id', requireAuth, requireAdmin, usersController.getUser);

/**
 * Admin: Alterar status (ativo/inativo)
 */
router.put('/:id/status', requireAuth, requireAdmin, usersController.setUserStatus);

/**
 * Admin: Alterar role
 */
router.put('/:id/role', requireAuth, requireAdmin, usersController.setUserRole);

/**
 * Admin: Deletar usuário
 */
router.delete('/:id', requireAuth, requireAdmin, usersController.deleteUser);

/**
 * Admin: Logs de auditoria
 */
router.get('/audit-logs/list', requireAuth, requireAdmin, usersController.getAuditLogs);

module.exports = router;
