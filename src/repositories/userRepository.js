const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');

class UserRepository {
  /**
   * Cria novo usuário
   */
  async create(username, email, passwordHash, roleId = 1) {
    const sql = `
      INSERT INTO users (username, email, password_hash, role_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, email, role_id, is_active, created_at;
    `;
    const result = await query(sql, [username, email, passwordHash, roleId]);
    return result.rows[0];
  }

  /**
   * Busca usuário por ID
   */
  async findById(id) {
    const sql = `
      SELECT u.id, u.username, u.email, u.role_id, u.is_active,
             u.password_expires_next_login, u.last_login_at, u.created_at,
             r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1 AND u.deleted_at IS NULL;
    `;
    const result = await query(sql, [id]);
    return result.rows[0] || null;
  }

  /**
   * Busca usuário por username
   */
  async findByUsername(username) {
    const sql = `
      SELECT u.id, u.username, u.email, u.password_hash, u.role_id,
             u.is_active, u.password_expires_next_login, u.last_login_at,
             r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.username = $1 AND u.deleted_at IS NULL;
    `;
    const result = await query(sql, [username.toLowerCase()]);
    return result.rows[0] || null;
  }

  /**
   * Busca usuário por email
   */
  async findByEmail(email) {
    const sql = `
      SELECT id, username, email, password_hash, role_id, is_active
      FROM users
      WHERE email = $1 AND deleted_at IS NULL;
    `;
    const result = await query(sql, [email.toLowerCase()]);
    return result.rows[0] || null;
  }

  /**
   * Lista usuários com paginação, busca e filtros
   */
  async findAll(options = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      roleId = null,
      isActive = null,
      sortBy = 'created_at',
      sortOrder = 'DESC',
    } = options;

    const offset = (page - 1) * limit;
    const validSortBy = ['created_at', 'username', 'email', 'last_login_at'].includes(sortBy)
      ? sortBy
      : 'created_at';
    const validOrder = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder : 'DESC';

    let where = 'WHERE u.deleted_at IS NULL';
    const params = [];
    let paramIndex = 1;

    if (search) {
      where += ` AND (u.username ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (roleId !== null) {
      where += ` AND u.role_id = $${paramIndex}`;
      params.push(roleId);
      paramIndex++;
    }

    if (isActive !== null) {
      where += ` AND u.is_active = $${paramIndex}`;
      params.push(isActive);
      paramIndex++;
    }

    // Total de registros
    const countSql = `SELECT COUNT(*) as count FROM users u ${where};`;
    const countResult = await query(countSql, params);
    const total = countResult.rows[0].count;

    // Dados paginados
    const sql = `
      SELECT u.id, u.username, u.email, u.role_id, u.is_active,
             u.password_expires_next_login, u.last_login_at, u.created_at,
             r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      ${where}
      ORDER BY u.${validSortBy} ${validOrder}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;

    const dataResult = await query(sql, [...params, limit, offset]);

    return {
      data: dataResult.rows,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Atualiza dados do usuário
   */
  async update(id, data) {
    const allowed = ['email', 'is_active', 'password_expires_next_login', 'last_login_at'];
    const updates = [];
    const params = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(data)) {
      if (allowed.includes(key) && value !== undefined) {
        updates.push(`${key} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (updates.length === 0) return null;

    params.push(id);
    const sql = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex} AND deleted_at IS NULL
      RETURNING id, username, email, role_id, is_active, created_at;
    `;

    const result = await query(sql, params);
    return result.rows[0] || null;
  }

  /**
   * Altera hash de senha
   */
  async updatePassword(id, passwordHash) {
    const sql = `
      UPDATE users
      SET password_hash = $1, password_expires_next_login = false
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING id, username;
    `;
    const result = await query(sql, [passwordHash, id]);
    return result.rows[0] || null;
  }

  /**
   * Altera role/permissões
   */
  async updateRole(id, roleId) {
    const sql = `
      UPDATE users SET role_id = $1
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING id, username, role_id;
    `;
    const result = await query(sql, [roleId, id]);
    return result.rows[0] || null;
  }

  /**
   * Marca usuário como deletado (soft delete)
   */
  async softDelete(id) {
    const sql = `
      UPDATE users
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, username;
    `;
    const result = await query(sql, [id]);
    return result.rows[0] || null;
  }

  /**
   * Obtém permissões de um usuário
   */
  async getUserPermissions(userId) {
    const sql = `
      SELECT DISTINCT p.name, p.id
      FROM users u
      JOIN roles r ON u.role_id = r.id
      JOIN role_permissions rp ON r.id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE u.id = $1 AND u.deleted_at IS NULL;
    `;
    const result = await query(sql, [userId]);
    return result.rows.map(row => row.name);
  }

  /**
   * Verifica se usuário tem permissão
   */
  async hasPermission(userId, permissionName) {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permissionName);
  }

  /**
   * Busca estatísticas de usuários
   */
  async getStats() {
    const sql = `
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) as total,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_active) as active,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND NOT is_active) as inactive,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND password_expires_next_login) as need_password_change
      FROM users;
    `;
    const result = await query(sql);
    return result.rows[0];
  }
}

module.exports = new UserRepository();
