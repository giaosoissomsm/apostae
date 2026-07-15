// Requisito coberto: Fase 4 (CANCEL-01/02/03/05/06) — wagerService.cancelWager()
// agora cobra uma taxa de CANCEL_FEE_PERCENT (5% por padrão) sobre a stake
// restante e reembolsa o líquido (95%), E bloqueia CANCELAMENTO TOTALMENTE
// se qualquer cashout já tiver ocorrido na aposta (cashed_out_amount > 0),
// substituindo o antigo comportamento de netting parcial (02-REVIEW.md
// CR-02) que reduzia o reembolso mas nunca bloqueava. Decisão confirmada
// pelo dono do projeto (STATE.md Fase 4): não existe mais cancelamento
// parcial pós-cashout nesta milestone — o caminho de netting descrito em
// CANCEL-03 é uma fórmula defensiva inalcançável na prática, dado o
// bloqueio. Segue o mesmo precedente de setup de
// tests/cashout.resolution-integration.test.js: usamos
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
const { ConflictError } = require('../src/utils/errors');

describe('wagerService.cancelWager cobra 5% de taxa e bloqueia totalmente após cashout (Fase 4)', () => {
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

  test('aposta sem cashout prévio (cashed_out_amount = 0) é reembolsada em 95% (5% de taxa retida)', async () => {
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
    // 100 de stake, taxa de 5% (CANCEL_FEE_PERCENT padrão) => reembolso líquido de 95.
    expect(balanceAfter - balanceBefore).toBe(95);

    const txn = await getLatestWalletTransaction(userId);
    expect(Number(txn.amount)).toBe(95);
    expect(txn.related_entity).toBe('wager');
    expect(txn.type).toBe('refund');

    const wagerRow = await query('SELECT status FROM wagers WHERE id = $1;', [wagerId]);
    expect(wagerRow.rows[0].status).toBe('refunded');
  });

  test('cashout parcial prévio: cancelamento é BLOQUEADO totalmente (ConflictError), carteira e status inalterados', async () => {
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

    // CANCEL-06: uma vez que cashed_out_amount > 0, cancelWager rejeita
    // OUTRIGHT com ConflictError, antes de qualquer cálculo de reembolso —
    // não existe mais um caminho de "reembolsa só o restante (60)".
    await expect(wagerService.cancelWager(wagerId, userId)).rejects.toThrow(ConflictError);
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    // Carteira inalterada — nenhum reembolso (parcial ou total) ocorre no bloqueio.
    expect(balanceAfter - balanceBefore).toBe(0);

    const wagerRow = await query('SELECT status FROM wagers WHERE id = $1;', [wagerId]);
    // Status permanece 'pending' — updateStatus nunca é chamado nesse caminho.
    expect(wagerRow.rows[0].status).toBe('pending');
  });
});
