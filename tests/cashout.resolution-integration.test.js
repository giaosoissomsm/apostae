// Requisito coberto: CASHOUT-03 — a fração restante (pós-cashout) de uma
// aposta continua elegível pra resolução/pagamento, e resolveMarket() só
// paga essa fração restante, nunca o potential_payout integral incondicional
// (RESEARCH.md Pitfall 2 / T-02-03-01). Segue o mesmo precedente de setup de
// tests/notifications.emission.test.js (Plan 01-04): applyBaseSchema +
// applyWalletSchema + seedTestUser + seedWallet num beforeAll, closePool num
// afterAll. Aqui também aplicamos applyCashoutMigration (migration 004) e
// usamos seedOpenMarket/seedWager (Plan 02-01) pra inserir apostas pendentes
// diretamente via SQL, sem passar pelo caminho de escrita de cashout em si
// (que não é o alvo deste teste — o alvo é resolveMarket).

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
const marketService = require('../src/services/marketService');

describe('marketService.resolveMarket paga apenas a fração restante pós-cashout (CASHOUT-03)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('resolution_integration_user');
  });

  afterAll(async () => {
    await closePool();
  });

  async function getWalletBalance(uid) {
    const result = await query('SELECT balance FROM wallets WHERE user_id = $1;', [uid]);
    return Number(result.rows[0].balance);
  }

  async function getLatestWalletTransaction(uid) {
    const result = await query(
      `SELECT wt.* FROM wallet_transactions wt
       JOIN wallets w ON w.id = wt.wallet_id
       WHERE w.user_id = $1
       ORDER BY wt.id DESC LIMIT 1;`,
      [uid]
    );
    return result.rows[0];
  }

  test('regressão: aposta sem cashout prévio (cashed_out_amount = 0) recebe o payout original integral', async () => {
    await seedWallet(userId, 1000);
    const balanceBefore = await getWalletBalance(userId);

    const marketId = await seedOpenMarket({ createdBy: userId, oddsYes: 2.0, oddsNo: 2.0 });
    await seedWager({
      userId,
      marketId,
      choice: 'yes',
      amount: 100,
      oddsAtTime: 2.0,
      potentialPayout: 200,
      cashedOutAmount: 0,
    });

    const resolved = await marketService.resolveMarket(marketId, 'yes');
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter - balanceBefore).toBe(200);

    const txn = await getLatestWalletTransaction(userId);
    expect(Number(txn.amount)).toBe(200);
    expect(txn.related_entity).toBe('market_resolved');

    expect(resolved.status).toBe('resolved');
    expect(resolved.outcome).toBe('yes');
    // Formato de retorno pro controller não deve vazar campos internos.
    expect(resolved.wagerOutcomes).toBeUndefined();
    expect(resolved.question).toBeUndefined();
  });

  test('cashout parcial prévio: aposta resolvida paga somente a fração restante (200 * 60/100 = 120), não o payout integral', async () => {
    await seedWallet(userId, 1000);
    const balanceBefore = await getWalletBalance(userId);

    const marketId = await seedOpenMarket({ createdBy: userId, oddsYes: 2.0, oddsNo: 2.0 });
    await seedWager({
      userId,
      marketId,
      choice: 'yes',
      amount: 100,
      oddsAtTime: 2.0,
      potentialPayout: 200,
      cashedOutAmount: 40,
    });

    const resolved = await marketService.resolveMarket(marketId, 'yes');
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter - balanceBefore).toBe(120);

    const txn = await getLatestWalletTransaction(userId);
    expect(Number(txn.amount)).toBe(120);
    expect(txn.related_entity).toBe('market_resolved');

    expect(resolved.status).toBe('resolved');
    expect(resolved.outcome).toBe('yes');
    expect(resolved.wagerOutcomes).toBeUndefined();
    expect(resolved.question).toBeUndefined();
  });
});
