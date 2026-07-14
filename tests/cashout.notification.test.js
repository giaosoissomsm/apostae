// Requisito coberto: CASHOUT-08 (notificação de cashout) e a correção de
// Pitfall 3 do RESEARCH.md — o listener wager.cashed_out do
// notificationService PRECISA usar relatedId: evt.cashoutId (não
// evt.wagerId), senão um segundo cashout no mesmo wager seria
// silenciosamente engolido pela constraint UNIQUE(user_id, type,
// related_entity, related_id) via o catch de 23505 já existente em
// notificationService.notify().
//
// Este teste dispara domainEvents.emit('wager.cashed_out', ...) diretamente
// com payloads sintéticos — não precisa rodar a transação real de
// wagerService.cashoutWager (isso já é coberto por
// tests/cashout.computation.test.js / cashout.validation.test.js); aqui o
// alvo é isolar o comportamento do listener em si.

const {
  applyBaseSchema,
  applyNotificationsMigration,
  seedTestUser,
  truncateNotifications,
  wait,
  closePool,
} = require('./helpers/testDb');
const domainEvents = require('../src/events/domainEvents');
const notificationService = require('../src/services/notificationService');
const notificationRepository = require('../src/repositories/notificationRepository');

describe('notificationService — listener wager.cashed_out (CASHOUT-08, RESEARCH.md Pitfall 3)', () => {
  let userId;
  const wagerId = 42001;
  const marketId = 6001;
  const question = 'O time A vence o jogo?';

  beforeAll(async () => {
    await applyBaseSchema();
    await applyNotificationsMigration();
    notificationService.register();
    userId = await seedTestUser('cashout_notif_user');
  });

  beforeEach(async () => {
    await truncateNotifications();
  });

  afterAll(async () => {
    await closePool();
  });

  function emitCashout({ cashoutId, netValue = 30 }) {
    domainEvents.emit('wager.cashed_out', {
      cashoutId,
      wagerId,
      userId,
      marketId,
      question,
      netValue,
      grossValue: netValue,
      feeAmount: 0,
      stakeCashedOut: 15,
      remainingStake: 85,
    });
  }

  test('emitir wager.cashed_out com cashoutId=1 gera uma notificação com relatedEntity=cashout e relatedId=1', async () => {
    emitCashout({ cashoutId: 1 });
    await wait();

    const { data } = await notificationRepository.findByUserId(userId, { page: 1, limit: 20 });
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe('wager.cashed_out');
    expect(data[0].related_entity).toBe('cashout');
    expect(data[0].related_id).toBe(1);
  });

  test('um segundo cashout no MESMO wager, com cashoutId diferente (2), gera uma segunda notificação distinta (não colide com a constraint UNIQUE)', async () => {
    emitCashout({ cashoutId: 1 });
    await wait();
    emitCashout({ cashoutId: 2 });
    await wait();

    const { data } = await notificationRepository.findByUserId(userId, { page: 1, limit: 20 });
    expect(data).toHaveLength(2);

    const relatedIds = data.map((row) => row.related_id).sort((a, b) => a - b);
    expect(relatedIds).toEqual([1, 2]);
    data.forEach((row) => {
      expect(row.type).toBe('wager.cashed_out');
      expect(row.related_entity).toBe('cashout');
    });
  });

  test('emitir wager.cashed_out duas vezes com o MESMO cashoutId (entrega duplicada genuína) gera apenas uma notificação', async () => {
    emitCashout({ cashoutId: 1 });
    await wait();
    emitCashout({ cashoutId: 1 });
    await wait();

    const { data } = await notificationRepository.findByUserId(userId, { page: 1, limit: 20 });
    const forCashout1 = data.filter((row) => row.related_id === 1);
    expect(forCashout1).toHaveLength(1);
  });
});
