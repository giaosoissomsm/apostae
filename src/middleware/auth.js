const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const redis = require('../config/redis');
const env = require('../config/env');
const { AuthenticationError, AuthorizationError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Middleware de autenticação
 * Valida JWT + sessão + permissões
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationError('Token ausente');
    }

    // Valida JWT
    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      throw new AuthenticationError('Token inválido ou expirado');
    }

    // Valida sessão no Redis
    const sessionId = payload.sessionId;
    const sessionData = await redis.get(`session:${sessionId}`);
    
    if (!sessionData) {
      throw new AuthenticationError('Sessão expirada ou invalidada');
    }

    // Busca usuário no banco (valida que não foi desativado/deletado)
    const userResult = await query(
      `SELECT id, username, email, role_id, is_active, password_expires_next_login
       FROM users WHERE id = $1 AND deleted_at IS NULL;`,
      [payload.userId]
    );

    if (userResult.rows.length === 0) {
      throw new NotFoundError('Usuário não encontrado');
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      throw new AuthorizationError('Conta desativada');
    }

    // Bloqueia se precisa mudar senha (exceto rotas específicas)
    const isPasswordChangeRoute = 
      req.path === '/api/auth/change-password-required' ||
      req.path === '/password-expires.html';

    if (user.password_expires_next_login && !isPasswordChangeRoute) {
      return res.status(403).json({
        error: 'password_expires_next_login',
        message: 'Você precisa alterar sua senha',
      });
    }

    // Atualiza atividade no Redis
    await redis.setex(`session:${sessionId}`, 1800, JSON.stringify({
      userId: user.id,
      username: user.username,
      roleId: user.role_id,
    }));

    // Anexa ao request
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      roleId: user.role_id,
      isActive: user.is_active,
    };
    req.sessionId = sessionId;

    next();
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    logger.error('Erro ao autenticar', err.message);
    res.status(500).json({ error: 'Erro ao processar autenticação' });
  }
}

/**
 * Middleware para verificar permissão
 */
async function requirePermission(permissionName) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Autenticação necessária');
      }

      // Busca permissões do usuário
      const result = await query(
        `SELECT DISTINCT p.name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         JOIN role_permissions rp ON r.id = rp.role_id
         JOIN permissions p ON rp.permission_id = p.id
         WHERE u.id = $1;`,
        [req.user.id]
      );

      const permissions = result.rows.map(row => row.name);

      if (!permissions.includes(permissionName)) {
        throw new AuthorizationError(`Permissão "${permissionName}" não concedida`);
      }

      req.permissions = permissions;
      next();
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      logger.error('Erro ao verificar permissão', err.message);
      res.status(500).json({ error: 'Erro ao verificar permissões' });
    }
  };
}

/**
 * Helper: verificar se é admin (role_id = 2)
 */
async function requireAdmin(req, res, next) {
  try {
    if (!req.user) {
      throw new AuthenticationError('Autenticação necessária');
    }

    const result = await query(
      `SELECT role_id FROM users WHERE id = $1 AND deleted_at IS NULL;`,
      [req.user.id]
    );

    if (result.rows.length === 0 || result.rows[0].role_id !== 2) {
      throw new AuthorizationError('Privilégio de administrador necessário');
    }

    next();
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    logger.error('Erro ao verificar admin', err.message);
    res.status(500).json({ error: 'Erro ao verificar privilégios' });
  }
}

module.exports = {
  requireAuth,
  requirePermission,
  requireAdmin,
};
