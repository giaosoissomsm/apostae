const redis = require('../config/redis');
const { RateLimitError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Rate limiter usando Redis
 * @param {number} maxRequests - Máximo de requisições
 * @param {number} windowMs - Janela de tempo em ms
 */
function createRateLimiter(maxRequests = 100, windowMs = 60000) {
  return async (req, res, next) => {
    try {
      // Pega IP real (respeita proxy headers)
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                 req.ip ||
                 'unknown';

      const key = `ratelimit:${ip}:${req.path}`;
      const count = await redis.incr(key);

      if (count === 1) {
        // Define TTL APENAS na primeira requisição desta janela
        const seconds = Math.ceil(windowMs / 1000);
        await redis.expire(key, seconds);
      }

      // Headers de rate limit
      res.set('X-RateLimit-Limit', maxRequests);
      res.set('X-RateLimit-Remaining', Math.max(0, maxRequests - count));

      if (count > maxRequests) {
        logger.warn(`Rate limit excedido para ${ip} em ${req.path}`, { count, max: maxRequests });
        throw new RateLimitError(`Muitas requisições. Tente novamente em ${Math.ceil(windowMs / 1000)} segundos.`);
      }

      next();
    } catch (err) {
      if (err instanceof RateLimitError) {
        return res.status(429).json({ error: err.message });
      }
      // Falha aberto em caso de erro com Redis (não bloquear requisição)
      logger.error('Erro no rate limiter', err.message);
      next(); // Continua mesmo se Redis falhar
    }
  };
}

/**
 * Rate limiter específico para login (mais restritivo)
 * 5 tentativas por 15 minutos
 */
const loginLimiter = createRateLimiter(5, 15 * 60 * 1000);

/**
 * Rate limiter específico para registro (moderado)
 * 10 por hora
 */
const registerLimiter = createRateLimiter(10, 60 * 60 * 1000);

/**
 * Rate limiter para mudança de senha
 * 3 por hora
 */
const passwordLimiter = createRateLimiter(3, 60 * 60 * 1000);

/**
 * Rate limiter geral (bem permissivo)
 * 100 por minuto
 */
const generalLimiter = createRateLimiter(100, 60 * 1000);

module.exports = {
  createRateLimiter,
  loginLimiter,
  registerLimiter,
  passwordLimiter,
  generalLimiter,
};

