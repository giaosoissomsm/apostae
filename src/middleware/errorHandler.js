const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * Middleware de tratamento centralizado de erros
 * Deve ser registrado ÚLTIMO no Express
 */
function errorHandler(err, req, res, next) {
  // Padrão de erro
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Erro interno do servidor';

  // Log do erro
  if (statusCode >= 500) {
    logger.error(`[${req.method} ${req.path}] ${message}`, {
      stack: err.stack,
      body: req.body,
      userId: req.user?.id,
    });
  } else {
    logger.warn(`[${req.method} ${req.path}] ${statusCode} ${message}`);
  }

  // Tratamento especial para erros de validação Joi
  if (err.isJoi) {
    statusCode = 400;
    message = 'Validação falhou';
    const details = err.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
    }));
    return res.status(statusCode).json({ error: message, details });
  }

  // Tratamento para erros de banco de dados
  if (err.code === 'ENOENT') {
    statusCode = 500;
    message = 'Erro de conexão com banco de dados';
  }

  // Tratamento para SQL errors
  if (err.code && err.code.startsWith('P')) { // PostgreSQL error codes
    statusCode = 500;
    message = 'Erro ao processar requisição no banco de dados';
    
    // Não expor detalhes de SQL injection attempts
    if (err.message.includes('syntax')) {
      logger.warn('Possível tentativa de SQL injection detectada', {
        error: err.message,
        userId: req.user?.id,
        ip: req.ip,
      });
    }
  }

  // Response padrão
  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * Wrapper para rotas async (evita try/catch em toda rota)
 */
function catchAsync(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  catchAsync,
};
