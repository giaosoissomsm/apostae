/**
 * Erro base da aplicação
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Erro de validação (400)
 */
class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400);
    this.details = details;
  }
}

/**
 * Erro de autenticação (401)
 */
class AuthenticationError extends AppError {
  constructor(message = 'Autenticação falhou') {
    super(message, 401);
  }
}

/**
 * Erro de autorização (403)
 */
class AuthorizationError extends AppError {
  constructor(message = 'Acesso negado') {
    super(message, 403);
  }
}

/**
 * Recurso não encontrado (404)
 */
class NotFoundError extends AppError {
  constructor(message = 'Recurso não encontrado') {
    super(message, 404);
  }
}

/**
 * Conflito de dados (409)
 */
class ConflictError extends AppError {
  constructor(message = 'Conflito de dados') {
    super(message, 409);
  }
}

/**
 * Erro de rate limit (429)
 */
class RateLimitError extends AppError {
  constructor(message = 'Muitas requisições. Tente novamente mais tarde.') {
    super(message, 429);
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
};
