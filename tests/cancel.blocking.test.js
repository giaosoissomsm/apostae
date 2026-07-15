// Requisito coberto: CANCEL-06 — as três condições de bloqueio de
// cancelamento (mercado fechado, aposta já resolvida, cashout prévio já
// realizado) rejeitam com ConflictError e produzem ZERO efeitos colaterais
// (saldo da carteira inalterado, status não sobrescrito). Roda o
// wagerService.cancelWager real e não modificado (04-01) contra apostas
// semeadas via tests/helpers/testDb.js, usando UPDATE bruto pra forçar cada
// estado de bloqueio (seedOpenMarket/seedWager só semeiam o estado 'open'/
// 'pending' — ver 04-03-PLAN.md context).

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
const { ConflictError } = require('../src/utils/errors');

describe('wagerService.cancelWager - bloqueios de cancelamento (CANCEL-06)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cancel_blocking_user');
  });

  afterAll(async () => {
    await closePool();
  });

  async function getWalletBalance(uid) {
    const result = await query('SELECT balance FROM wallets WHERE user_id = $1;', [uid]);
    return Number(result.rows[0].balance);
  }

  test('mercado fechado: cancelamento é rejeitado com ConflictError, sem efeitos colaterais', async () => {
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

    // Força o mercado pra 'closed' via UPDATE bruto — seedOpenMarket só
    // semeia 'open' (ver 04-03-PLAN.md context).
    await query("UPDATE markets SET status = 'closed' WHERE id = $1;", [marketId]);

    await expect(wagerService.cancelWager(wagerId, userId)).rejects.toThrow(ConflictError);
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter).toBe(balanceBefore);

    const wagerRow = await query('SELECT status FROM wagers WHERE id = $1;', [wagerId]);
    expect(wagerRow.rows[0].status).toBe('pending');
    expect(wagerRow.rows[0].status).not.toBe('refunded');
  });

  test('aposta já resolvida (status não-pending): cancelamento é rejeitado com ConflictError, status não é sobrescrito', async () => {
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

    // Força a aposta pra um status terminal não-pending via UPDATE bruto.
    await query("UPDATE wagers SET status = 'won' WHERE id = $1;", [wagerId]);

    await expect(wagerService.cancelWager(wagerId, userId)).rejects.toThrow(ConflictError);
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter).toBe(balanceBefore);

    // Status permanece exatamente o que foi setado — cancelWager nunca
    // sobrescreve pra 'refunded' quando a aposta já não está pending.
    const wagerRow = await query('SELECT status FROM wagers WHERE id = $1;', [wagerId]);
    expect(wagerRow.rows[0].status).toBe('won');
  });

  test('cashout prévio já realizado (cashed_out_amount > 0): cancelamento é BLOQUEADO totalmente, sem vazamento de reembolso parcial (CANCEL-06, financeiro crítico)', async () => {
    // Este é o guard de prevenção de pagamento duplicado que substitui o
    // antigo caminho de netting da Fase 2 (CR-02): antes, um cashout prévio
    // apenas reduzia o valor reembolsado; agora bloqueia outright ANTES de
    // qualquer cálculo de reembolso rodar. Prova que não existe um "reembolso
    // dos 60 restantes" escondido em nenhum caminho de código.
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

    await expect(wagerService.cancelWager(wagerId, userId)).rejects.toThrow(ConflictError);
    await wait();

    // Saldo inalterado — nenhum reembolso, nem dos 60 restantes, vaza.
    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter).toBe(balanceBefore);

    // Status permanece 'pending' — updateStatus nunca é chamado nesse caminho.
    const wagerRow = await query('SELECT status, cashed_out_amount FROM wagers WHERE id = $1;', [wagerId]);
    expect(wagerRow.rows[0].status).toBe('pending');
    expect(Number(wagerRow.rows[0].cashed_out_amount)).toBe(40);

    // Nenhuma linha wallet_transactions de refund foi gravada pra essa aposta.
    const txRows = await query(
      "SELECT id FROM wallet_transactions WHERE related_entity = 'wager' AND related_id = $1 AND type = 'refund';",
      [wagerId]
    );
    expect(txRows.rows).toHaveLength(0);
  });
});
