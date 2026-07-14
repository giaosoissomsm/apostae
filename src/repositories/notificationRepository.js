const { query } = require('../config/database');

class NotificationRepository {
  // Insere uma notificação. Sem transação (grava é desacoplada da ação que
  // disparou o evento por design — ver D-01). Uma segunda chamada com a
  // mesma (userId, type, relatedEntity, relatedId) colide com a constraint
  // UNIQUE e lança um erro com `.code === '23505'`; quem chama decide o que
  // fazer com isso (notificationService trata como idempotência).
  async create({ userId, type, title, body, relatedEntity, relatedId }) {
    const result = await query(
      `INSERT INTO notifications (user_id, type, title, body, related_entity, related_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *;`,
      [userId, type, title, body || null, relatedEntity || null, relatedId || null]
    );
    return result.rows[0];
  }

  // Sempre filtrada por user_id (NOTIF-08). limit é hard-capped em 100
  // independente do que o cliente pedir (T-01-04).
  async findByUserId(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
    const cappedLimit = Math.min(Number(limit) || 20, 100);
    const currentPage = Math.max(Number(page) || 1, 1);
    const offset = (currentPage - 1) * cappedLimit;

    // Fragmento fixo (nunca interpola valor vindo do cliente) — ou está
    // presente ou não está, nunca contém dado do usuário.
    const unreadFrag = unreadOnly ? 'AND read_at IS NULL' : '';

    const dataResult = await query(
      `SELECT * FROM notifications
       WHERE user_id = $1 ${unreadFrag}
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3;`,
      [userId, cappedLimit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1 ${unreadFrag};`,
      [userId]
    );

    return {
      data: dataResult.rows,
      pagination: {
        total: Number(countResult.rows[0].count),
        page: currentPage,
        limit: cappedLimit,
      },
    };
  }

  // Marca como lida só se a linha pertence a userId e ainda não foi lida
  // (posse + idempotência embutidas no WHERE). Retorna null se não achou
  // (não existe, não é do usuário, ou já estava lida) — o service decide
  // o que fazer com cada caso.
  async markRead(id, userId) {
    const result = await query(
      `UPDATE notifications
       SET read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND read_at IS NULL
       RETURNING *;`,
      [id, userId]
    );
    return result.rows[0] || null;
  }

  // Busca por id só retorna a linha se ela pertencer a userId (NOTIF-08).
  async findById(id, userId) {
    const result = await query(
      'SELECT * FROM notifications WHERE id = $1 AND user_id = $2;',
      [id, userId]
    );
    return result.rows[0] || null;
  }

  async countUnread(userId) {
    const result = await query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL;',
      [userId]
    );
    return Number(result.rows[0].count);
  }
}

module.exports = new NotificationRepository();
