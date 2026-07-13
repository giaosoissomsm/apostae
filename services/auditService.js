const db = require('../db');

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.connection.remoteAddress ||
         req.socket.remoteAddress;
}

/**
 * Registra uma ação de auditoria (sem registrar senhas ou dados sensíveis).
 */
function logAudit(action, adminId, targetUserId, req, details = null) {
  const ipAddress = getClientIp(req);
  db.prepare(
    `INSERT INTO audit_logs (action, admin_id, target_user_id, ip_address, details)
     VALUES (?, ?, ?, ?, ?)`
  ).run(action, adminId, targetUserId, ipAddress, details);
}

/**
 * Busca logs de auditoria (paginados).
 */
function getAuditLogs(limit = 100, offset = 0) {
  return db.prepare(
    `SELECT id, action, admin_id, target_user_id, ip_address, details, created_at
     FROM audit_logs
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(limit, offset);
}

/**
 * Busca logs de auditoria de um usuário específico (pra ver quem mexeu nele).
 */
function getAuditLogsForUser(userId, limit = 100, offset = 0) {
  return db.prepare(
    `SELECT id, action, admin_id, target_user_id, ip_address, details, created_at
     FROM audit_logs
     WHERE target_user_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(userId, limit, offset);
}

module.exports = { logAudit, getAuditLogs, getAuditLogsForUser };
