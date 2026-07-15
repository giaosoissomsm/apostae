const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { query } = require('../config/database');
const redis = require('../config/redis');
const env = require('../config/env');
const userRepository = require('../repositories/userRepository');
const { ValidationError, AuthenticationError, ConflictError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

class AuthService {
  /**
   * Registra novo usuário
   */
  async register(username, email, password) {
    // Validação básica
    if (!username || username.length < 3 || username.length > 50) {
      throw new ValidationError('Usuário deve ter 3-50 caracteres');
    }

    if (!password || password.length < 6) {
      throw new ValidationError('Senha deve ter ao menos 6 caracteres');
    }

    // Verificar existência
    const existing = await userRepository.findByUsername(username);
    if (existing) {
      throw new ConflictError('Este nome de usuário já está em uso');
    }

    if (email) {
      const emailExists = await userRepository.findByEmail(email);
      if (emailExists) {
        throw new ConflictError('Este email já está em uso');
      }
    }

    // Hash da senha (nunca armazenar em texto puro)
    const passwordHash = bcrypt.hashSync(password, env.BCRYPT_ROUNDS);

    // Cria usuário (role_id 1 = usuário comum, 2 = admin)
    const user = await userRepository.create(username, email, passwordHash, 1);

    // Cria carteira inicial
    await query(
      'INSERT INTO wallets (user_id, balance) VALUES ($1, $2);',
      [user.id, 100]
    );

    logger.info(`Novo usuário registrado: ${username}`);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
    };
  }

  /**
   * Faz login do usuário
   */
  async login(username, password, ipAddress, userAgent) {
    // Busca usuário
    const user = await userRepository.findByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new AuthenticationError('Usuário ou senha inválidos');
    }

    if (!user.is_active) {
      throw new AuthenticationError('Conta desativada');
    }

    // Cria sessão
    const sessionId = uuid();
    const sessionData = {
      userId: user.id,
      username: user.username,
      roleId: user.role_id,
      createdAt: Date.now(),
    };

    // Armazena sessão no Redis (renovada a cada request por inatividade;
    // createdAt fixa o teto absoluto verificado em requireAuth)
    await redis.setex(
      `session:${sessionId}`,
      env.SESSION_TIMEOUT / 1000,
      JSON.stringify(sessionData)
    );

    // Gera JWT com sessionId
    const token = jwt.sign(
      { userId: user.id, sessionId },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    // Registra na auditoria
    await query(
      `INSERT INTO audit_logs (action, target_user_id, ip_address, details)
       VALUES ($1, $2, $3, $4);`,
      ['login', user.id, ipAddress, `Login: ${userAgent}`]
    );

    // Atualiza last_login_at
    await userRepository.update(user.id, { last_login_at: new Date() });

    logger.info(`Login bem-sucedido: ${username}`);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roleId: user.role_id,
        password_expires_next_login: user.password_expires_next_login,
      },
    };
  }

  /**
   * Logout do usuário
   */
  async logout(sessionId, userId, ipAddress) {
    // Invalida sessão no Redis
    await redis.del(`session:${sessionId}`);

    // Registra na auditoria
    await query(
      `INSERT INTO audit_logs (action, target_user_id, ip_address)
       VALUES ($1, $2, $3);`,
      ['logout', userId, ipAddress]
    );

    logger.info(`Logout: ${userId}`);
  }

  /**
   * Muda senha do usuário
   */
  async changePassword(userId, currentPassword, newPassword) {
    if (!newPassword || newPassword.length < 6) {
      throw new ValidationError('Senha deve ter ao menos 6 caracteres');
    }

    if (currentPassword === newPassword) {
      throw new ValidationError('Nova senha não pode ser igual à anterior');
    }

    // Busca usuário com hash
    const result = await query(
      'SELECT id, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL;',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Usuário não encontrado');
    }

    const user = result.rows[0];

    // Valida senha atual
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      throw new AuthenticationError('Senha atual incorreta');
    }

    // Hash da nova senha
    const newHash = bcrypt.hashSync(newPassword, env.BCRYPT_ROUNDS);

    // Atualiza
    await userRepository.updatePassword(userId, newHash);

    // Invalida todas as outras sessões do usuário
    const keys = await redis.client.keys(`session:*`);
    for (const key of keys) {
      const data = await redis.get(key);
      if (data && data.userId === userId) {
        await redis.del(key);
      }
    }

    logger.info(`Senha alterada: ${userId}`);

    return { ok: true };
  }

  /**
   * Admin altera senha de outro usuário
   */
  async adminChangePassword(adminId, targetUserId, newPassword, ipAddress) {
    if (!newPassword || newPassword.length < 6) {
      throw new ValidationError('Senha deve ter ao menos 6 caracteres');
    }

    // Verifica que não é auto-modificação
    if (adminId === targetUserId) {
      throw new ValidationError('Use a rota de perfil para alterar sua própria senha');
    }

    // Busca usuário alvo
    const target = await userRepository.findById(targetUserId);
    if (!target) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Hash e atualiza
    const newHash = bcrypt.hashSync(newPassword, env.BCRYPT_ROUNDS);
    await userRepository.updatePassword(targetUserId, newHash);

    // Invalida todas as sessões do usuário
    const keys = await redis.client.keys(`session:*`);
    for (const key of keys) {
      const data = await redis.get(key);
      if (data && data.userId === targetUserId) {
        await redis.del(key);
      }
    }

    // Registra na auditoria
    await query(
      `INSERT INTO audit_logs (action, admin_id, target_user_id, ip_address, details)
       VALUES ($1, $2, $3, $4, $5);`,
      ['admin_change_password', adminId, targetUserId, ipAddress, 'Administrador alterou senha do usuário']
    );

    logger.info(`Admin ${adminId} alterou senha de ${targetUserId}`);

    return { ok: true };
  }

  /**
   * Força mudança de senha no próximo login
   */
  async forcePasswordChange(adminId, targetUserId, enabled, ipAddress) {
    if (adminId === targetUserId) {
      throw new ValidationError('Você não pode forçar mudança de senha em si mesmo');
    }

    const target = await userRepository.findById(targetUserId);
    if (!target) {
      throw new NotFoundError('Usuário não encontrado');
    }

    await userRepository.update(targetUserId, {
      password_expires_next_login: enabled,
    });

    // Registra auditoria
    await query(
      `INSERT INTO audit_logs (action, admin_id, target_user_id, ip_address, details)
       VALUES ($1, $2, $3, $4, $5);`,
      [
        'admin_force_password_change',
        adminId,
        targetUserId,
        ipAddress,
        enabled ? 'Forçou mudança de senha' : 'Removeu força de mudança de senha',
      ]
    );

    logger.info(`Admin ${adminId} ${enabled ? 'forçou' : 'removeu força'} mudança de senha de ${targetUserId}`);

    return { ok: true };
  }
}

module.exports = new AuthService();
