// Requisito coberto: NOTIF-07 — estado de leitura: marcar notificação como
// lida (idempotente) e contagem de não lidas. D-08: listar nunca marca como
// lida (side-effect-free).

const {
  applyBaseSchema,
  applyNotificationsMigration,
  seedTestUser,
  truncateNotifications,
  closePool,
} = require('./helpers/testDb');
const notificationService = require('../src/services/notificationService');
const notificationRepository = require('../src/repositories/notificationRepository');

describe('notifications — estado de leitura (NOTIF-07, D-08)', () => {
  let userId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyNotificationsMigration();
    userId = await seedTestUser('notif_read_user1');
  });

  beforeEach(async () => {
    await truncateNotifications();
  });

  afterAll(async () => {
    await closePool();
  });

  test('mark-read persiste read_at entre requisições (re-fetch)', async () => {
    const created = await notificationRepository.create({
      userId,
      type: 'wager.won',
      title: 'Você ganhou!',
      body: 'Notificação de teste',
      relatedEntity: 'wager',
      relatedId: 601,
    });
    expect(created.read_at).toBeNull();

    const marked = await notificationService.markRead(created.id, userId);
    expect(marked.read_at).not.toBeNull();

    // Re-fetch independente (simula uma nova requisição HTTP) — o estado
    // continua lido, não é apenas um valor em memória do retorno anterior.
    const refetched = await notificationRepository.findById(created.id, userId);
    expect(refetched.read_at).not.toBeNull();
    expect(new Date(refetched.read_at).getTime()).toBe(new Date(marked.read_at).getTime());
  });

  test('mark-read é idempotente — segunda chamada não lança erro e retorna a mesma linha lida', async () => {
    const created = await notificationRepository.create({
      userId,
      type: 'wager.lost',
      title: 'Aposta perdida',
      body: 'Notificação de teste',
      relatedEntity: 'wager',
      relatedId: 602,
    });

    const firstMark = await notificationService.markRead(created.id, userId);
    const secondMark = await notificationService.markRead(created.id, userId);

    expect(firstMark.read_at).not.toBeNull();
    expect(secondMark.id).toBe(created.id);
    expect(secondMark.read_at).not.toBeNull();
    // read_at não deve ser reescrito numa segunda marcação (mesmo timestamp).
    expect(new Date(secondMark.read_at).getTime()).toBe(new Date(firstMark.read_at).getTime());
  });

  test('listagem (listForUser) nunca marca notificações como lidas (side-effect-free)', async () => {
    const created = await notificationRepository.create({
      userId,
      type: 'market.resolved',
      title: 'Mercado resolvido',
      body: 'Notificação de teste',
      relatedEntity: 'market',
      relatedId: 603,
    });
    expect(created.read_at).toBeNull();

    // Listar (potencialmente múltiplas vezes) não deve ter nenhum efeito
    // colateral sobre o estado de leitura.
    await notificationService.listForUser(userId, { page: 1, limit: 20 });
    await notificationService.listForUser(userId, { page: 1, limit: 20, unreadOnly: false });

    const afterListing = await notificationRepository.findById(created.id, userId);
    expect(afterListing.read_at).toBeNull();
  });

  test('contagem de não lidas reflete o estado de leitura corretamente', async () => {
    const first = await notificationRepository.create({
      userId,
      type: 'wager.placed',
      title: 'Aposta registrada',
      body: 'Notificação de teste',
      relatedEntity: 'wager',
      relatedId: 604,
    });
    await notificationRepository.create({
      userId,
      type: 'wager.won',
      title: 'Você ganhou!',
      body: 'Notificação de teste',
      relatedEntity: 'wager',
      relatedId: 605,
    });

    expect(await notificationService.getUnreadCount(userId)).toBe(2);

    await notificationService.markRead(first.id, userId);

    expect(await notificationService.getUnreadCount(userId)).toBe(1);
  });
});
