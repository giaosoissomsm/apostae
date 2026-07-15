const { query } = require('../config/database');

class MarketRepository {
  // Uma query só, sem N+1 (requisitos.txt "evitar consultas N+1"): agrega as
  // opções de cada mercado via json_agg/LEFT JOIN. Mercados binary não têm
  // linhas em market_options, então recebem options: [] naturalmente — o
  // frontend deve checar market_type antes de ler options, não o contrário.
  async findAll() {
    const result = await query(`
      SELECT m.*,
        COALESCE(
          json_agg(
            json_build_object('id', mo.id, 'label', mo.label, 'odds', mo.odds, 'sort_order', mo.sort_order)
            ORDER BY mo.sort_order
          ) FILTER (WHERE mo.id IS NOT NULL),
          '[]'
        ) AS options
      FROM markets m
      LEFT JOIN market_options mo ON mo.market_id = m.id
      GROUP BY m.id
      ORDER BY m.created_at DESC;
    `);
    return result.rows;
  }

  async findById(id, client = null) {
    const runner = client || { query };
    const result = await runner.query('SELECT * FROM markets WHERE id = $1;', [id]);
    return result.rows[0] || null;
  }

  // marketType/threshold são opcionais (default 'binary'/null) — o INSERT
  // binário permanece equivalente ao comportamento atual quando marketType
  // é 'binary' e threshold é null (MARKET-03). client é opcional: sem ele
  // roda fora de transação (compat com chamadores existentes); com ele,
  // createMarket roda o INSERT do mercado e o bulk-insert das opções na
  // mesma transação.
  async create(
    { question, description, oddsYes, oddsNo, marketType = 'binary', threshold = null, closesAt, revealAt, scheduledOutcome, createdBy },
    client = null
  ) {
    const runner = client || { query };
    const result = await runner.query(
      `INSERT INTO markets (question, description, odds_yes, odds_no, market_type, threshold, status, closes_at, reveal_at, scheduled_outcome, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10)
       RETURNING *;`,
      [question, description || '', oddsYes, oddsNo, marketType, threshold, closesAt, revealAt, scheduledOutcome, createdBy]
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

  // Equivalente de resolve() para mercados over_under/multiple_choice —
  // grava winning_option_id em vez de outcome. O chamador (marketService)
  // deve validar que winningOptionId pertence a este mercado via
  // marketOptionRepository.findByIdForMarket (MARKET-06) ANTES de chamar
  // este método; esta query não repete essa checagem.
  async resolveWithOption(id, winningOptionId, client) {
    const result = await client.query(
      `UPDATE markets SET status = 'resolved', winning_option_id = $1, resolved_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *;`,
      [winningOptionId, id]
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
