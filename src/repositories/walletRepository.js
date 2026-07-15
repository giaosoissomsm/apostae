class WalletRepository {
  async findByUserIdForUpdate(userId, client) {
    const result = await client.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE;',
      [userId]
    );
    return result.rows[0] || null;
  }

  async adjustBalance(walletId, delta, client) {
    const result = await client.query(
      'UPDATE wallets SET balance = balance + $1 WHERE id = $2 RETURNING *;',
      [delta, walletId]
    );
    return result.rows[0];
  }

  async recordTransaction({ walletId, type, amount, balanceBefore, balanceAfter, relatedEntity, relatedId, description, adminId }, client) {
    await client.query(
      `INSERT INTO wallet_transactions
         (wallet_id, type, amount, balance_before, balance_after, related_entity, related_id, description, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
      [walletId, type, amount, balanceBefore, balanceAfter, relatedEntity || null, relatedId || null, description || null, adminId || null]
    );
  }
}

module.exports = new WalletRepository();
