class CashoutRepository {
  // Insere um cashout parcial. SEMPRE roda dentro da transação de
  // wagerService.cashoutWager (recebe `client` como último parâmetro, nunca
  // usa o `query` solto — ver walletRepository.recordTransaction). Uma
  // segunda chamada com a mesma (wagerId, idempotencyKey) colide com a
  // constraint UNIQUE(wager_id, idempotency_key) e lança um erro com
  // `.code === '23505'`; este método NÃO trata esse erro — quem chama
  // (wagerService, não este repository) decide o que fazer com a
  // idempotência, no mesmo espírito de notificationRepository.create.
  async create({ wagerId, userId, stakeCashedOut, grossValue, feeAmount, netValue, idempotencyKey }, client) {
    const result = await client.query(
      `INSERT INTO wager_cashouts
         (wager_id, user_id, stake_cashed_out, gross_value, fee_amount, net_value, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *;`,
      [wagerId, userId, stakeCashedOut, grossValue, feeAmount, netValue, idempotencyKey]
    );
    return result.rows[0];
  }

  // Busca o cashout já commitado para uma (wagerId, idempotencyKey) —
  // usado pelo service para reproduzir o resultado de uma requisição
  // repetida (CASHOUT-07), sem reaplicar o crédito na carteira.
  async findByIdempotencyKey(wagerId, idempotencyKey, client) {
    const result = await client.query(
      'SELECT * FROM wager_cashouts WHERE wager_id = $1 AND idempotency_key = $2;',
      [wagerId, idempotencyKey]
    );
    return result.rows[0] || null;
  }
}

module.exports = new CashoutRepository();
