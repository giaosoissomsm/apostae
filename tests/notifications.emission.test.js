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

    expect(result).toEqual({ ok: true });
    expect(listener.captured).toHaveLength(1);
    expect(listener.captured[0].payload).toEqual({
      wagerId: wager.id,
      userId,
      marketId: market.id,
      question: market.question,
      amount: 20,
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
});
