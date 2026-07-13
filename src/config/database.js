const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
  max: 20, // Máximo de conexões simultâneas
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool de conexões:', err);
});

/**
 * Executa query parametrizada (SEMPRE usar prepared statements)
 * @param {string} query - SQL com $1, $2, etc
 * @param {array} params - Parâmetros (seguro contra SQL injection)
 */
async function query(sql, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(sql, params);
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn(`Slow query (${duration}ms): ${sql.substring(0, 50)}...`);
    }
    return result;
  } catch (err) {
    console.error('Query error:', err.message, 'SQL:', sql);
    throw err;
  }
}

/**
 * Executa múltiplas queries em transação
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Obtém um client para múltiplas operações
 */
async function getClient() {
  return await pool.connect();
}

module.exports = {
  pool,
  query,
  transaction,
  getClient,
};
