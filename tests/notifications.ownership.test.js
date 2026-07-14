// Requisito coberto: NOTIF-08 — ownership scoping (IDOR): um usuário nunca
// pode ler, listar ou marcar como lida a notificação de outro usuário.

const {
  applyBaseSchema,
  applyNotificationsMigration,
  seedTestUser,
  truncateNotifications,
  closePool,
} = require('./helpers/testDb');
const notificationService = require('../src/services/notificationService');
const notificationRepository = require('../src/repositories/notificationRepository');
const { NotFoundError } = require('../src/utils/errors');

describe('notifications — ownership scoping / IDOR (NOTIF-08)', () => {
  let userA;
  let userB;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyNotificationsMigration();
    userA = await seedTestUser('notif_own_userA');
    userB = await seedTestUser('notif_own_userB');
  });

  beforeEach(async () => {
    await truncateNotifications();
  });

  afterAll(async () => {
    await closePool();
  });

  test('usuário A não pode marcar como lida notificação de usuário B (404, não 403)', async () => {
    const bNotification = await notificationRepository.create({
      userId: userB,
      type: 'wager.won',
      title: 'Você ganhou!',
      body: 'Notificação privada do usuário B',
      relatedEntity: 'wager',
      relatedId: 501,
    });

    await expect(notificationService.markRead(bNotification.id, userA)).rejects.toThrow(NotFoundError);

    // A linha de B permanece intocada — a tentativa de A nem sequer chegou
    // perto de alterar read_at.
    const untouched = await notificationRepository.findById(bNotification.id, userB);
    expect(untouched).not.toBeNull();
    expect(untouched.read_at).toBeNull();
  });

  test('usuário A não consegue buscar notificação de usuário B por id (escopado, retorna null)', async () => {
    const bNotification = await notificationRepository.create({
      userId: userB,
      type: 'wager.lost',
      title: 'Aposta perdida',
      body: 'Notificação privada do usuário B',
      relatedEntity: 'wager',
      relatedId: 502,
    });

    // Mesmo conhecendo/adivinhando o id correto, o escopo por user_id nega o acesso.
    const asA = await notificationRepository.findById(bNotification.id, userA);
    expect(asA).toBeNull();

    const asB = await notificationRepository.findById(bNotification.id, userB);
    expect(asB).not.toBeNull();
    expect(asB.id).toBe(bNotification.id);
  });

  test('listagem de A nunca inclui notificações de B', async () => {
    await notificationRepository.create({
      userId: userB,
      type: 'market.closed',
      title: 'Mercado fechado',
      body: 'Notificação privada do usuário B',
      relatedEntity: 'market',
      relatedId: 503,
    });
    await notificationRepository.create({
      userId: userA,
      type: 'market.closed',
      title: 'Mercado fechado',
      body: 'Notificação do usuário A',
      relatedEntity: 'market',
      relatedId: 504,
    });

    const { data } = await notificationService.listForUser(userA, { page: 1, limit: 20 });
    expect(data).toHaveLength(1);
    expect(data[0].user_id).toBe(userA);
  });

  test('markRead em id inexistente também retorna 404 (não vaza diferença entre inexistente e de outro usuário)', async () => {
    await expect(notificationService.markRead(999999, userA)).rejects.toThrow(NotFoundError);
  });
});
