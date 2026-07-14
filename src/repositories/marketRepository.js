const { query } = require('../config/database');

class MarketRepository {
  async findAll() {
    const result = await query('SELECT * FROM markets ORDER BY created_at DESC;');
    return result.rows;
  }

  async findById(id, client = null) {
    const runner = client || { query };
    const result = await runner.query('SELECT * FROM markets WHERE id = $1;', [id]);
    return result.rows[0] || null;
  }

  async create({ question, description, oddsYes, oddsNo, closesAt, revealAt, scheduledOutcome, createdBy }) {
    const result = await query(
      `INSERT INTO markets (question, description, odds_yes, odds_no, status, closes_at, reveal_at, scheduled_outcome, created_by)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8)
       RETURNING *;`,
      [question, description || '', oddsYes, oddsNo, closesAt, revealAt, scheduledOutcome, createdBy]
    );
    return result.rows[0];
  }

  async updateStatus(id, status, client = null) {
    const runner = client || { query };
    const result = await runner.query(
      'UPDATE markets SET status = $1 WHERE id = $2 RETURNING *;',
      [status, id]
    );
    return result.rows[0] || null;
  }

  async resolve(id, outcome, client) {
    const result = await client.query(
      `UPDATE markets SET status = 'resolved', outcome = $1, resolved_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *;`,
      [outcome, id]
    );
    return result.rows[0] || null;
  }

  // Trava um mercado por id (DRY da query `SELECT ... FOR UPDATE` hoje
  // duplicada inline em placeWager/cancelWager/resolveMarket/deleteMarket).
  async findByIdForUpdate(id, client) {
    const result = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [id]);
    return result.rows[0] || null;
  }

  async delete(id, client) {
    const result = await client.query('DELETE FROM markets WHERE id = $1 RETURNING id;', [id]);
    return result.rows[0] || null;
  }

  async findDueToClose() {
    const result = await query(
      `SELECT id FROM markets
       WHERE status = 'open' AND closes_at IS NOT NULL AND closes_at <= CURRENT_TIMESTAMP;`
    );
    return result.rows;
  }

  async findDueToReveal() {
    const result = await query(
      `SELECT id, scheduled_outcome FROM markets
       WHERE status != 'resolved' AND reveal_at IS NOT NULL AND scheduled_outcome IS NOT NULL
         AND reveal_at <= CURRENT_TIMESTAMP;`
    );
    return result.rows;
  }
}

module.exports = new MarketRepository();
