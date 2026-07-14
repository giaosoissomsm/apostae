// Requisito coberto: NOTIF-06 — listagem paginada de notificações do usuário
// (LIMIT/OFFSET, ORDER BY created_at DESC, id DESC).

const {
  applyBaseSchema,
  applyNotificationsMigration,
  seedTestUser,
  truncateNotifications,
  closePool,
} = require('./helpers/testDb');
const notificationRepository = require('../src/repositories/notificationRepository');

describe('notifications — paginação e ordenação (NOTIF-06)', () => {
  let userId;
  let otherUserId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyNotificationsMigration();
    userId = await seedTestUser('notif_page_user1');
    otherUserId = await seedTestUser('notif_page_user2');
  });

  beforeEach(async () => {
    await truncateNotifications();
  });

  afterAll(async () => {
    await closePool();
  });

  async function seedN(n, targetUserId = userId) {
    const rows = [];
    for (let i = 1; i <= n; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const row = await notificationRepository.create({
        userId: targetUserId,
        type: 'wager.placed',
        title: `Notificação ${i}`,
        body: `Corpo ${i}`,
        relatedEntity: 'wager',
        relatedId: i,
      });
      rows.push(row);
    }
    return rows;
  }

  test('lista é ordenada por created_at DESC, id DESC (mais recente primeiro)', async () => {
    const seeded = await seedN(5);

    const { data } = await notificationRepository.findByUserId(userId, { page: 1, limit: 20 });

    expect(data).toHaveLength(5);
    // A última inserida (maior id) deve vir primeiro.
    const ids = data.map((row) => row.id);
    const sortedDesc = [...ids].sort((a, b) => b - a);
    expect(ids).toEqual(sortedDesc);
    expect(data[0].id).toBe(seeded[seeded.length - 1].id);
  });

  test('page/limit são respeitados (offset correto)', async () => {
    const seeded = await seedN(5);

    const page1 = await notificationRepository.findByUserId(userId, { page: 1, limit: 2 });
    const page2 = await notificationRepository.findByUserId(userId, { page: 2, limit: 2 });

    expect(page1.data).toHaveLength(2);
    expect(page2.data).toHaveLength(2);
    expect(page1.pagination.total).toBe(5);
    expect(page1.pagination.page).toBe(1);
    expect(page2.pagination.page).toBe(2);

    // As duas primeiras notificações mais recentes (maiores ids) na página 1,
    // as duas seguintes na página 2 — sem sobreposição.
    const page1Ids = page1.data.map((r) => r.id);
    const page2Ids = page2.data.map((r) => r.id);
    expect(page1Ids).toEqual([seeded[4].id, seeded[3].id]);
    expect(page2Ids).toEqual([seeded[2].id, seeded[1].id]);
  });

  test('limit acima de 100 é limitado (hard-capped) no servidor', async () => {
    await seedN(3);

    const result = await notificationRepository.findByUserId(userId, { page: 1, limit: 5000 });

    expect(result.pagination.limit).toBe(100);
    // Continua retornando só o que existe (3), nunca mais que o pedido/cap.
    expect(result.data.length).toBeLessThanOrEqual(100);
  });

  test('unread_only filtra notificações lidas', async () => {
    const seeded = await seedN(4);
    // Marca duas como lidas.
    await notificationRepository.markRead(seeded[0].id, userId);
    await notificationRepository.markRead(seeded[1].id, userId);

    const unreadOnly = await notificationRepository.findByUserId(userId, {
      page: 1,
      limit: 20,
      unreadOnly: true,
    });

    expect(unreadOnly.data).toHaveLength(2);
    expect(unreadOnly.data.every((row) => row.read_at === null)).toBe(true);

    const all = await notificationRepository.findByUserId(userId, { page: 1, limit: 20 });
    expect(all.data).toHaveLength(4);
  });

  test('listagem é escopada — nunca mistura notificações de outro usuário', async () => {
    await seedN(2, otherUserId);
    await seedN(3, userId);

    const result = await notificationRepository.findByUserId(userId, { page: 1, limit: 20 });

    expect(result.data).toHaveLength(3);
    expect(result.data.every((row) => row.user_id === userId)).toBe(true);
  });
});
