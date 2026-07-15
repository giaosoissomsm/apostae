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
  // Tempo de inatividade até o logout automático. Única fonte de verdade:
  // o frontend não hardcoda esse valor, ele lê o TTL real via GET /api/sessions/current.
  // Para mudar o tempo de inatividade no futuro, altere apenas esta env var.
  SESSION_TIMEOUT: parseInt(process.env.SESSION_TIMEOUT || '1800000', 10), // 30 min de inatividade
  SESSION_ABSOLUTE_TIMEOUT: parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT || '1800000', 10), // 30 min máximo desde o login, mesmo com atividade contínua (defesa contra sequestro de sessão)

  // Cashout parcial (Fase 2). Taxa percentual aplicada sobre o valor bruto do
  // cashout — 0% nesta milestone (BR-1, confirmado pelo dono do projeto); o
  // termo de taxa fica presente na fórmula (src/utils/money.js) pra uma
  // milestone futura poder ligar uma taxa não-zero sem reescrever o cálculo.
  // Não existe CASHOUT_MIN_AMOUNT: BR-2 não exige um piso além da checagem
  // de valor positivo já aplicada no serviço.
  CASHOUT_FEE_PERCENT: parseFloat(process.env.CASHOUT_FEE_PERCENT || '0'),

  // Cancelamento de aposta (Fase 4). Taxa percentual retida sobre o restante
  // da stake ao cancelar — 5% por padrão (requisitos.txt fixa esse valor;
  // o env var só existe pra não hardcodar o número duas vezes no código).
  CANCEL_FEE_PERCENT: parseFloat(process.env.CANCEL_FEE_PERCENT || '5'),

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

// CASHOUT_FEE_PERCENT precisa estar em [0, 100] em QUALQUER ambiente (não só
// produção): money.applyFeePercent computa fee = gross * (feePercent / 100)
// sem clamp, então um valor acima de 100 (ex.: operador digitando 500 em vez
// de 5) faz `fee > gross`, e `net = gross - fee` fica NEGATIVO — cashoutWager
// então credita a carteira com esse valor negativo, transformando
// silenciosamente um "cashout" (que deveria creditar) num débito. Um valor
// não-numérico (parseFloat retornando NaN) é igualmente perigoso e também é
// rejeitado aqui.
if (!Number.isFinite(env.CASHOUT_FEE_PERCENT) || env.CASHOUT_FEE_PERCENT < 0 || env.CASHOUT_FEE_PERCENT > 100) {
  throw new Error(
    `Invalid CASHOUT_FEE_PERCENT: "${process.env.CASHOUT_FEE_PERCENT}" — must be a number between 0 and 100.`
  );
}

// CANCEL_FEE_PERCENT precisa estar em [0, 100] pela mesma razão exata do
// bloco acima: money.applyFeePercent computa fee = gross * (feePercent / 100)
// sem clamp, então um valor acima de 100 faz `fee > gross`, e o "reembolso"
// (net = gross - fee) fica NEGATIVO — cancelWager debitaria a carteira em
// vez de reembolsar. NaN (parseFloat inválido) é igualmente rejeitado aqui.
if (!Number.isFinite(env.CANCEL_FEE_PERCENT) || env.CANCEL_FEE_PERCENT < 0 || env.CANCEL_FEE_PERCENT > 100) {
  throw new Error(
    `Invalid CANCEL_FEE_PERCENT: "${process.env.CANCEL_FEE_PERCENT}" — must be a number between 0 and 100.`
  );
}

module.exports = env;
