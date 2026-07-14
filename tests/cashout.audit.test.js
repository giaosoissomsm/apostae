// Requisitos cobertos: CASHOUT-08 — todo cashout bem-sucedido produz
// exatamente uma linha em wallet_transactions (type='credit',
// related_entity='cashout', related_id=<id do cashout>) cujo `amount`
// reconcilia exatamente com o netValue devolvido, e cujo
// balance_before/balance_after reconciliam exatamente com o saldo real da
// carteira — provando que o saldo só é alterado através do movimento
// registrado (walletRepository.adjustBalance + recordTransaction), nunca
// por uma UPDATE bruta que contorne o repositório. A checagem estática
// (grep, sem depender de rede/DB) que confirma a ausência de uma
// `UPDATE wallets` bruta dentro da região de cashoutWager vive no bloco
// <verify> deste plano, não neste arquivo.

const {
  applyBaseSchema,
  applyWalletSchema,
  applyCashoutMigration,
  seedTestUser,
  seedWallet,
  seedOpenMarket,
  seedWager,
  closePool,
} = require('./helpers/testDb');
const { query } = require('../src/config/database');
const wagerService = require('../src/services/wagerService');

describe('trilha de auditoria do cashout (CASHOUT-08)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cashout_audit_user');
  });

  afterAll(async () => {
    await closePool();
  });

  test('cashout bem-sucedido produz exatamente uma linha wallet_transactions que reconcilia com o saldo real', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2 });
    const walletId = await seedWallet(userId, 500);

    const result = await wagerService.cashoutWager(wagerId, userId, { amount: 30, idempotencyKey: 'audit-key' });

    const txRows = await query(
      "SELECT * FROM wallet_transactions WHERE related_entity = 'cashout' AND related_id = $1;",
      [result.cashout.id]
    );
    expect(txRows.rows).toHaveLength(1);
    const tx = txRows.rows[0];

    expect(tx.type).toBe('credit');
    expect(Number(tx.amount)).toBe(result.netValue);

    // balance_before/balance_after bracketam exatamente o saldo inicial
    // conhecido e o netValue creditado — sem drift.
    expect(Number(tx.balance_before)).toBe(500);
    expect(Number(tx.balance_after)).toBe(500 + result.netValue);

    // O saldo real da carteira só pode ter mudado através do movimento
    // registrado acima — nunca por uma UPDATE bruta que contorne
    // walletRepository.
    const walletRow = await query('SELECT balance FROM wallets WHERE id = $1;', [walletId]);
    expect(Number(walletRow.rows[0].balance)).toBe(Number(tx.balance_before) + Number(tx.amount));
  });

  test('duas linhas wallet_transactions são geradas para dois cashouts distintos, cada uma reconciliando com sua própria fatia do saldo', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2 });
    await seedWallet(userId, 200);

    const first = await wagerService.cashoutWager(wagerId, userId, { amount: 10, idempotencyKey: 'audit-key-1' });
    const second = await wagerService.cashoutWager(wagerId, userId, { amount: 10, idempotencyKey: 'audit-key-2' });

    const txRows = await query(
      "SELECT * FROM wallet_transactions WHERE related_entity = 'cashout' AND related_id = ANY($1::int[]) ORDER BY id;",
      [[first.cashout.id, second.cashout.id]]
    );
    expect(txRows.rows).toHaveLength(2);

    const [tx1, tx2] = txRows.rows;
    expect(Number(tx1.balance_before)).toBe(200);
    expect(Number(tx1.balance_after)).toBe(200 + first.netValue);
    expect(Number(tx2.balance_before)).toBe(Number(tx1.balance_after));
    expect(Number(tx2.balance_after)).toBe(Number(tx1.balance_after) + second.netValue);

    const walletRow = await query('SELECT balance FROM wallets WHERE user_id = $1;', [userId]);
    expect(Number(walletRow.rows[0].balance)).toBe(Number(tx2.balance_after));
  });
});
