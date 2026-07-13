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
      const key = `ratelimit:${req.ip || 'unknown'}`;
      const count = await redis.incr(key);

      if (count === 1) {
        // Define TTL na primeira requisição
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }

      // Headers de rate limit
      res.set('X-RateLimit-Limit', maxRequests);
      res.set('X-RateLimit-Remaining', Math.max(0, maxRequests - count));

      if (count > maxRequests) {
        logger.warn(`Rate limit excedido: ${req.ip}`, { endpoint: req.path });
        throw new RateLimitError();
      }

      next();
    } catch (err) {
      if (err instanceof RateLimitError) {
        return res.status(429).json({ error: err.message });
      }
      // Falha aberto em caso de erro com Redis
      logger.error('Erro no rate limiter', err.message);
      next();
    }
  };
}

/**
 * Rate limiter específico para login (mais restritivo)
 */
const loginLimiter = createRateLimiter(5, 15 * 60 * 1000); // 5 por 15 min

/**
 * Rate limiter geral
 */
const generalLimiter = createRateLimiter(100, 60 * 1000); // 100 por minuto

/**
 * Rate limiter para mudança de senha
 */
const passwordLimiter = createRateLimiter(3, 60 * 60 * 1000); // 3 por hora

module.exports = {
  createRateLimiter,
  loginLimiter,
  generalLimiter,
  passwordLimiter,
};
