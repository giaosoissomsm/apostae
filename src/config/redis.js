const redis = require('redis');
const env = require('./env');

const client = redis.createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis: max retries exceeded');
        return new Error('Redis reconnect failed');
      }
      return retries * 50;
    },
  },
});

client.on('error', (err) => {
  console.error('Redis error:', err);
});

client.on('connect', () => {
  console.log('✓ Redis conectado');
});

client.on('disconnect', () => {
  console.log('✗ Redis desconectado');
});

/**
 * Conecta ao Redis
 */
async function connect() {
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

/**
 * Define valor com TTL
 */
async function setex(key, ttl, value) {
  await connect();
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await client.setEx(key, ttl, serialized);
}

/**
 * Obtém valor
 */
async function get(key) {
  await connect();
  const value = await client.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Deleta chave
 */
async function del(key) {
  await connect();
  await client.del(key);
}

/**
 * Deleta múltiplas chaves por padrão
 */
async function delPattern(pattern) {
  await connect();
  const keys = await client.keys(pattern);
  if (keys.length > 0) {
    await client.del(keys);
  }
}

/**
 * Expira chave após segundos
 */
async function expire(key, seconds) {
  await connect();
  await client.expire(key, seconds);
}

/**
 * Retorna TTL restante da chave em segundos (-2 se não existe, -1 se sem TTL)
 */
async function ttl(key) {
  await connect();
  return client.ttl(key);
}

/**
 * Limpa tudo (apenas dev/teste)
 */
async function flushAll() {
  await connect();
  await client.flushAll();
}

module.exports = {
  client,
  connect,
  setex,
  get,
  del,
  delPattern,
  expire,
  ttl,
  flushAll,
};
