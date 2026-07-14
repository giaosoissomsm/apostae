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
 * Encerra o pool de conexões Postgres — chamar em afterAll para permitir
 * que o processo Jest finalize sem handles abertos.
 */
async function closePool() {
  await pool.end();
}

module.exports = {
  assertTestDatabase,
  applyNotificationsMigration,
  truncateNotifications,
  closePool,
};
