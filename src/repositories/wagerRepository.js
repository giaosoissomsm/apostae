const { query } = require('../config/database');

const SELECT_WITH_MARKET = `
  SELECT w.id, w.user_id, w.market_id, w.choice, w.option_id, w.amount, w.odds_at_time, w.potential_payout,
         w.status, w.created_at, w.resolved_at,
         m.question, m.status AS market_status, m.outcome AS market_outcome, m.market_type,
         mo.label AS option_label
  FROM wagers w
  JOIN markets m ON m.id = w.market_id
  LEFT JOIN market_options mo ON mo.id = w.option_id
`;

class WagerRepository {
  // optionId é opcional (default null). Quando presente (mercados
  // over_under/multiple_choice), choice é gravado como null — a checagem
  // XOR de banco (migração 005) é o backstop contra os dois setados/nulos
  // ao mesmo tempo. Quando ausente, o INSERT binário se comporta como antes.
  async create({ userId, marketId, choice, optionId = null, amount, oddsAtTime, potentialPayout }, client) {
    const result = await client.query(
      `INSERT INTO wagers (user_id, market_id, choice, option_id, amount, odds_at_time, potential_payout, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *;`,
      [userId, marketId, optionId ? null : choice, optionId, amount, oddsAtTime, potentialPayout]
    );
    return result.rows[0];
  }

  async findById(id, client = null) {
    const runner = client || { query };
    const result = await runner.query('SELECT * FROM wagers WHERE id = $1;', [id]);
    return result.rows[0] || null;
  }

  async findPendingByMarket(marketId, client) {
    const result = await client.query(
      "SELECT * FROM wagers WHERE market_id = $1 AND status = 'pending' FOR UPDATE;",
      [marketId]
    );
    return result.rows;
  }

  // Trava uma aposta por id com posse embutida no WHERE (market_id + user_id)
  // — IDOR-safe: um chamador nunca consegue travar/ler a aposta de outro
  // usuário adivinhando um id, porque a checagem de posse faz parte da
  // própria query de lock, não uma checagem separada depois (ver cashoutWager).
  async findByIdForUpdate(id, marketId, userId, client) {
    const result = await client.query(
      'SELECT * FROM wagers WHERE id = $1 AND market_id = $2 AND user_id = $3 FOR UPDATE;',
      [id, marketId, userId]
    );
    return result.rows[0] || null;
  }

  async updateStatus(id, status, client) {
    const result = await client.query(
      'UPDATE wagers SET status = $1, resolved_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *;',
      [status, id]
    );
    return result.rows[0] || null;
  }

  // Incrementa o total já sacado via cashout parcial (soma cumulativa, nunca
  // sobrescreve) — usado por wagerService.cashoutWager depois que o cashout
  // já foi persistido de forma idempotente (ver cashoutRepository.create).
  async incrementCashedOutAmount(id, stake, client) {
    const result = await client.query(
      'UPDATE wagers SET cashed_out_amount = cashed_out_amount + $1 WHERE id = $2 RETURNING *;',
      [stake, id]
    );
    return result.rows[0] || null;
  }

  async findByUserId(userId) {
    const result = await query(`${SELECT_WITH_MARKET} WHERE w.user_id = $1 ORDER BY w.created_at DESC;`, [userId]);
    return result.rows;
  }

  async findByUsername(username) {
    const result = await query(
      `${SELECT_WITH_MARKET}
       JOIN users u ON u.id = w.user_id
       WHERE u.username = $1 AND u.deleted_at IS NULL
       ORDER BY w.created_at DESC;`,
      [username.toLowerCase()]
    );
    return result.rows;
  }
}

module.exports = new WagerRepository();
