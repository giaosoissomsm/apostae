// Requisitos cobertos: CASHOUT-07 — uma requisição retentada com a mesma
// idempotency_key nunca reaplica o crédito na carteira nem o incremento de
// cashed_out_amount, tanto numa retentativa SEQUENCIAL (o caso simples: a
// segunda chamada colide com a constraint UNIQUE(wager_id, idempotency_key)
// depois que a primeira já commitou) quanto numa retentativa GENUINAMENTE
// CONCORRENTE via Promise.all (o caso difícil: as duas pernas competem pelo
// mesmo lock de aposta; a que perde a corrida do INSERT recebe 23505 e
// reproduz o resultado já commitado, em vez de reaplicar a mutação) —
// ambas rodando contra o wagerService.cashoutWager real e não-modificado.

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

describe('replay de idempotency_key nunca reaplica o cashout (CASHOUT-07)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cashout_idempotency_user');
  });

  afterAll(async () => {
    await closePool();
  });

  test('retentativa sequencial com a mesma idempotency_key devolve o mesmo resultado sem duplicar', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2 });
    await seedWallet(userId, 1000);

    const first = await wagerService.cashoutWager(wagerId, userId, { amount: 30, idempotencyKey: 'retry-key' });
    const second = await wagerService.cashoutWager(wagerId, userId, { amount: 30, idempotencyKey: 'retry-key' });

    // Mesma linha wager_cashouts, mesmo netValue byte-idêntico — lido de
    // volta da linha já commitada, não recomputado (ver 02-04-SUMMARY.md
    // key-decisions).
    expect(second.cashout.id).toBe(first.cashout.id);
    expect(second.netValue).toBe(first.netValue);

    const wagerRow = await query('SELECT cashed_out_amount FROM wagers WHERE id = $1;', [wagerId]);
    expect(Number(wagerRow.rows[0].cashed_out_amount)).toBe(30);

    const txRows = await query(
      "SELECT * FROM wallet_transactions WHERE related_entity = 'cashout' AND related_id = $1;",
      [first.cashout.id]
    );
    expect(txRows.rows).toHaveLength(1);
  });

  test('retentativa CONCORRENTE (Promise.all, mesma idempotency_key) nunca credita duas vezes', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2 });
    await seedWallet(userId, 1000);

    // As duas pernas disparam SIMULTANEAMENTE com a mesma idempotencyKey:
    // ambas passam pelo lock de aposta em sequência (Postgres serializa),
    // mas só a primeira a rodar o INSERT consegue — a segunda recebe 23505
    // e reproduz o resultado já commitado pela primeira, sem re-creditar a
    // carteira nem reincrementar cashed_out_amount.
    const [first, second] = await Promise.all([
      wagerService.cashoutWager(wagerId, userId, { amount: 30, idempotencyKey: 'concurrent-retry-key' }),
      wagerService.cashoutWager(wagerId, userId, { amount: 30, idempotencyKey: 'concurrent-retry-key' }),
    ]);

    expect(second.cashout.id).toBe(first.cashout.id);
    expect(second.netValue).toBe(first.netValue);

    const wagerRow = await query('SELECT cashed_out_amount FROM wagers WHERE id = $1;', [wagerId]);
    expect(Number(wagerRow.rows[0].cashed_out_amount)).toBe(30);

    const txRows = await query(
      "SELECT * FROM wallet_transactions WHERE related_entity = 'cashout' AND related_id = $1;",
      [first.cashout.id]
    );
    expect(txRows.rows).toHaveLength(1);
  });
});
