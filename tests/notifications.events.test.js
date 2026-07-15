// Requisitos cobertos: NOTIF-01..05 — eventos de domínio (aposta feita,
// aposta ganha, aposta perdida, aposta cancelada, mercado fechado/resolvido/
// deletado) disparam a criação da notificação correspondente via
// domainEvents, com o texto em português e escopo correto por usuário.

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

describe('notificationService — catálogo de 7 eventos (NOTIF-01..05)', () => {
  let u1;
  let u2;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyNotificationsMigration();
    notificationService.register();
    u1 = await seedTestUser('notif_evt_user1');
    u2 = await seedTestUser('notif_evt_user2');
  });

  beforeEach(async () => {
    await truncateNotifications();
  });

  afterAll(async () => {
    await closePool();
  });

  async function onlyRowFor(userId) {
    const { data } = await notificationRepository.findByUserId(userId, { page: 1, limit: 20 });
    expect(data).toHaveLength(1);
    return data[0];
  }

  test('wager.placed cria notificação escopada pro apostador com valor e pergunta', async () => {
    domainEvents.emit('wager.placed', {
      wagerId: 101,
      userId: u1,
      marketId: 201,
      question: 'Vai chover amanhã?',
      choice: 'yes',
      amount: 30,
    });
    await wait();

    const row = await onlyRowFor(u1);
    expect(row.type).toBe('wager.placed');
    expect(row.related_entity).toBe('wager');
    expect(row.related_id).toBe(101);
    expect(row.body).toContain('30.00');
    expect(row.body).toContain('Vai chover amanhã?');
  });

  test('wager.cancelled cria notificação escopada pro apostador', async () => {
    domainEvents.emit('wager.cancelled', {
      wagerId: 102,
      userId: u1,
      marketId: 201,
      question: 'Vai chover amanhã?',
      grossAmount: 30,
      netAmount: 28.5,
      feeAmount: 1.5,
    });
    await wait();

    const row = await onlyRowFor(u1);
    expect(row.type).toBe('wager.cancelled');
    expect(row.related_entity).toBe('wager');
    expect(row.related_id).toBe(102);
    expect(row.body).toContain('30.00');
    expect(row.body).toContain('28.50');
    expect(row.body).toContain('1.50');
    expect(row.body).toContain('Vai chover amanhã?');
  });

  test('wager.won cria notificação com valor apostado e payout', async () => {
    domainEvents.emit('wager.won', {
      wagerId: 103,
      userId: u1,
      marketId: 201,
      question: 'Vai chover amanhã?',
      amount: 30,
      payout: 60,
    });
    await wait();

    const row = await onlyRowFor(u1);
    expect(row.type).toBe('wager.won');
    expect(row.related_entity).toBe('wager');
    expect(row.related_id).toBe(103);
    expect(row.body).toContain('30.00');
    expect(row.body).toContain('60.00');
    expect(row.body).toContain('Vai chover amanhã?');
  });

  test('wager.lost cria notificação escopada pro apostador', async () => {
    domainEvents.emit('wager.lost', {
      wagerId: 104,
      userId: u1,
      marketId: 201,
      question: 'Vai chover amanhã?',
      amount: 30,
    });
    await wait();

    const row = await onlyRowFor(u1);
    expect(row.type).toBe('wager.lost');
    expect(row.related_entity).toBe('wager');
    expect(row.related_id).toBe(104);
    expect(row.body).toContain('30.00');
    expect(row.body).toContain('Vai chover amanhã?');
  });

  test('market.closed cria uma notificação por destinatário em recipients', async () => {
    domainEvents.emit('market.closed', {
      marketId: 301,
      question: 'Quem ganha a eleição?',
      recipients: [u1, u2],
    });
    await wait();

    const row1 = await onlyRowFor(u1);
    expect(row1.type).toBe('market.closed');
    expect(row1.related_entity).toBe('market');
    expect(row1.related_id).toBe(301);
    expect(row1.body).toContain('Quem ganha a eleição?');

    const row2 = await onlyRowFor(u2);
    expect(row2.type).toBe('market.closed');
    expect(row2.related_id).toBe(301);
  });

  test('market.resolved cria uma notificação por destinatário com o resultado', async () => {
    domainEvents.emit('market.resolved', {
      marketId: 302,
      question: 'Quem ganha a eleição?',
      outcome: 'yes',
      recipients: [u1, u2],
    });
    await wait();

    const row1 = await onlyRowFor(u1);
    expect(row1.type).toBe('market.resolved');
    expect(row1.related_entity).toBe('market');
    expect(row1.related_id).toBe(302);
    expect(row1.body).toContain('Quem ganha a eleição?');

    const row2 = await onlyRowFor(u2);
    expect(row2.type).toBe('market.resolved');
    expect(row2.related_id).toBe(302);
  });

  test('market.deleted cria uma notificação por reembolso, escopada por wager', async () => {
    domainEvents.emit('market.deleted', {
      marketId: 303,
      question: 'Mercado cancelado por engano',
      refunds: [
        { userId: u1, wagerId: 401, amount: 15 },
        { userId: u2, wagerId: 402, amount: 25 },
      ],
    });
    await wait();

    const row1 = await onlyRowFor(u1);
    expect(row1.type).toBe('market.deleted');
    expect(row1.related_entity).toBe('wager');
    expect(row1.related_id).toBe(401);
    expect(row1.body).toContain('15.00');
    expect(row1.body).toContain('Mercado cancelado por engano');

    const row2 = await onlyRowFor(u2);
    expect(row2.type).toBe('market.deleted');
    expect(row2.related_entity).toBe('wager');
    expect(row2.related_id).toBe(402);
    expect(row2.body).toContain('25.00');
  });
});
