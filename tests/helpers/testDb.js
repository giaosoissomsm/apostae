/**
 * Helper de testes de integração — base de dados Postgres de teste.
 *
 * Os testes de integração precisam de um banco Postgres DEDICADO cujo nome
 * contenha a substring "test" (ex.: `apostae_test`), apontado pelas
 * variáveis DB_* padrão (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
 * com NODE_ENV=test. Nunca reutilize o banco de desenvolvimento/produção —
 * este helper trunca a tabela `notifications` entre testes, o que destruiria
 * dados reais se apontado para o banco errado.
 *
 * GUARDA DE SEGURANÇA: toda função que executa DDL/DML aqui verifica que
 * `env.DB_NAME` contém "test" antes de agir. Se a checagem falhar, a função
 * lança um erro e aborta — nada é executado contra um banco não-test.
 */

const env = require('../../src/config/env');
const { query, pool } = require('../../src/config/database');

/**
 * Lança erro se o banco de dados atualmente configurado não for um banco
 * de teste (nome não contém "test"). Chamada por toda operação destrutiva.
 */
function assertTestDatabase() {
  if (!env.DB_NAME || !env.DB_NAME.includes('test')) {
    throw new Error(
      `Recusando operar: DB_NAME="${env.DB_NAME}" não contém "test". ` +
      'Os testes de integração exigem um banco dedicado (ex.: apostae_test) ' +
      'configurado via variáveis DB_* com NODE_ENV=test.'
    );
  }
}

/**
 * Aplica a migration 003 (tabela notifications) no banco de teste.
 * Executa cada string SQL do array `up` sequencialmente.
 */
async function applyNotificationsMigration() {
  assertTestDatabase();
  // Carregado sob demanda (não no topo do arquivo) para que este helper
  // possa ser require()ado mesmo antes da migration 003 existir.
  const notificationsMigration = require('../../src/migrations/003_notifications');
  for (const sql of notificationsMigration.up) {
    await query(sql);
  }
}

/**
 * Trunca a tabela notifications, reiniciando o identity e removendo
 * dependências (CASCADE), para isolar cada teste.
 */
async function truncateNotifications() {
  assertTestDatabase();
  await query('TRUNCATE notifications RESTART IDENTITY CASCADE;');
}

/**
 * Aplica a migration 001 (schema base: users, roles, markets, wagers, etc.).
 * `notifications.user_id` referencia `users(id)`, então os testes de
 * notificações precisam dessa tabela existir antes de inserir qualquer
 * linha. Todas as instruções usam CREATE TABLE IF NOT EXISTS, então rodar
 * isso mais de uma vez (ex.: um beforeAll por arquivo de teste) é seguro.
 */
async function applyBaseSchema() {
  assertTestDatabase();
  const initialMigration = require('../../src/migrations/001_initial');
  for (const sql of initialMigration.up) {
    await query(sql);
  }
}

/**
 * Garante um usuário de teste (idempotente via ON CONFLICT) e retorna o id.
 * Necessário porque `notifications.user_id` tem FK NOT NULL pra users(id).
 */
async function seedTestUser(username) {
  assertTestDatabase();
  const result = await query(
    `INSERT INTO users (username, password_hash)
     VALUES ($1, 'test-hash-not-a-real-password')
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id;`,
    [username]
  );
  return result.rows[0].id;
}

/**
 * Espera `ms` milissegundos. Usado pra dar tempo dos listeners assíncronos
 * de domainEvents (disparados via EventEmitter.emit, que NÃO espera
 * promises) terminarem antes de consultar o resultado no banco.
 */
function wait(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Encerra o pool de conexões Postgres — chamar em afterAll para permitir
 * que o processo Jest finalize sem handles abertos.
 */
async function closePool() {
  await pool.end();
}

module.exports = {
  assertTestDatabase,
  applyNotificationsMigration,
  applyBaseSchema,
  seedTestUser,
  truncateNotifications,
  wait,
  closePool,
};
