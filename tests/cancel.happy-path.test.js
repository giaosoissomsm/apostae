// Requisitos cobertos: CANCEL-01, CANCEL-05 (e sanidade de CANCEL-02) —
// cancelamento de uma aposta 'pending' limpa (sem cashout prévio) cobra a
// taxa configurada (CANCEL_FEE_PERCENT, 5% por padrão) sobre a stake
// restante, reembolsa o líquido (95% por padrão) na carteira real, muda o
// status da aposta pra 'refunded' (a UI já exibe isso como "Cancelada" —
// ver dashboard.js) e grava exatamente uma linha 'refund' em
// wallet_transactions. Segue o mesmo padrão de setup de
// tests/cashout.cancel-refund.test.js, dirigindo o wagerService.cancelWager
// real e não modificado (04-01) contra uma aposta semeada via
// tests/helpers/testDb.js.

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

describe('wagerService.cancelWager - cancelamento limpo de aposta pendente (CANCEL-01, CANCEL-05)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cancel_happy_path_user');
  });

  afterAll(async () => {
    await closePool();
  });

  async function getWalletBalance(uid) {
    const result = await query('SELECT balance FROM wallets WHERE user_id = $1;', [uid]);
    return Number(result.rows[0].balance);
  }

  test('aposta pendente sem cashout prévio é cancelada: retorna ok/refunded/fee corretos, reembolsa 95%, status vira refunded, uma linha refund é gravada', async () => {
    await seedWallet(userId, 1000);
    const balanceBefore = await getWalletBalance(userId);

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

    // Formato do retorno: { ok: true, refunded: <net>, fee: <fee> }, derivado
    // de money.applyFeePercent(100, CANCEL_FEE_PERCENT) — lido de env, nunca
    // hardcoded, pra o teste acompanhar a configuração.
    expect(result.ok).toBe(true);
    expect(result.refunded).toBe(100 - (100 * env.CANCEL_FEE_PERCENT) / 100);
    expect(result.fee).toBe((100 * env.CANCEL_FEE_PERCENT) / 100);

    // Sanidade CANCEL-02 no nível do happy-path: o delta de saldo é o
    // reembolso líquido (95 com a taxa padrão de 5%), nunca a stake cheia
    // (100) — prova que a taxa foi de fato aplicada, não só calculada.
    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter - balanceBefore).toBe(result.refunded);
    expect(balanceAfter - balanceBefore).not.toBe(100);

    // CANCEL-05: status vira 'refunded' (dashboard.js já mapeia isso pra
    // "Cancelada" — nenhum novo valor de enum foi introduzido).
    const wagerRow = await query('SELECT status FROM wagers WHERE id = $1;', [wagerId]);
    expect(wagerRow.rows[0].status).toBe('refunded');

    // Exatamente uma linha wallet_transactions do tipo 'refund' pra essa aposta.
    const txRows = await query(
      "SELECT * FROM wallet_transactions WHERE related_entity = 'wager' AND related_id = $1 AND type = 'refund';",
      [wagerId]
    );
    expect(txRows.rows).toHaveLength(1);
    expect(Number(txRows.rows[0].amount)).toBe(result.refunded);
  });
});
