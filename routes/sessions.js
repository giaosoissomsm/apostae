const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validateSession, SESSION_TIMEOUT_MINUTES, SESSION_ABSOLUTE_TIMEOUT_MINUTES } = require('../services/sessionService');

const router = express.Router();

// GET /api/sessions/current - informações da sessão atual (pra frontend validar timeout)
router.get('/current', requireAuth, (req, res) => {
  const session = db.prepare(
    `SELECT id, created_at, last_activity_at, expires_at, ip_address
     FROM sessions WHERE id = ? AND invalidated_at IS NULL`
  ).get(req.sessionId);

  if (!session) {
    return res.status(401).json({ error: 'Sessão não encontrada.' });
  }

  const now = new Date();
  const lastActivity = new Date(session.last_activity_at.replace(' ', 'T') + 'Z');
  const expiresAt = new Date(session.expires_at.replace(' ', 'T') + 'Z');

  const inactiveSeconds = Math.round((now - lastActivity) / 1000);
  const expiresInSeconds = Math.round((expiresAt - now) / 1000);
  const inactivityWarningSeconds = SESSION_TIMEOUT_MINUTES * 60;

  res.json({
    sessionId: session.id,
    createdAt: session.created_at,
    lastActivityAt: session.last_activity_at,
    expiresAt: session.expires_at,
    inactiveSeconds,
    expiresInSeconds,
    inactivityTimeoutSeconds: inactivityWarningSeconds,
    isAboutToExpire: inactiveSeconds > inactivityWarningSeconds - 300, // Alerta 5 min antes
  });
});

// POST /api/sessions/keep-alive - atualiza última atividade (pra renovar sessão)
router.post('/keep-alive', requireAuth, (req, res) => {
  // O middleware requireAuth já atualiza a atividade, então é só confirmar
  res.json({ ok: true });
});

module.exports = router;
