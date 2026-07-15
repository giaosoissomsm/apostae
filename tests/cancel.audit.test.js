// Requisito coberto: CANCEL-04 — todo cancelamento bem-sucedido produz
// exatamente uma linha em wallet_transactions (type='refund',
// related_entity='wager', related_id=<id da aposta>) cujo `amount`
// reconcilia exatamente com o reembolso líquido devolvido, e cujo
// balance_before/balance_after reconciliam exatamente com o saldo real da
// carteira — provando que o saldo só é alterado através do movimento
// registrado (walletRepository.adjustBalance + recordTransaction), nunca
// por uma UPDATE bruta que contorne o repositório. Espelha a estrutura de
// tests/cashout.audit.test.js (CASHOUT-08), adaptada pra cancelamento.

const {
  applyBaseSchema,
  applyWalletSchema,
  applyCashoutMigration,
  seedTestUser,
  seedWallet,
  seedOpenMarket,
  seedWager,
  wait,
  closePool,
} = require('./helpers/testDb');
const { query } = require('../src/config/database');
const wagerService = require('../src/services/wagerService');
const env = require('../src/config/env');

describe('trilha de auditoria do cancelamento (CANCEL-04)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cancel_audit_user');
  });

  afterAll(async () => {
    await closePool();
  });

  test('cancelamento bem-sucedido produz exatamente uma linha wallet_transactions que reconcilia com o saldo real e documenta a taxa', async () => {
    const walletId = await seedWallet(userId, 500);

    const marketId = await seedOpenMarket({ createdBy: userId, oddsYes: 2.0, oddsNo: 2.0 });
    const wagerId = await seedWager({
      userId,
      marketId,
      choice: 'yes',
      amount: 100,
      oddsAtTime: 2.0,
      potentialPayout: 200,
      cashedOutAmount: 0,
    });

    const result = await wagerService.cancelWager(wagerId, userId);
    await wait();

    const txRows = await query(
      "SELECT * FROM wallet_transactions WHERE related_entity = 'wager' AND related_id = $1;",
      [wagerId]
    );
    // Exatamente uma linha para esta aposta — nada além do movimento único
    // de cancelamento (a aposta nunca teve cashout, então não há linhas
    // 'credit' concorrentes).
    expect(txRows.rows).toHaveLength(1);
    const tx = txRows.rows[0];

    expect(tx.type).toBe('refund');
    expect(Number(tx.amount)).toBe(result.refunded);

    // balance_before/balance_after bracketam exatamente o saldo inicial
    // conhecido (500) e o reembolso líquido devolvido — sem drift.
    expect(Number(tx.balance_before)).toBe(500);
    expect(Number(tx.balance_after)).toBe(500 + result.refunded);

    // O saldo real da carteira só pode ter mudado através do movimento
    // registrado acima — nunca por uma UPDATE bruta que contorne
    // walletRepository.
    const walletRow = await query('SELECT balance FROM wallets WHERE id = $1;', [walletId]);
    expect(Number(walletRow.rows[0].balance)).toBe(Number(tx.balance_before) + Number(tx.amount));

    // A descrição é legível por humano e documenta a taxa (CANCEL-04) — sem
    // se acoplar demais à redação exata: basta conter o percentual da taxa
    // configurada ou a palavra "taxa".
    expect(tx.description).toBeTruthy();
    expect(tx.description.length).toBeGreaterThan(0);
    expect(tx.description).toEqual(
      expect.stringMatching(new RegExp(`taxa|${env.CANCEL_FEE_PERCENT}%`, 'i'))
    );
  });
});
