// Requisito coberto: CANCEL-07 — cancelWager racing cashoutWager e racing
// resolveMarket na MESMA aposta, disparados via Promise.allSettled/Promise.all
// (NUNCA awaits sequenciais, que jamais exerceriam contenção real de lock de
// linha), rodando contra os serviços reais e não-modificados
// (wagerService.cancelWager, wagerService.cashoutWager, marketService.resolveMarket).
// Mesma convenção estrutural de tests/cashout.concurrency.test.js (CASHOUT-06).
//
// A garantia provada aqui NÃO é "quem vence" — é "nunca os dois, nunca perda
// de dados, nunca deadlock (40P01)": a ordem de lock mercado -> aposta ->
// carteira (fixada em cancelWager pela Fase 4, ver 04-01-SUMMARY.md e
// 04-RESEARCH.md Pitfall 2) serializa as duas pernas corretamente, então uma
// delas sempre re-lê o estado JÁ pós-commit da outra e é corretamente
// rejeitada com um erro operacional (ConflictError/ValidationError), nunca um
// erro bruto de deadlock do Postgres.
//
// CRÍTICO (ver 04-03-PLAN.md <important_note> e o <human-check> do Task 2):
// mocks são estruturalmente incapazes de provar serialização real de FOR
// UPDATE do Postgres (mesma classe de gap já demonstrada duas vezes nesta
// milestone, 02-REVIEW.md CR-01 e 03-REVIEW.md CR-01). Este arquivo foi
// escrito contra o contrato real da interface e roda sem alterações assim
// que um Postgres *test*-named estiver acessível; enquanto isso, a
// verificação de compensação (mock-backed dry run) está documentada na
// SUMMARY — NÃO trate essa compensação como prova de CANCEL-07 contra
// Postgres real.

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
const marketService = require('../src/services/marketService');
const env = require('../src/config/env');

// Não é um SQLSTATE de deadlock bruto (40P01) vazando como erro não
// operacional — se algo rejeitar, deve ser um erro operacional conhecido do
// domínio (ConflictError/ValidationError/NotFoundError), nunca um erro pg cru.
function isOperationalRejection(reason) {
  return reason instanceof Error && ['ConflictError', 'ValidationError', 'NotFoundError'].includes(reason.constructor.name);
}

describe('cancelWager concorrente contra cashoutWager e resolveMarket (CANCEL-07)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    userId = await seedTestUser('cancel_concurrency_user');
  });

  afterAll(async () => {
    await closePool();
  });

  async function getWalletBalance(uid) {
    const result = await query('SELECT balance FROM wallets WHERE user_id = $1;', [uid]);
    return Number(result.rows[0].balance);
  }

  test('Teste A: cancel racing cashout na mesma aposta pendente - nunca ambos têm sucesso, nunca duplo pagamento, nunca deadlock', async () => {
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

    const [cancelResult, cashoutResult] = await Promise.allSettled([
      wagerService.cancelWager(wagerId, userId),
      wagerService.cashoutWager(wagerId, userId, { amount: 30, idempotencyKey: 'race-key' }),
    ]);
    await wait();

    // Nenhuma das duas pernas pode rejeitar com um erro de deadlock bruto —
    // se rejeitou, tem que ser um ConflictError/ValidationError operacional.
    if (cancelResult.status === 'rejected') expect(isOperationalRejection(cancelResult.reason)).toBe(true);
    if (cashoutResult.status === 'rejected') expect(isOperationalRejection(cashoutResult.reason)).toBe(true);

    const wagerRow = await query(
      'SELECT status, cashed_out_amount FROM wagers WHERE id = $1;',
      [wagerId]
    );
    const finalStatus = wagerRow.rows[0].status;
    const finalCashedOut = Number(wagerRow.rows[0].cashed_out_amount);

    const refundRows = await query(
      "SELECT amount FROM wallet_transactions WHERE related_entity = 'wager' AND related_id = $1 AND type = 'refund';",
      [wagerId]
    );
    const cashoutRows = await query('SELECT id, net_value FROM wager_cashouts WHERE wager_id = $1;', [wagerId]);
    const creditRows = await query(
      "SELECT amount FROM wallet_transactions WHERE related_entity = 'cashout' AND related_id = ANY($1::int[]);",
      [cashoutRows.rows.map((r) => r.id)]
    );

    const balanceAfter = await getWalletBalance(userId);

    if (finalStatus === 'refunded') {
      // Cancel venceu o lock primeiro: cashout re-lê status != 'pending' e
      // rejeita. Exatamente um refund, zero cashouts, zero double-pay.
      expect(cancelResult.status).toBe('fulfilled');
      expect(cashoutResult.status).toBe('rejected');
      expect(refundRows.rows).toHaveLength(1);
      expect(cashoutRows.rows).toHaveLength(0);
      expect(creditRows.rows).toHaveLength(0);

      const expectedNet = 100 - (100 * env.CANCEL_FEE_PERCENT) / 100;
      expect(Number(refundRows.rows[0].amount)).toBe(expectedNet);
      expect(balanceAfter - balanceBefore).toBe(expectedNet);
    } else {
      // Cashout venceu o lock primeiro: cancel re-lê cashed_out_amount > 0 e
      // rejeita OUTRIGHT (CANCEL-06). Exatamente um cashout, zero refunds,
      // zero double-pay; aposta permanece 'pending' com o cashout aplicado.
      expect(finalStatus).toBe('pending');
      expect(finalCashedOut).toBe(30);
      expect(cashoutResult.status).toBe('fulfilled');
      expect(cancelResult.status).toBe('rejected');
      expect(refundRows.rows).toHaveLength(0);
      expect(cashoutRows.rows).toHaveLength(1);
      expect(creditRows.rows).toHaveLength(1);

      expect(balanceAfter - balanceBefore).toBe(Number(creditRows.rows[0].amount));
    }

    // Nunca os dois efeitos ao mesmo tempo sobre a mesma stake (double-pay).
    expect(refundRows.rows.length > 0 && cashoutRows.rows.length > 0).toBe(false);
  });

  test('Teste B: cancel racing resolveMarket na mesma aposta pendente - nunca duplo crédito, nunca deadlock', async () => {
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

    const [cancelResult, resolveResult] = await Promise.allSettled([
      wagerService.cancelWager(wagerId, userId),
      marketService.resolveMarket(marketId, 'yes', undefined),
    ]);
    await wait();

    if (cancelResult.status === 'rejected') expect(isOperationalRejection(cancelResult.reason)).toBe(true);
    if (resolveResult.status === 'rejected') expect(isOperationalRejection(resolveResult.reason)).toBe(true);

    const wagerRow = await query('SELECT status FROM wagers WHERE id = $1;', [wagerId]);
    const finalStatus = wagerRow.rows[0].status;

    const refundRows = await query(
      "SELECT amount FROM wallet_transactions WHERE related_entity = 'wager' AND related_id = $1 AND type = 'refund';",
      [wagerId]
    );
    const marketCreditRows = await query(
      "SELECT amount FROM wallet_transactions WHERE related_entity = 'market_resolved' AND related_id = $1;",
      [marketId]
    );

    const balanceAfter = await getWalletBalance(userId);

    if (finalStatus === 'refunded') {
      // Cancel venceu o lock de mercado primeiro: a aposta some da lista de
      // pendentes antes de resolveMarket processá-la — resolução segue em
      // frente pro mercado (nenhuma outra aposta existe), mas não paga essa
      // aposta de novo (ela não está mais 'pending').
      expect(cancelResult.status).toBe('fulfilled');
      expect(refundRows.rows).toHaveLength(1);
      expect(marketCreditRows.rows).toHaveLength(0);

      const expectedNet = 100 - (100 * env.CANCEL_FEE_PERCENT) / 100;
      expect(balanceAfter - balanceBefore).toBe(expectedNet);
    } else {
      // resolveMarket venceu o lock de mercado primeiro: mercado fica
      // 'resolved', aposta vira 'won'/'lost'. cancel então re-lê
      // market.status !== 'open' e rejeita com ConflictError.
      expect(['won', 'lost']).toContain(finalStatus);
      expect(resolveResult.status).toBe('fulfilled');
      expect(cancelResult.status).toBe('rejected');
      expect(refundRows.rows).toHaveLength(0);

      if (finalStatus === 'won') {
        // choice 'yes' === outcome 'yes' -> ganhou; remainingFraction = 1
        // (cashed_out_amount = 0), payout = potential_payout (200).
        expect(marketCreditRows.rows).toHaveLength(1);
        expect(Number(marketCreditRows.rows[0].amount)).toBe(200);
        expect(balanceAfter - balanceBefore).toBe(200);
      } else {
        expect(marketCreditRows.rows).toHaveLength(0);
        expect(balanceAfter - balanceBefore).toBe(0);
      }
    }

    // Nunca um refund E um crédito de resolução sobre a mesma aposta ao mesmo tempo.
    expect(refundRows.rows.length > 0 && marketCreditRows.rows.length > 0).toBe(false);
  });
});
