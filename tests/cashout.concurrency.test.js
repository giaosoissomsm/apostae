// Requisitos cobertos: CASHOUT-06 — duas requisições de cashout
// genuinamente concorrentes (disparadas via Promise.allSettled/Promise.all,
// NUNCA awaits sequenciais, que jamais exerceriam contenção real de lock de
// linha) contra a MESMA aposta pendente, rodando contra o
// wagerService.cashoutWager real e não-modificado, provam que a ordem de
// lock mercado->aposta->carteira (ver 02-04-SUMMARY.md / 02-RESEARCH.md
// Pattern 1) serializa corretamente: um par que juntos excedem o saldo
// restante da aposta nunca pode ter ambas as pernas bem-sucedidas, e um par
// que cabe dentro do saldo restante tem sucesso em ambas as pernas sem
// perda de dados (o lock não pode "sobre-serializar" e descartar uma
// atualização legítima).

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

describe('cashout concorrente na mesma aposta (CASHOUT-06)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cashout_concurrency_user');
  });

  afterAll(async () => {
    await closePool();
  });

  test('duas requisições concorrentes que juntas excedem o saldo restante: no máximo uma tem sucesso', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2 });
    await seedWallet(userId, 1000);

    // Duas pernas de 60 contra um saldo restante de 100: juntas (120) excedem
    // o restante — no máximo uma pode vencer o lock e ter sucesso.
    const [resultA, resultB] = await Promise.allSettled([
      wagerService.cashoutWager(wagerId, userId, { amount: 60, idempotencyKey: 'key-a' }),
      wagerService.cashoutWager(wagerId, userId, { amount: 60, idempotencyKey: 'key-b' }),
    ]);

    const fulfilled = [resultA, resultB].filter((r) => r.status === 'fulfilled');
    const rejected = [resultA, resultB].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // A perna vencedora acaba deixando saldo restante de 40 pra segunda; a
    // segunda re-lê o estado JÁ pós-commit (não um valor obsoleto) e é
    // corretamente rejeitada pelo guard "requestedStake >= remainingStake".
    expect(rejected[0].reason).toBeInstanceOf(Error);
    expect(['ValidationError', 'ConflictError']).toContain(rejected[0].reason.constructor.name);

    const wagerRow = await query('SELECT cashed_out_amount FROM wagers WHERE id = $1;', [wagerId]);
    expect(Number(wagerRow.rows[0].cashed_out_amount)).toBe(60);

    const cashoutRows = await query('SELECT id FROM wager_cashouts WHERE wager_id = $1;', [wagerId]);
    expect(cashoutRows.rows).toHaveLength(1);

    const txRows = await query(
      "SELECT id FROM wallet_transactions WHERE related_entity = 'cashout' AND related_id = $1;",
      [cashoutRows.rows[0].id]
    );
    expect(txRows.rows).toHaveLength(1);
  });

  test('duas requisições concorrentes que juntas cabem no saldo restante: ambas têm sucesso, sem perda de dados', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2 });
    await seedWallet(userId, 1000);

    // Duas pernas de 20 contra um saldo restante de 100: juntas (40) cabem
    // tranquilamente — o lock deve serializá-las em sequência, não corromper
    // uma delas nem descartar a segunda.
    const [resultA, resultB] = await Promise.all([
      wagerService.cashoutWager(wagerId, userId, { amount: 20, idempotencyKey: 'key-c' }),
      wagerService.cashoutWager(wagerId, userId, { amount: 20, idempotencyKey: 'key-d' }),
    ]);

    expect(resultA.cashout.id).not.toBe(resultB.cashout.id);

    const wagerRow = await query('SELECT cashed_out_amount FROM wagers WHERE id = $1;', [wagerId]);
    expect(Number(wagerRow.rows[0].cashed_out_amount)).toBe(40);

    const cashoutRows = await query('SELECT id FROM wager_cashouts WHERE wager_id = $1;', [wagerId]);
    expect(cashoutRows.rows).toHaveLength(2);

    const txRows = await query(
      "SELECT id FROM wallet_transactions WHERE related_entity = 'cashout' AND related_id = ANY($1::int[]);",
      [cashoutRows.rows.map((r) => r.id)]
    );
    expect(txRows.rows).toHaveLength(2);
  });
});
