const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { requireAuth } = require('../middleware/auth');
const { createSession, invalidateSession, invalidateAllUserSessions } = require('../services/sessionService');

const router = express.Router();
const STARTING_CREDITS = 100;
const TOKEN_EXPIRES_IN = '8h'; // Máximo 8 horas (alinha com SESSION_ABSOLUTE_TIMEOUT_MINUTES)

function signToken(user, sessionId) {
  return jwt.sign(
    { id: user.id, username: user.username, sessionId },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES_IN }
  );
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress;
}

function validCredentials(username, password) {
  return (
    typeof username === 'string' &&
    typeof password === 'string' &&
    username.trim().length >= 3 &&
    username.trim().length <= 32 &&
    /^[a-zA-Z0-9_.]+$/.test(username.trim()) &&
    password.length >= 6
  );
}

// Registro público
router.post('/register', (req, res) => {
  const { username, password } = req.body || {};

  if (!validCredentials(username, password)) {
    return res.status(400).json({
      error: 'Usuário deve ter 3-32 caracteres (letras/números/._) e senha ao menos 6 caracteres.'
    });
  }

  const cleanUsername = username.trim();
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (exists) {
    return res.status(409).json({ error: 'Esse nome de usuário já está em uso.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, is_admin, credits) VALUES (?, ?, 0, ?)')
    .run(cleanUsername, hash, STARTING_CREDITS);

  const user = db.prepare('SELECT id, username, is_admin, credits FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user });
});

// Login com criação de sessão
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'Sua conta foi desativada. Fale com o admin.' });
  }

  // Cria nova sessão
  const ipAddress = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const { sessionId } = createSession(user.id, ipAddress, userAgent);

  const token = signToken(user, sessionId);
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      is_admin: !!user.is_admin,
      credits: user.credits,
      password_expires_next_login: !!user.password_expires_next_login,
    },
  });
});

// Logout - invalida a sessão atual
router.post('/logout', requireAuth, (req, res) => {
  invalidateSession(req.sessionId);
  res.json({ ok: true, message: 'Logout realizado.' });
});

// Mudar senha obrigatória (quando password_expires_next_login = true)
// ROTA ESPECIAL: chamada quando usuário tá com flag = true, permite mudança antes de invalidar token
router.post('/change-password-required', requireAuth, (req, res) => {
  const { new_password } = req.body || {};

  if (typeof new_password !== 'string' || new_password.length < 6) {
    return res.status(400).json({ error: 'Senha precisa ter ao menos 6 caracteres.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (!user.password_expires_next_login) {
    return res.status(400).json({ error: 'Você não precisa mudar senha agora.' });
  }

  const changePw = db.transaction(() => {
    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ?, password_expires_next_login = 0 WHERE id = ?')
      .run(hash, req.user.id);

    // Invalida todas as outras sessões (força re-login)
    invalidateAllUserSessions(req.user.id, req.sessionId);
  });

  changePw();

  // Invalida ESTA sessão também após 1 segundo (pra o frontend redirecionar)
  setTimeout(() => {
    invalidateSession(req.sessionId);
  }, 1000);

  res.json({
    ok: true,
    message: 'Senha alterada. Faça login novamente.',
    redirectTo: '/login.html',
  });
});

module.exports = router;
