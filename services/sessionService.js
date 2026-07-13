const db = require('../db');
const crypto = require('crypto');

// Configurações de sessão (em minutos)
const SESSION_TIMEOUT_MINUTES = 30; // Logout automático após 30 min de inatividade
const SESSION_ABSOLUTE_TIMEOUT_MINUTES = 480; // Máximo 8 horas por sessão

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Cria uma nova sessão de usuário após login bem-sucedido.
 * Retorna { sessionId, expiresAt }
 */
function createSession(userId, ipAddress, userAgent) {
  const sessionId = generateSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MINUTES * 60000);

  db.prepare(
    `INSERT INTO sessions (id, user_id, ip_address, user_agent, last_activity_at, expires_at)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`
  ).run(sessionId, userId, ipAddress, userAgent, expiresAt.toISOString());

  return { sessionId, expiresAt };
}

/**
 * Valida uma sessão existente:
 * - Checka se não foi invalidada
 * - Checka se não expirou (timeout de inatividade)
 * - Checka se não atingiu o timeout absoluto
 * Retorna { valid, user } ou null se inválida
 */
function validateSession(sessionId) {
  const session = db.prepare(
    `SELECT s.*, u.id AS user_id, u.username, u.is_admin, u.is_active,
            u.password_expires_next_login
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`
  ).get(sessionId);

  if (!session) return null;
  if (session.invalidated_at) return null;
  if (!session.user_id) return null;

  const now = new Date();
  const lastActivity = new Date(session.last_activity_at.replace(' ', 'T') + 'Z');
  const expiresAt = new Date(session.expires_at.replace(' ', 'T') + 'Z');

  // Checka timeout de inatividade
  const inactiveMinutes = (now - lastActivity) / 60000;
  if (inactiveMinutes > SESSION_TIMEOUT_MINUTES) {
    invalidateSession(sessionId);
    return null;
  }

  // Checka timeout absoluto
  if (now > expiresAt) {
    invalidateSession(sessionId);
    return null;
  }

  return {
    sessionId,
    user: {
      id: session.user_id,
      username: session.username,
      is_admin: !!session.is_admin,
      is_active: !!session.is_active,
      password_expires_next_login: !!session.password_expires_next_login,
    },
  };
}

/**
 * Atualiza o timestamp de última atividade da sessão.
 * Chamado em cada requisição válida.
 */
function updateActivity(sessionId) {
  db.prepare("UPDATE sessions SET last_activity_at = datetime('now') WHERE id = ?").run(sessionId);
}

/**
 * Invalida uma sessão (logout).
 */
function invalidateSession(sessionId) {
  db.prepare("UPDATE sessions SET invalidated_at = datetime('now') WHERE id = ?").run(sessionId);
}

/**
 * Invalida todas as sessões de um usuário.
 * Usado quando admin muda senha do usuário ou o próprio usuário muda senha.
 */
function invalidateAllUserSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) {
    db.prepare(
      "UPDATE sessions SET invalidated_at = datetime('now') WHERE user_id = ? AND id != ?"
    ).run(userId, exceptSessionId);
  } else {
    db.prepare("UPDATE sessions SET invalidated_at = datetime('now') WHERE user_id = ?").run(userId);
  }
}

/**
 * Limpa sessões expiradas do banco (cleanup).
 * Chamado periodicamente pra manter o banco limpo.
 */
function cleanupExpiredSessions() {
  const oneHourAgo = new Date(new Date().getTime() - 60 * 60000).toISOString();
  db.prepare(
    `DELETE FROM sessions
     WHERE (invalidated_at IS NOT NULL AND invalidated_at < ?)
        OR (expires_at < datetime('now'))`
  ).run(oneHourAgo);
}

module.exports = {
  createSession,
  validateSession,
  updateActivity,
  invalidateSession,
  invalidateAllUserSessions,
  cleanupExpiredSessions,
  SESSION_TIMEOUT_MINUTES,
  SESSION_ABSOLUTE_TIMEOUT_MINUTES,
};
