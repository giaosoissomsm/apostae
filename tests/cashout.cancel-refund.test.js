// Requisito coberto: 02-REVIEW.md CR-02 — wagerService.cancelWager() reembolsa
// só a fração AINDA presa na aposta (amount - cashed_out_amount), nunca o
// wager.amount original incondicional. Uma aposta com cashout parcial prévio
// continua com status 'pending' (cashout nunca muda o status da aposta), então
// nada além desta correção impedia um usuário de sacar parte do valor via
// cashout e depois cancelar o restante recebendo o wager.amount INTEIRO de
// volta — um pagamento duplicado sobre a mesma stake (mesma classe de bug de
// RESEARCH.md Pitfall 2, já corrigida em resolveMarket). Segue o mesmo
// precedente de setup de tests/cashout.resolution-integration.test.js: usamos
// seedWager({ cashedOutAmount }) pra semear uma aposta com cashout prévio SEM
// depender do caminho de escrita de cashout em si (que não é o alvo deste
// teste — o alvo é cancelWager).

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

describe('wagerService.cancelWager reembolsa apenas a fração restante pós-cashout (CR-02)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cancel_refund_user');
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

  test('regressão: aposta sem cashout prévio (cashed_out_amount = 0) é reembolsada no valor integral', async () => {
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

    await wagerService.cancelWager(wagerId, userId);
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter - balanceBefore).toBe(100);

    const txn = await getLatestWalletTransaction(userId);
    expect(Number(txn.amount)).toBe(100);
    expect(txn.related_entity).toBe('wager');
    expect(txn.type).toBe('refund');

    const wagerRow = await query('SELECT status FROM wagers WHERE id = $1;', [wagerId]);
    expect(wagerRow.rows[0].status).toBe('refunded');
  });

  test('cashout parcial prévio: cancelamento reembolsa somente o restante (100 - 40 = 60), nunca o wager.amount integral', async () => {
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
      cashedOutAmount: 40,
    });

    await wagerService.cancelWager(wagerId, userId);
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    // Nunca 100 — isso seria o double-pay do CR-02 (40 já saíram via cashout,
    // então só os 60 restantes devem voltar pra carteira aqui).
    expect(balanceAfter - balanceBefore).toBe(60);

    const txn = await getLatestWalletTransaction(userId);
    expect(Number(txn.amount)).toBe(60);
    expect(txn.related_entity).toBe('wager');
    expect(txn.type).toBe('refund');

    const wagerRow = await query('SELECT status FROM wagers WHERE id = $1;', [wagerId]);
    expect(wagerRow.rows[0].status).toBe('refunded');
  });
});
