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
 * Aplica a migration 002 (schema de carteira: wallets, wallet_transactions).
 * `wagerService.placeWager`/`cancelWager` e `marketService.resolveMarket`/
 * `deleteMarket` leem/gravam na carteira dentro da própria transação
 * financeira, então os testes de emissão de eventos (Plan 04) precisam
 * dessas tabelas existirem. Idempotente (CREATE TABLE IF NOT EXISTS).
 */
async function applyWalletSchema() {
  assertTestDatabase();
  const walletMigration = require('../../src/migrations/002_wallet');
  for (const sql of walletMigration.up) {
    await query(sql);
  }
}

/**
 * Garante uma carteira de teste pro usuário informado (idempotente via
 * ON CONFLICT), com o saldo dado, e retorna o id da carteira.
 */
async function seedWallet(userId, balance = 1000) {
  assertTestDatabase();
  const result = await query(
    `INSERT INTO wallets (user_id, balance)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance
     RETURNING id;`,
    [userId, balance]
  );
  return result.rows[0].id;
}

/**
 * Aplica a migration 004 (wager_cashouts + wagers.cashed_out_amount) no
 * banco de teste. Mesmo formato de applyNotificationsMigration/
 * applyWalletSchema: carregada sob demanda, roda cada string SQL do array
 * `up` sequencialmente, idempotente (CREATE TABLE IF NOT EXISTS / ADD
 * COLUMN IF NOT EXISTS).
 */
async function applyCashoutMigration() {
  assertTestDatabase();
  const cashoutMigration = require('../../src/migrations/004_cashout');
  for (const sql of cashoutMigration.up) {
    await query(sql);
  }
}

/**
 * Aplica a migration 005 (market_type/threshold/market_options/winning_option_id
 * + wagers.option_id/XOR CHECK) e a migration 006 (odds_yes/odds_no
 * passam a ser nullable — over_under/multiple_choice não usam essas
 * colunas, só market_options.odds por linha) no banco de teste. As duas
 * migrations são tratadas como uma unidade aqui porque nenhuma
 * over_under/multiple_choice consegue ser criada sem as duas aplicadas
 * juntas (a 006 corrige uma lacuna que a 005 deixou). Mesmo formato de
 * applyCashoutMigration/applyNotificationsMigration: carregadas sob demanda
 * (não no topo do arquivo, pra este helper parsear mesmo antes das
 * migrations existirem), roda cada string SQL do array `up` sequencialmente,
 * idempotente (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / DROP
 * NOT NULL é idempotente por natureza).
 */
async function applyMarketTypesMigration() {
  assertTestDatabase();
  const marketTypesMigration = require('../../src/migrations/005_market_types');
  for (const sql of marketTypesMigration.up) {
    await query(sql);
  }
  const oddsNullableMigration = require('../../src/migrations/006_market_odds_nullable');
  for (const sql of oddsNullableMigration.up) {
    await query(sql);
  }
}

/**
 * Insere um mercado aberto ('open') de teste e retorna o id. Reaproveita as
 * mesmas colunas que marketRepository.create grava (question, description,
 * odds_yes, odds_no, status, closes_at, reveal_at, scheduled_outcome,
 * created_by) — created_by exige um usuário existente (FK NOT NULL), então
 * o chamador deve passar um userId de um seedTestUser() anterior.
 *
 * `marketType` (default 'binary') e `threshold` (default null) são
 * opcionais — quando omitidos, o INSERT é idêntico ao comportamento atual
 * (regressão binária na camada de fixture, MARKET-03). Passar
 * marketType='over_under'|'multiple_choice' pra semear os novos tipos;
 * combine com seedMarketOptions() pra popular market_options.
 */
async function seedOpenMarket({
  createdBy,
  question = 'Mercado de teste?',
  description = '',
  oddsYes = 2.0,
  oddsNo = 2.0,
  closesAt = null,
  revealAt = null,
  scheduledOutcome = null,
  marketType = 'binary',
  threshold = null,
} = {}) {
  assertTestDatabase();
  if (marketType === 'binary' && threshold === null) {
    // Caminho binário byte-idêntico ao INSERT anterior (MARKET-03) — não
    // referencia market_type/threshold, então continua funcionando mesmo em
    // bancos de teste que ainda não rodaram applyMarketTypesMigration().
    const result = await query(
      `INSERT INTO markets (question, description, odds_yes, odds_no, status, closes_at, reveal_at, scheduled_outcome, created_by)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8)
       RETURNING id;`,
      [question, description, oddsYes, oddsNo, closesAt, revealAt, scheduledOutcome, createdBy]
    );
    return result.rows[0].id;
  }
  const result = await query(
    `INSERT INTO markets (question, description, odds_yes, odds_no, status, closes_at, reveal_at, scheduled_outcome, created_by, market_type, threshold)
     VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8, $9, $10)
     RETURNING id;`,
    [question, description, oddsYes, oddsNo, closesAt, revealAt, scheduledOutcome, createdBy, marketType, threshold]
  );
  return result.rows[0].id;
}

/**
 * Insere N opções em market_options pro mercado informado, via um único
 * INSERT multi-linha parametrizado (nunca concatena labels em SQL —
 * proteção contra injeção, RESEARCH.md Security Domain). Retorna as linhas
 * inseridas (id, sort_order) na ordem de sort_order.
 *
 * `options` é um array de { label, odds, sortOrder }. sortOrder default é
 * o índice do item no array, casando com a ordem de inserção quando o
 * chamador não se importa com ordenação customizada.
 */
async function seedMarketOptions(marketId, options) {
  assertTestDatabase();
  const values = [];
  const placeholders = options
    .map((opt, i) => {
      const base = i * 4;
      values.push(marketId, opt.label, opt.odds, opt.sortOrder != null ? opt.sortOrder : i);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    })
    .join(', ');
  const result = await query(
    `WITH ins AS (
       INSERT INTO market_options (market_id, label, odds, sort_order)
       VALUES ${placeholders}
       RETURNING id, sort_order
     )
     SELECT id, sort_order FROM ins ORDER BY sort_order;`,
    values
  );
  return result.rows;
}

/**
 * Insere uma aposta pendente ('pending') de teste e retorna o id. Aceita
 * `cashedOutAmount` (default 0) pra permitir que o teste de integração de
 * resolução (Plan 04) semeie uma aposta com cashout prévio SEM depender do
 * caminho de escrita de cashout em si (que só existe a partir do Plan 02).
 *
 * `optionId` (default null) é opcional — quando omitido, o INSERT grava
 * choice/option_id exatamente como hoje (regressão binária na camada de
 * fixture, MARKET-03). Quando informado, grava choice=NULL/option_id=X,
 * satisfazendo a CHECK XOR da migration 005.
 */
async function seedWager({
  userId,
  marketId,
  choice = 'yes',
  amount = 100,
  oddsAtTime = 2.0,
  potentialPayout = 200,
  cashedOutAmount = 0,
  optionId = null,
}) {
  assertTestDatabase();
  if (optionId === null) {
    // Caminho binário byte-idêntico ao INSERT anterior (MARKET-03) — não
    // referencia option_id, então continua funcionando mesmo em bancos de
    // teste que ainda não rodaram applyMarketTypesMigration().
    const result = await query(
      `INSERT INTO wagers (user_id, market_id, choice, amount, odds_at_time, potential_payout, status, cashed_out_amount)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       RETURNING id;`,
      [userId, marketId, choice, amount, oddsAtTime, potentialPayout, cashedOutAmount]
    );
    return result.rows[0].id;
  }
  const result = await query(
    `INSERT INTO wagers (user_id, market_id, choice, option_id, amount, odds_at_time, potential_payout, status, cashed_out_amount)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, 'pending', $7)
     RETURNING id;`,
    [userId, marketId, optionId, amount, oddsAtTime, potentialPayout, cashedOutAmount]
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
  applyWalletSchema,
  applyCashoutMigration,
  applyMarketTypesMigration,
  seedTestUser,
  seedWallet,
  seedOpenMarket,
  seedMarketOptions,
  seedWager,
  truncateNotifications,
  wait,
  closePool,
};
