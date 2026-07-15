// Requisitos cobertos: MARKET-07 (resolução/pagamento generalizado pra N
// resultados) e a metade de resolução do MARKET-06 (winning_option_id
// escopado ao mercado, IDOR-safe). Segue o mesmo precedente de setup de
// tests/cashout.resolution-integration.test.js (Plan 02-03): applyBaseSchema
// + applyWalletSchema + applyMarketTypesMigration + seedTestUser/seedWallet
// num beforeAll, closePool num afterAll. seedOpenMarket/seedMarketOptions/
// seedWager (03-01) inserem mercados/opções/apostas diretamente via SQL, sem
// passar pelo caminho de escrita de createMarket/placeWager em si (que não é
// o alvo deste teste — o alvo é resolveMarket).
//
// NOTA (carried-forward blocker, STATE.md): nenhum banco Postgres *test*-
// nomeado é alcançável neste sandbox. Este arquivo é estruturalmente correto
// e validado via `npx jest tests/markets.resolution.test.js --listTests` e
// revisão manual do source real (marketService.resolveMarket,
// marketOptionRepository.findByIdForMarket) — execução genuína contra
// Postgres real fica para o gate de fase (03-07), igual a todo plano anterior
// desta fase.

const {
  applyBaseSchema,
  applyWalletSchema,
  applyMarketTypesMigration,
  seedTestUser,
  seedWallet,
  seedOpenMarket,
  seedMarketOptions,
  seedWager,
  wait,
  closePool,
} = require('./helpers/testDb');
const { query } = require('../src/config/database');
const marketService = require('../src/services/marketService');
const { ValidationError } = require('../src/utils/errors');

describe('marketService.resolveMarket generalizado pra N-outcome (MARKET-06/MARKET-07)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyMarketTypesMigration();
    userId = await seedTestUser('resolution_n_outcome_user');
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

  async function getWagerStatus(wagerId) {
    const result = await query('SELECT status FROM wagers WHERE id = $1;', [wagerId]);
    return result.rows[0].status;
  }

  test('(a) regressão binary: vencedor recebe payout integral, perdedor marcado lost — comportamento byte-idêntico ao pré-Phase-3', async () => {
    await seedWallet(userId, 1000);
    const balanceBefore = await getWalletBalance(userId);

    const marketId = await seedOpenMarket({ createdBy: userId, oddsYes: 2.0, oddsNo: 1.8 });
    const winnerWagerId = await seedWager({
      userId, marketId, choice: 'yes', amount: 100, oddsAtTime: 2.0, potentialPayout: 200,
    });
    const loserWagerId = await seedWager({
      userId, marketId, choice: 'no', amount: 50, oddsAtTime: 1.8, potentialPayout: 90,
    });

    const resolved = await marketService.resolveMarket(marketId, 'yes');
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter - balanceBefore).toBe(200);

    const txn = await getLatestWalletTransaction(userId);
    expect(Number(txn.amount)).toBe(200);
    expect(txn.related_entity).toBe('market_resolved');

    expect(await getWagerStatus(winnerWagerId)).toBe('won');
    expect(await getWagerStatus(loserWagerId)).toBe('lost');

    expect(resolved.status).toBe('resolved');
    expect(resolved.outcome).toBe('yes');
    // Formato de retorno pro controller não deve vazar campos internos.
    expect(resolved.wagerOutcomes).toBeUndefined();
    expect(resolved.question).toBeUndefined();
  });

  test('(b) over_under: só a opção vencedora (winning_option_id) é paga, a outra perde', async () => {
    await seedWallet(userId, 1000);
    const balanceBefore = await getWalletBalance(userId);

    const marketId = await seedOpenMarket({ createdBy: userId, marketType: 'over_under', threshold: 2.5 });
    const [overOption, underOption] = await seedMarketOptions(marketId, [
      { label: 'Over 2.5', odds: 1.9, sortOrder: 0 },
      { label: 'Under 2.5', odds: 1.9, sortOrder: 1 },
    ]);

    const overWagerId = await seedWager({
      userId, marketId, optionId: overOption.id, amount: 100, oddsAtTime: 1.9, potentialPayout: 190,
    });
    const underWagerId = await seedWager({
      userId, marketId, optionId: underOption.id, amount: 50, oddsAtTime: 1.9, potentialPayout: 95,
    });

    const resolved = await marketService.resolveMarket(marketId, undefined, overOption.id);
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter - balanceBefore).toBe(190);

    const txn = await getLatestWalletTransaction(userId);
    expect(Number(txn.amount)).toBe(190);
    expect(txn.related_entity).toBe('market_resolved');

    expect(await getWagerStatus(overWagerId)).toBe('won');
    expect(await getWagerStatus(underWagerId)).toBe('lost');

    expect(resolved.status).toBe('resolved');
    expect(resolved.winning_option_id).toBe(overOption.id);
  });

  test('(c) multiple_choice com 4 opções: só as apostas na opção vencedora são pagas', async () => {
    await seedWallet(userId, 1000);
    const balanceBefore = await getWalletBalance(userId);

    const marketId = await seedOpenMarket({ createdBy: userId, marketType: 'multiple_choice' });
    const options = await seedMarketOptions(marketId, [
      { label: 'Time A', odds: 3.5, sortOrder: 0 },
      { label: 'Time B', odds: 2.2, sortOrder: 1 },
      { label: 'Time C', odds: 5.0, sortOrder: 2 },
      { label: 'Empate', odds: 3.0, sortOrder: 3 },
    ]);
    const winningOption = options[2]; // Time C

    const winnerWagerId = await seedWager({
      userId, marketId, optionId: winningOption.id, amount: 20, oddsAtTime: 5.0, potentialPayout: 100,
    });
    const loserAWagerId = await seedWager({
      userId, marketId, optionId: options[0].id, amount: 20, oddsAtTime: 3.5, potentialPayout: 70,
    });
    const loserBWagerId = await seedWager({
      userId, marketId, optionId: options[1].id, amount: 20, oddsAtTime: 2.2, potentialPayout: 44,
    });
    const loserDrawWagerId = await seedWager({
      userId, marketId, optionId: options[3].id, amount: 20, oddsAtTime: 3.0, potentialPayout: 60,
    });

    const resolved = await marketService.resolveMarket(marketId, undefined, winningOption.id);
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter - balanceBefore).toBe(100);

    expect(await getWagerStatus(winnerWagerId)).toBe('won');
    expect(await getWagerStatus(loserAWagerId)).toBe('lost');
    expect(await getWagerStatus(loserBWagerId)).toBe('lost');
    expect(await getWagerStatus(loserDrawWagerId)).toBe('lost');

    expect(resolved.status).toBe('resolved');
    expect(resolved.winning_option_id).toBe(winningOption.id);
  });

  test('(d) CRÍTICO — cashout parcial prévio numa aposta option_id-based: resolução paga só a fração restante (remainingFraction), não o potential_payout integral (regressão do fix Phase 2 CR-02/CR-03 sob o novo branch)', async () => {
    await seedWallet(userId, 1000);
    const balanceBefore = await getWalletBalance(userId);

    const marketId = await seedOpenMarket({ createdBy: userId, marketType: 'multiple_choice' });
    const options = await seedMarketOptions(marketId, [
      { label: 'Opção 1', odds: 2.0, sortOrder: 0 },
      { label: 'Opção 2', odds: 2.0, sortOrder: 1 },
    ]);
    const winningOption = options[0];

    // amount=100, potential_payout=200, cashed_out_amount=40 (40% já sacado
    // via cashout parcial) -> remainingFraction = (100-40)/100 = 0.6 ->
    // payout esperado = 200 * 0.6 = 120, NUNCA os 200 integrais.
    const wagerId = await seedWager({
      userId,
      marketId,
      optionId: winningOption.id,
      amount: 100,
      oddsAtTime: 2.0,
      potentialPayout: 200,
      cashedOutAmount: 40,
    });

    const resolved = await marketService.resolveMarket(marketId, undefined, winningOption.id);
    await wait();

    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter - balanceBefore).toBe(120);

    const txn = await getLatestWalletTransaction(userId);
    expect(Number(txn.amount)).toBe(120);
    expect(txn.related_entity).toBe('market_resolved');

    expect(await getWagerStatus(wagerId)).toBe('won');
    expect(resolved.status).toBe('resolved');
  });

  test('(e) IDOR na resolução (MARKET-06): winning_option_id de outro mercado é rejeitado antes de qualquer escrita na carteira', async () => {
    await seedWallet(userId, 1000);
    const balanceBefore = await getWalletBalance(userId);

    const marketA = await seedOpenMarket({ createdBy: userId, marketType: 'multiple_choice' });
    const optionsA = await seedMarketOptions(marketA, [
      { label: 'A1', odds: 2.0, sortOrder: 0 },
      { label: 'A2', odds: 2.0, sortOrder: 1 },
    ]);

    const marketB = await seedOpenMarket({ createdBy: userId, marketType: 'multiple_choice' });
    const optionsB = await seedMarketOptions(marketB, [
      { label: 'B1', odds: 2.0, sortOrder: 0 },
      { label: 'B2', odds: 2.0, sortOrder: 1 },
    ]);
    const wagerBId = await seedWager({
      userId, marketId: marketB, optionId: optionsB[0].id,
      amount: 100, oddsAtTime: 2.0, potentialPayout: 200,
    });

    // optionsA[0].id pertence ao mercado A — resolver o mercado B com essa
    // option_id deve ser rejeitado antes de qualquer pagamento.
    await expect(marketService.resolveMarket(marketB, undefined, optionsA[0].id)).rejects.toThrow(ValidationError);
    await wait();

    // Nenhuma escrita na carteira deve ter ocorrido.
    const balanceAfter = await getWalletBalance(userId);
    expect(balanceAfter).toBe(balanceBefore);

    // A aposta pendente do mercado B continua pendente (não foi processada).
    expect(await getWagerStatus(wagerBId)).toBe('pending');

    // O mercado B continua aberto (a rejeição aconteceu antes do UPDATE de resolução).
    const marketBRow = await query('SELECT status FROM markets WHERE id = $1;', [marketB]);
    expect(marketBRow.rows[0].status).toBe('open');
  });

  test('mercado já resolvido é rejeitado (ConflictError, idempotência preservada)', async () => {
    const marketId = await seedOpenMarket({ createdBy: userId });
    await marketService.resolveMarket(marketId, 'yes');
    await wait();

    await expect(marketService.resolveMarket(marketId, 'no')).rejects.toThrow();
  });
});
