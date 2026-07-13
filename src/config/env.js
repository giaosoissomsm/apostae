require('dotenv').config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000,
  
  // Database
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: process.env.DB_PORT || 5432,
  DB_NAME: process.env.DB_NAME || 'apostae',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
  DB_SSL: process.env.DB_SSL === 'true',
  
  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  REDIS_CACHE_TTL: parseInt(process.env.REDIS_CACHE_TTL || '300', 10), // 5 min
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  
  // Security
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  SESSION_TIMEOUT: parseInt(process.env.SESSION_TIMEOUT || '1800000', 10), // 30 min
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};

// Validar variáveis críticas
const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'];
for (const key of required) {
  if (!env[key] && env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = env;
