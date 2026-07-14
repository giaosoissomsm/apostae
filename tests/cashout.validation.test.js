// Requisitos cobertos: CASHOUT-04, CASHOUT-05, mais a guarda de restante-zero
// (partial-only nesta milestone) — todo caminho de rejeição de
// wagerService.cashoutWager, incluindo a garantia de que uma transação
// revertida (ROLLBACK) nunca emite 'wager.cashed_out' (D-01).

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
const domainEvents = require('../src/events/domainEvents');
const wagerService = require('../src/services/wagerService');
const { ValidationError, ConflictError } = require('../src/utils/errors');

describe('wagerService.cashoutWager — validação e rejeições (CASHOUT-04, CASHOUT-05)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cashout_validation_user');
    await seedWallet(userId, 1000);
  });

  afterAll(async () => {
    await closePool();
  });

  // Registra um listener de uso único para 'wager.cashed_out', pra provar
  // que um caminho rejeitado nunca deixa um evento "fantasma" (D-01).
  function captureCashoutEvent() {
    const captured = [];
    const handler = (payload) => captured.push(payload);
    domainEvents.on('wager.cashed_out', handler);
    return {
      captured,
      stop() {
        domainEvents.off('wager.cashed_out', handler);
      },
    };
  }

  test('amount=0 lança ValidationError antes de tocar o banco', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2, potentialPayout: 200 });

    await expect(
      wagerService.cashoutWager(wagerId, userId, { amount: 0, idempotencyKey: 'validation-zero' })
    ).rejects.toThrow(ValidationError);
  });

  test('amount=-5 lança ValidationError antes de tocar o banco', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2, potentialPayout: 200 });

    await expect(
      wagerService.cashoutWager(wagerId, userId, { amount: -5, idempotencyKey: 'validation-negative' })
    ).rejects.toThrow(ValidationError);
  });

  test('aposta num mercado fechado lança ConflictError e não emite wager.cashed_out', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2, potentialPayout: 200 });
    await query("UPDATE markets SET status = 'closed' WHERE id = $1;", [marketId]);

    const listener = captureCashoutEvent();
    await expect(
      wagerService.cashoutWager(wagerId, userId, { amount: 30, idempotencyKey: 'validation-closed-market' })
    ).rejects.toThrow(ConflictError);
    listener.stop();

    expect(listener.captured).toHaveLength(0);
  });

  test('aposta cujo próprio status não é pending (ex.: já ganhou) lança ConflictError e não emite wager.cashed_out', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2, potentialPayout: 200 });
    await query("UPDATE wagers SET status = 'won' WHERE id = $1;", [wagerId]);

    const listener = captureCashoutEvent();
    await expect(
      wagerService.cashoutWager(wagerId, userId, { amount: 30, idempotencyKey: 'validation-non-pending' })
    ).rejects.toThrow(ConflictError);
    listener.stop();

    expect(listener.captured).toHaveLength(0);
  });

  test('solicitar exatamente o restante disponível lança ValidationError (restante nunca pode chegar a zero nesta milestone)', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    const wagerId = await seedWager({ userId, marketId, amount: 100, oddsAtTime: 2, potentialPayout: 200 });

    await expect(
      wagerService.cashoutWager(wagerId, userId, { amount: 100, idempotencyKey: 'validation-full-remaining' })
    ).rejects.toThrow(ValidationError);
  });
});
