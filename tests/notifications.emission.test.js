// Requisitos cobertos: NOTIF-01..05 — os pontos de emissão reais em
// wagerService/marketService disparam domainEvents.emit(...) com o payload
// exato do catálogo (ver 01-02-SUMMARY.md / notifications.events.test.js)
// SOMENTE depois do commit da transação financeira (D-01), nunca de dentro
// do client de transação, e nenhum evento é emitido se a transação sofrer
// rollback (Pitfall 4 / T-01-03, T-01-06).

const {
  applyBaseSchema,
  applyWalletSchema,
  seedTestUser,
  seedWallet,
  wait,
  closePool,
} = require('./helpers/testDb');
const { query } = require('../src/config/database');
const domainEvents = require('../src/events/domainEvents');
const wagerService = require('../src/services/wagerService');
const marketService = require('../src/services/marketService');
const env = require('../src/config/env');
const money = require('../src/utils/money');

describe('emissão de eventos de domínio a partir de wagerService/marketService (NOTIF-01..05)', () => {
  let adminId;
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    adminId = await seedTestUser('emit_admin');
    userId = await seedTestUser('emit_user');
    await seedWallet(userId, 1000);
  });

  afterAll(async () => {
    await closePool();
  });

  // Cria um mercado real (via SQL direto, sem passar por marketService.createMarket
  // — não é o alvo deste teste) com odds/prazo controlados pelo teste.
  async function createMarket(overrides = {}) {
    const result = await query(
      `INSERT INTO markets (question, description, odds_yes, odds_no, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;`,
      [
        overrides.question || 'Vai chover amanhã?',
        '',
        overrides.oddsYes || 2.0,
        overrides.oddsNo || 2.0,
        overrides.status || 'open',
        adminId,
      ]
    );
    return result.rows[0];
  }

  // Registra listeners temporários em domainEvents pros nomes dados,
  // capturando (nome, payload) na ordem de disparo; stop() remove os
  // listeners no final do teste pra não vazar entre testes.
  function captureEvents(...names) {
    const captured = [];
    const bound = names.map((name) => {
      const handler = (payload) => captured.push({ name, payload });
      domainEvents.on(name, handler);
      return { name, handler };
    });
    return {
      captured,
      stop() {
        bound.forEach(({ name, handler }) => domainEvents.off(name, handler));
      },
    };
  }

  test('wagerService.placeWager emite wager.placed com o payload correto após o commit', async () => {
    const market = await createMarket();
    const listener = captureEvents('wager.placed');

    const wager = await wagerService.placeWager(userId, {
      market_id: market.id,
      choice: 'yes',
      amount: 30,
    });
    await wait();
    listener.stop();

    expect(listener.captured).toHaveLength(1);
    expect(listener.captured[0].payload).toEqual({
      wagerId: wager.id,
      userId,
      marketId: market.id,
      question: market.question,
      choice: 'yes',
      amount: 30,
    });
  });

  test('wagerService.placeWager não emite wager.placed quando a transação sofre rollback', async () => {
    // Mercado fechado força ConflictError dentro da transação -> ROLLBACK.
    const market = await createMarket({ status: 'closed' });
    const listener = captureEvents('wager.placed');

    await expect(
      wagerService.placeWager(userId, { market_id: market.id, choice: 'yes', amount: 10 })
    ).rejects.toThrow();
    await wait();
    listener.stop();

    expect(listener.captured).toHaveLength(0);
  });

  test('wagerService.cancelWager emite wager.cancelled com o payload correto após o commit', async () => {
    const market = await createMarket();
    const wager = await wagerService.placeWager(userId, {
      market_id: market.id,
      choice: 'no',
      amount: 20,
    });

    const listener = captureEvents('wager.cancelled');
    const result = await wagerService.cancelWager(wager.id, userId);
    await wait();
    listener.stop();

    // 04-01 rewrote cancelWager to charge CANCEL_FEE_PERCENT (5% por padrão)
    // e retornar { ok, refunded, fee } em vez de { ok } — ver 04-REVIEW.md WR-02.
    const { fee, net } = money.applyFeePercent(20, env.CANCEL_FEE_PERCENT);
    expect(result).toEqual({ ok: true, refunded: net, fee });
    expect(listener.captured).toHaveLength(1);
    expect(listener.captured[0].payload).toEqual({
      wagerId: wager.id,
      userId,
      marketId: market.id,
      question: market.question,
      grossAmount: 20,
      netAmount: net,
      feeAmount: fee,
    });
  });

  test('wagerService.cancelWager não emite wager.cancelled quando a transação sofre rollback', async () => {
    const market = await createMarket();
    const wager = await wagerService.placeWager(userId, {
      market_id: market.id,
      choice: 'yes',
      amount: 10,
    });
    // Cancela uma vez com sucesso (status vira 'refunded'); a segunda
    // tentativa deve dar ConflictError ("não pode mais ser cancelada") e
    // sofrer ROLLBACK, sem emitir nada.
    await wagerService.cancelWager(wager.id, userId);

    const listener = captureEvents('wager.cancelled');
    await expect(wagerService.cancelWager(wager.id, userId)).rejects.toThrow();
    await wait();
    listener.stop();

    expect(listener.captured).toHaveLength(0);
  });

  test('marketService.closeMarket emite market.closed com os recipients das apostas pendentes', async () => {
    const market = await createMarket();
    await wagerService.placeWager(userId, { market_id: market.id, choice: 'yes', amount: 15 });

    const listener = captureEvents('market.closed');
    const closed = await marketService.closeMarket(market.id);
    await wait();
    listener.stop();

    expect(closed.status).toBe('closed');
    expect(listener.captured).toHaveLength(1);
    expect(listener.captured[0].payload).toEqual({
      marketId: market.id,
      question: market.question,
      recipients: [userId],
    });
  });

  test('marketService.closeMarket não emite nada quando já não está aberto (idempotente)', async () => {
    const market = await createMarket({ status: 'closed' });

    const listener = captureEvents('market.closed');
    const result = await marketService.closeMarket(market.id);
    await wait();
    listener.stop();

    expect(result.id).toBe(market.id);
    expect(listener.captured).toHaveLength(0);
  });

  test('marketService.resolveMarket emite market.resolved + wager.won/wager.lost por aposta pendente, após o commit', async () => {
    const market = await createMarket({ oddsYes: 2.0, oddsNo: 2.0 });
    const secondUser = await seedTestUser('emit_user_resolve_2');
    await seedWallet(secondUser, 1000);

    const winner = await wagerService.placeWager(userId, { market_id: market.id, choice: 'yes', amount: 10 });
    const loser = await wagerService.placeWager(secondUser, { market_id: market.id, choice: 'no', amount: 10 });

    const listener = captureEvents('market.resolved', 'wager.won', 'wager.lost');
    const resolved = await marketService.resolveMarket(market.id, 'yes');
    await wait();
    listener.stop();

    // Formato de retorno pro controller (res.json(market)) não deve vazar
    // campos internos usados só pra montar os eventos.
    expect(resolved.outcome).toBe('yes');
    expect(resolved.wagerOutcomes).toBeUndefined();

    const resolvedEvt = listener.captured.find((e) => e.name === 'market.resolved');
    expect(resolvedEvt.payload).toEqual({
      marketId: market.id,
      question: market.question,
      outcome: 'yes',
      recipients: expect.arrayContaining([userId, secondUser]),
    });
    expect(resolvedEvt.payload.recipients).toHaveLength(2);

    const wonEvt = listener.captured.find((e) => e.name === 'wager.won');
    expect(wonEvt.payload).toEqual({
      wagerId: winner.id,
      userId,
      marketId: market.id,
      question: market.question,
      amount: 10,
      payout: winner.potential_payout,
    });

    const lostEvt = listener.captured.find((e) => e.name === 'wager.lost');
    expect(lostEvt.payload).toEqual({
      wagerId: loser.id,
      userId: secondUser,
      marketId: market.id,
      question: market.question,
      amount: 10,
    });
  });

  test('marketService.resolveMarket não emite nada quando a transação sofre rollback (já resolvido)', async () => {
    const market = await createMarket();
    await marketService.resolveMarket(market.id, 'yes');

    const listener = captureEvents('market.resolved', 'wager.won', 'wager.lost');
    await expect(marketService.resolveMarket(market.id, 'yes')).rejects.toThrow();
    await wait();
    listener.stop();

    expect(listener.captured).toHaveLength(0);
  });

  test('marketService.deleteMarket emite market.deleted com os reembolsos, após o commit', async () => {
    const market = await createMarket();
    const wager = await wagerService.placeWager(userId, { market_id: market.id, choice: 'yes', amount: 12 });

    const listener = captureEvents('market.deleted');
    const result = await marketService.deleteMarket(market.id);
    await wait();
    listener.stop();

    expect(result).toEqual({ ok: true, message: 'Mercado deletado.' });
    expect(listener.captured).toHaveLength(1);
    expect(listener.captured[0].payload).toEqual({
      marketId: market.id,
      question: market.question,
      refunds: [{ userId, wagerId: wager.id, amount: 12 }],
    });
  });

  test('marketService.deleteMarket não emite nada quando a transação sofre rollback (mercado inexistente)', async () => {
    const listener = captureEvents('market.deleted');
    await expect(marketService.deleteMarket(999999)).rejects.toThrow();
    await wait();
    listener.stop();

    expect(listener.captured).toHaveLength(0);
  });
});
