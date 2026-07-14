// Requisitos cobertos: CASHOUT-01, CASHOUT-02, CASHOUT-09 — o valor do
// cashout é sempre calculado no servidor (stake * odds_at_time, menos taxa),
// nunca a partir de um campo monetário enviado pelo cliente, e a lógica não
// depende do campo binário `choice` da aposta (market-type-agnostic).

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

describe('wagerService.cashoutWager — cálculo do valor (CASHOUT-01, CASHOUT-02, CASHOUT-09)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cashout_computation_user');
    await seedWallet(userId, 1000);
  });

  afterAll(async () => {
    await closePool();
  });

  async function fetchWager(wagerId) {
    const result = await query('SELECT * FROM wagers WHERE id = $1;', [wagerId]);
    return result.rows[0];
  }

  test('cashout de 30 numa aposta de 100/odds=2 devolve net=60, gross=60 (fee=0) e atualiza cashed_out_amount', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, choice: 'yes', amount: 100, oddsAtTime: 2, potentialPayout: 200 });

    const result = await wagerService.cashoutWager(wagerId, userId, {
      amount: 30,
      idempotencyKey: 'computation-key-1',
    });

    expect(result.netValue).toBe(60);
    expect(result.grossValue).toBe(60);
    expect(result.feeAmount).toBe(0);

    const wager = await fetchWager(wagerId);
    expect(Number(wager.cashed_out_amount)).toBe(30);
  });

  test('valores monetários extras enviados pelo chamador (netValue/payout falsos) são ignorados — o valor devolvido é sempre o calculado no servidor', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, choice: 'yes', amount: 100, oddsAtTime: 2, potentialPayout: 200 });

    const result = await wagerService.cashoutWager(wagerId, userId, {
      amount: 30,
      idempotencyKey: 'computation-key-2',
      // Campos extras "atacantes" — o serviço desestrutura apenas
      // { amount, idempotencyKey }, então isso nunca deveria influenciar o
      // resultado calculado no servidor.
      netValue: 999999,
      payout: 999999,
      grossValue: 999999,
    });

    expect(result.netValue).toBe(60);
    expect(result.grossValue).toBe(60);
  });

  test('cashout funciona identicamente para aposta com choice=\'no\' — sem ramificação no campo de seleção binária (CASHOUT-09)', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, choice: 'no', amount: 100, oddsAtTime: 2, potentialPayout: 200 });

    const result = await wagerService.cashoutWager(wagerId, userId, {
      amount: 30,
      idempotencyKey: 'computation-key-3',
    });

    expect(result.netValue).toBe(60);
    expect(result.grossValue).toBe(60);

    const wager = await fetchWager(wagerId);
    expect(Number(wager.cashed_out_amount)).toBe(30);
  });
});
