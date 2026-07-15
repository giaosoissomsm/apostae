const { query, transaction } = require('../config/database');
const redis = require('../config/redis');
const userRepository = require('../repositories/userRepository');
const wagerRepository = require('../repositories/wagerRepository');
const walletRepository = require('../repositories/walletRepository');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/errors');
const logger = require('../utils/logger');

class UserService {
  /**
   * Lista todos os usuários com paginação e filtros
   */
  async listUsers(options = {}) {
    const result = await userRepository.findAll(options);
    
    // Remove dados sensíveis
    const users = result.data.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role_name: user.role_name,
      is_active: user.is_active,
      password_expires_next_login: user.password_expires_next_login,
      last_login_at: user.last_login_at,
      created_at: user.created_at,
    }));

    return {
      users,
      pagination: result.pagination,
    };
  }

  /**
   * Obtém dados de um usuário
   */
  async getUser(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Remove dados sensíveis
    delete user.password_hash;

    const walletResult = await query('SELECT balance FROM wallets WHERE user_id = $1;', [userId]);
    user.credits = walletResult.rows[0] ? Number(walletResult.rows[0].balance) : 0;

    return user;
  }

  /**
   * Lista as apostas do próprio usuário
   */
  async getMyWagers(userId) {
    return wagerRepository.findByUserId(userId);
  }

  /**
   * Busca usuários
   */
  async searchUsers(query) {
    if (!query || query.length < 2) {
      throw new ValidationError('Busca deve ter ao menos 2 caracteres');
    }

    const result = await userRepository.findAll({
      search: query,
      limit: 20,
    });

    return result.data.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role_name: user.role_name,
    }));
  }

  /**
   * Ativa/desativa usuário
   */
  async setActive(userId, isActive, adminId, ipAddress) {
    if (adminId === userId) {
      throw new ValidationError('Você não pode desativar sua própria conta');
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuário não encontrado');
    }

    await userRepository.update(userId, { is_active: isActive });

    // Invalida sessões se desativando
    if (!isActive) {
      const keys = await redis.client.keys(`session:*`);
      for (const key of keys) {
        const data = await redis.get(key);
        if (data && data.userId === userId) {
          await redis.del(key);
        }
      }
    }

    // Auditoria
    await query(
      `INSERT INTO audit_logs (action, admin_id, target_user_id, ip_address, details)
       VALUES ($1, $2, $3, $4, $5);`,
      ['admin_set_active', adminId, userId, ipAddress, isActive ? 'Ativou usuário' : 'Desativou usuário']
    );

    logger.info(`Admin ${adminId} ${isActive ? 'ativou' : 'desativou'} usuário ${userId}`);

    return { ok: true };
  }

  /**
   * Altera role/permissões do usuário
   */
  async setRole(userId, roleId, adminId, ipAddress) {
    if (adminId === userId) {
      throw new ValidationError('Você não pode alterar seu próprio role');
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Valida role existe
    const roleResult = await query('SELECT id FROM roles WHERE id = $1;', [roleId]);
    if (roleResult.rows.length === 0) {
      throw new NotFoundError('Role não encontrado');
    }

    await userRepository.updateRole(userId, roleId);

    // Auditoria
    await query(
      `INSERT INTO audit_logs (action, admin_id, target_user_id, ip_address, details)
       VALUES ($1, $2, $3, $4, $5);`,
      ['admin_set_role', adminId, userId, ipAddress, `Alterou role para ${roleId}`]
    );

    logger.info(`Admin ${adminId} alterou role do usuário ${userId} para ${roleId}`);

    return { ok: true };
  }

  /**
   * Ajusta saldo (crédito ou débito) da carteira de um usuário — correção
   * administrativa. Nunca faz mutação direta de balance: tudo passa por
   * walletRepository.adjustBalance dentro de uma transação, com o wallet
   * travado (FOR UPDATE) e um registro de movimentação + auditoria gravados
   * atomicamente junto da mudança de saldo.
   * @param {number} userId - Usuário alvo do ajuste
   * @param {'credit'|'debit'} type - Direção do ajuste
   * @param {number} amount - Valor positivo do ajuste (magnitude, não delta)
   * @param {string} description - Motivo do ajuste (obrigatório, vira audit trail)
   * @param {number} adminId - Admin que está realizando o ajuste
   * @param {string} ipAddress - IP de origem da requisição
   */
  async adjustUserBalance(userId, type, amount, description, adminId, ipAddress) {
    if (type !== 'credit' && type !== 'debit') {
      throw new ValidationError('type deve ser credit ou debit');
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError('Valor deve ser um número positivo');
    }

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      throw new ValidationError('Motivo é obrigatório');
    }
    const trimmedDescription = description.trim();

    // IDOR guard: alvo precisa existir. Auto-ajuste é permitido (decisão do
    // CONTEXT) — diferente de setActive/setRole/deleteUser, não há guarda
    // adminId === userId aqui.
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuário não encontrado');
    }

    const newBalance = await transaction(async (client) => {
      const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
      if (!wallet) {
        throw new NotFoundError('Carteira não encontrada');
      }

      const delta = type === 'credit' ? amount : -amount;

      // Débito precisa ser validado ANTES do UPDATE, dentro do lock, pra
      // nunca deixar o CHECK (balance >= 0) do Postgres estourar como erro
      // genérico — vira um ValidationError limpo em vez disso.
      if (type === 'debit' && Number(wallet.balance) < amount) {
        throw new ValidationError('Saldo insuficiente para o débito');
      }

      const balanceBefore = wallet.balance;
      const updated = await walletRepository.adjustBalance(wallet.id, delta, client);

      // Movimentação NUNCA é mutação direta de balance — sempre passa por
      // recordTransaction, com amount sempre positivo (CHECK amount > 0);
      // a direção credit/debit fica registrada em balance_before/balance_after.
      await walletRepository.recordTransaction(
        {
          walletId: wallet.id,
          type: 'correction',
          amount,
          balanceBefore,
          balanceAfter: updated.balance,
          relatedEntity: 'admin_adjustment',
          description: trimmedDescription,
          adminId,
        },
        client
      );

      // Auditoria gravada no MESMO client — commit/rollback atômico junto
      // da mudança de saldo.
      await client.query(
        `INSERT INTO audit_logs (action, admin_id, target_user_id, ip_address, changes, details)
         VALUES ($1, $2, $3, $4, $5, $6);`,
        [
          'admin_adjust_balance',
          adminId,
          userId,
          ipAddress,
          JSON.stringify({ type, amount, balance_before: balanceBefore, balance_after: updated.balance }),
          trimmedDescription,
        ]
      );

      return updated.balance;
    });

    logger.info(`Admin ${adminId} ajustou saldo do usuário ${userId} (${type} de ${amount}) — novo saldo: ${newBalance}`);

    return { ok: true, balance: newBalance };
  }

  /**
   * Deleta usuário (soft delete)
   */
  async deleteUser(userId, adminId, ipAddress) {
    if (adminId === userId) {
      throw new ValidationError('Você não pode deletar sua própria conta');
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Verifica se criou mercados
    const marketResult = await query(
      'SELECT COUNT(*) as count FROM markets WHERE created_by = $1;',
      [userId]
    );

    if (marketResult.rows[0].count > 0) {
      throw new ConflictError(
        'Usuário criou mercados. Desative a conta em vez de deletar para preservar histórico.'
      );
    }

    await userRepository.softDelete(userId);

    // Invalida sessões
    const keys = await redis.client.keys(`session:*`);
    for (const key of keys) {
      const data = await redis.get(key);
      if (data && data.userId === userId) {
        await redis.del(key);
      }
    }

    // Auditoria
    await query(
      `INSERT INTO audit_logs (action, admin_id, target_user_id, ip_address)
       VALUES ($1, $2, $3, $4);`,
      ['admin_delete_user', adminId, userId, ipAddress]
    );

    logger.info(`Admin ${adminId} deletou usuário ${userId}`);

    return { ok: true };
  }

  /**
   * Obtém estatísticas de usuários
   */
  async getStats() {
    return await userRepository.getStats();
  }

  /**
   * Obtém logs de auditoria
   */
  async getAuditLogs(options = {}) {
    const { page = 1, limit = 50, userId = null } = options;
    const offset = (page - 1) * limit;

    let where = '';
    const params = [];

    if (userId) {
      where = 'WHERE admin_id = $1 OR target_user_id = $1';
      params.push(userId);
    }

    // Count
    const countSql = `SELECT COUNT(*) as count FROM audit_logs ${where};`;
    const countResult = await query(countSql, params);
    const total = countResult.rows[0].count;

    // Data
    const dataSql = `
      SELECT id, action, admin_id, target_user_id, ip_address, details, created_at
      FROM audit_logs
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;

    const dataResult = await query(dataSql, [...params, limit, offset]);

    return {
      logs: dataResult.rows,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }
}

module.exports = new UserService();
