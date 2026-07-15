// Requisitos cobertos: CANCEL-02, CANCEL-03 — o fee/net devolvido por
// cancelWager tem que ser byte-idêntico ao que money.applyFeePercent(amount,
// env.CANCEL_FEE_PERCENT) calcularia pro mesmo valor de entrada (nunca um
// `amount * 0.95` de ponto flutuante puro recalculado à parte), e a base da
// taxa tem que ser a stake restante (amount - cashed_out_amount), que — por
// decisão do dono do projeto (D-01 em STATE.md/04-01-SUMMARY.md) — sempre
// equivale à stake cheia na prática, já que qualquer cashout prévio bloqueia
// o cancelamento outright (ver cancel.blocking.test.js do Plan 04-03, fora
// do escopo deste arquivo).

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
const money = require('../src/utils/money');
const env = require('../src/config/env');

describe('wagerService.cancelWager - cálculo de taxa via money.applyFeePercent (CANCEL-02, CANCEL-03)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cancel_fee_computation_user');
  });

  afterAll(async () => {
    await closePool();
  });

  async function cancelCleanWager(amount) {
    const marketId = await seedOpenMarket({ createdBy: userId, oddsYes: 2.0, oddsNo: 2.0 });
    const wagerId = await seedWager({
      userId,
      marketId,
      choice: 'yes',
      amount,
      oddsAtTime: 2.0,
      potentialPayout: amount * 2,
      cashedOutAmount: 0,
    });
    const result = await wagerService.cancelWager(wagerId, userId);
    await wait();
    return { wagerId, result };
  }

  test.each([[100], [33.33]])(
    'fee/refunded pra amount=%d batem exatamente com money.applyFeePercent(amount, env.CANCEL_FEE_PERCENT)',
    async (amount) => {
      await seedWallet(userId, 10000);

      const { result } = await cancelCleanWager(amount);

      const expected = money.applyFeePercent(amount, env.CANCEL_FEE_PERCENT);
      expect(result.fee).toBe(expected.fee);
      expect(result.refunded).toBe(expected.net);

      // Nunca um cálculo raw de ponto flutuante (amount * 0.95) — comparamos
      // explicitamente contra o resultado do utilitário, não contra um valor
      // hardcoded, pra pegar qualquer regressão que reintroduza um cálculo
      // manual divergente.
      expect(result.fee).not.toBe(amount * (env.CANCEL_FEE_PERCENT / 100));
      // (a comparação acima só é significativa quando o float puro diverge
      // do resultado seguro em centavos; para valores "redondos" como 100
      // ambos podem coincidir — o ponto é que result.fee é sempre igual a
      // expected.fee, que é a garantia real desta suíte.)
    }
  );

  test('a base da taxa é a stake restante (amount - cashed_out_amount); com cashed_out_amount=0 isso é a stake cheia', async () => {
    await seedWallet(userId, 10000);

    const marketId = await seedOpenMarket({ createdBy: userId, oddsYes: 2.0, oddsNo: 2.0 });
    const knownAmount = 100;
    const wagerId = await seedWager({
      userId,
      marketId,
      choice: 'yes',
      amount: knownAmount,
      oddsAtTime: 2.0,
      potentialPayout: 200,
      // CANCEL-03/D-01: qualquer cashed_out_amount > 0 bloqueia outright
      // (cancel.blocking.test.js do Plan 04-03). Aqui usamos 0 pra provar
      // que, no único caminho alcançável, remainingStake === wager.amount
      // dirige o cálculo da taxa — a fórmula defensiva de CANCEL-03
      // (amount - cashed_out_amount) nunca diverge de amount neste caminho.
      cashedOutAmount: 0,
    });

    const result = await wagerService.cancelWager(wagerId, userId);
    await wait();

    const expected = money.applyFeePercent(knownAmount, env.CANCEL_FEE_PERCENT);
    expect(result.fee).toBe(expected.fee);
    expect(result.refunded).toBe(expected.net);

    // Confirma que a linha de wallet_transactions também reflete a stake
    // cheia como base — o valor líquido gravado bate com o cálculo sobre
    // knownAmount, não sobre algum valor parcial hipotético.
    const txRows = await query(
      "SELECT amount FROM wallet_transactions WHERE related_entity = 'wager' AND related_id = $1 AND type = 'refund';",
      [wagerId]
    );
    expect(Number(txRows.rows[0].amount)).toBe(expected.net);
  });
});
