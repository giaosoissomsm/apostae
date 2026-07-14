// Requisito coberto: 02-REVIEW.md CR-03 — marketService.deleteMarket() reembolsa,
// por aposta pendente, só a fração AINDA presa (amount - cashed_out_amount),
// nunca o wager.amount original incondicional. Bug idêntico ao CR-02, mesma
// classe (RESEARCH.md Pitfall 2), disparado por um segundo caminho de código
// (ação de admin em vez de cancelamento pelo próprio dono da aposta). Segue o
// mesmo precedente de setup de tests/cashout.resolution-integration.test.js:
// usamos seedWager({ cashedOutAmount }) pra semear apostas pendentes com
// cashout prévio SEM depender do caminho de escrita de cashout em si.

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

describe('marketService.deleteMarket reembolsa apenas a fração restante pós-cashout de cada aposta pendente (CR-03)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('delete_market_refund_user');
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

  test('regressão: mercado deletado com aposta pendente sem cashout prévio reembolsa o valor integral', async () => {
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

    await marketService.deleteMarket(marketId);
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter - balanceBefore).toBe(100);

    const txn = await getLatestWalletTransaction(userId);
    expect(Number(txn.amount)).toBe(100);
    expect(txn.related_entity).toBe('market_deleted');
  });

  test('cashout parcial prévio: deletar o mercado reembolsa somente o restante (100 - 30 = 70), nunca o wager.amount integral', async () => {
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
      cashedOutAmount: 30,
    });

    await marketService.deleteMarket(marketId);
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    // Nunca 100 — isso seria o double-pay do CR-03 (30 já saíram via cashout,
    // então só os 70 restantes devem voltar pra carteira aqui).
    expect(balanceAfter - balanceBefore).toBe(70);

    const txn = await getLatestWalletTransaction(userId);
    expect(Number(txn.amount)).toBe(70);
    expect(txn.related_entity).toBe('market_deleted');
  });
});
