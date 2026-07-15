const { query } = require('../config/database');

class MarketOptionRepository {
  /**
   * Trava uma opção por id com posse embutida no WHERE (market_id) — único
   * ponto de checagem de posse do sistema (MARKET-06). IDOR-safe: um
   * chamador nunca consegue travar/ler a opção de outro mercado adivinhando
   * um id, porque a checagem de posse faz parte da própria query de lock,
   * não uma checagem separada depois (mesmo padrão de
   * wagerRepository.findByIdForUpdate). NUNCA criar um método que busque
   * opção só por id para um caminho vindo do cliente.
   * @param {number} id - id da opção.
   * @param {number} marketId - id do mercado dono da opção.
   * @param {object} [client] - client de transação opcional; sem ele roda
   *   fora de transação (o FOR UPDATE ainda é válido, apenas libera a trava
   *   ao final do statement).
   * @returns {Promise<object|null>} a opção, ou null se não existir ou não
   *   pertencer a esse mercado.
   */
  async findByIdForMarket(id, marketId, client = null) {
    const runner = client || { query };
    const result = await runner.query(
      'SELECT * FROM market_options WHERE id = $1 AND market_id = $2 FOR UPDATE;',
      [id, marketId]
    );
    return result.rows[0] || null;
  }

  /**
   * Insere N opções de uma vez para um mercado, dentro da transação de
   * criação do mercado (sempre recebe `client`, nunca usa o `query` solto —
   * ver walletRepository.recordTransaction). Os placeholders posicionais são
   * gerados a partir do índice do array — label/odds NUNCA são
   * concatenados na string SQL (proteção contra injection).
   * @param {number} marketId - id do mercado dono das opções.
   * @param {Array<{label: string, odds: number, sortOrder?: number}>} options
   * @param {object} client - client de transação (obrigatório).
   * @returns {Promise<object[]>} as opções inseridas, na ordem enviada.
   */
  async createMany(marketId, options, client) {
    const values = [];
    const placeholders = options.map((opt, i) => {
      const base = i * 4;
      values.push(marketId, opt.label, opt.odds, opt.sortOrder != null ? opt.sortOrder : i);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });

    const result = await client.query(
      `INSERT INTO market_options (market_id, label, odds, sort_order)
       VALUES ${placeholders.join(', ')}
       RETURNING *;`,
      values
    );
    return result.rows;
  }

  /**
   * Lista as opções de um mercado, ordenadas para exibição.
   * @param {number} marketId
   * @param {object} [client] - client de transação opcional.
   * @returns {Promise<object[]>}
   */
  async findByMarketId(marketId, client = null) {
    const runner = client || { query };
    const result = await runner.query(
      'SELECT * FROM market_options WHERE market_id = $1 ORDER BY sort_order;',
      [marketId]
    );
    return result.rows;
  }
}

module.exports = new MarketOptionRepository();
