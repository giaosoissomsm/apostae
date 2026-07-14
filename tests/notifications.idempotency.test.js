// Requisito coberto: NOTIF-09 — idempotência: o mesmo evento de domínio não
// deve gerar notificações duplicadas (UNIQUE(user_id, type, related_entity, related_id)),
// e a entrega duplicada nunca deve lançar exceção nem derrubar o processo.

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

describe('notificationService idempotency (NOTIF-09)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyNotificationsMigration();
    notificationService.register();
    userId = await seedTestUser('notif_idem_user');
  });

  beforeEach(async () => {
    await truncateNotifications();
  });

  afterAll(async () => {
    await closePool();
  });

  test('emitir o mesmo evento de domínio duas vezes gera apenas uma notificação (23505 ignorado)', async () => {
    const payload = {
      wagerId: 9001,
      userId,
      marketId: 5001,
      question: 'O time A vence o jogo?',
      choice: 'yes',
      amount: 50,
    };

    expect(() => {
      domainEvents.emit('wager.placed', payload);
      domainEvents.emit('wager.placed', payload);
    }).not.toThrow();

    await wait();

    const { data } = await notificationRepository.findByUserId(userId, { page: 1, limit: 20 });
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe('wager.placed');
    expect(data[0].related_entity).toBe('wager');
    expect(data[0].related_id).toBe(payload.wagerId);
  });

  test('notify() chamado duas vezes com o mesmo payload não lança e cria apenas uma linha', async () => {
    const evt = {
      type: 'market.closed',
      title: 'Mercado fechado',
      body: 'Corpo de teste',
      relatedEntity: 'market',
      relatedId: 7777,
    };

    await expect(notificationService.notify(userId, evt)).resolves.toBeUndefined();
    await expect(notificationService.notify(userId, evt)).resolves.toBeUndefined();

    const count = await notificationRepository.countUnread(userId);
    expect(count).toBe(1);
  });

  test('um listener que falha não impede a notificação de ser criada nem derruba o processo', async () => {
    // Registra um listener adicional, quebrado, no mesmo evento — não deve
    // interferir no listener real do notificationService (safeHandler
    // contém erros por listener, não globalmente).
    const brokenListener = () => {
      throw new Error('listener de teste propositalmente quebrado');
    };
    domainEvents.on('wager.won', brokenListener);

    try {
      expect(() => {
        domainEvents.emit('wager.won', {
          wagerId: 9002,
          userId,
          marketId: 5002,
          question: 'O time B vence o jogo?',
          amount: 20,
          payout: 40,
        });
      }).not.toThrow();

      await wait();

      const row = await notificationRepository.findById(
        (await notificationRepository.findByUserId(userId, { page: 1, limit: 20, unreadOnly: true })).data
          .find((n) => n.type === 'wager.won').id,
        userId
      );
      expect(row).not.toBeNull();
      expect(row.related_id).toBe(9002);
    } finally {
      domainEvents.removeListener('wager.won', brokenListener);
    }
  });
});
