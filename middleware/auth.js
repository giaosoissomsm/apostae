const jwt = require('jsonwebtoken');
const db = require('../db');
const { validateSession, updateActivity } = require('../services/sessionService');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não configurado no .env');
}

/**
 * Extrai e valida o token JWT do header Authorization.
 * O token só garante a IDENTIDADE (id do usuário, assinado pelo servidor no login).
 * Também valida a sessão (verificar timeout, invalidação).
 * Bloqueia se usuário precisa mudar senha (exceto pra rotas específicas).
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  // Valida a sessão associada ao token
  const sessionId = payload.sessionId;
  const sessionData = validateSession(sessionId);
  if (!sessionData) {
    return res.status(401).json({
      error: 'Sessão expirada por inatividade ou invalidada. Faça login novamente.',
    });
  }

  const user = sessionData.user;

  // Checka se o usuário foi desativado ou deletado desde o login
  if (!user.is_active) {
    return res.status(403).json({ error: 'Sua conta foi desativada.' });
  }

  // Se o usuário precisa mudar senha, bloqueia tudo exceto rotas de senha
  const isPasswordChangeRoute = req.path === '/users/me/password-expires' ||
                                req.path === '/auth/change-password-required';

  if (user.password_expires_next_login && !isPasswordChangeRoute) {
    return res.status(403).json({
      error: 'password_expires_next_login',
      message: 'Você precisa alterar sua senha antes de continuar.',
    });
  }

  // Atualiza última atividade da sessão
  updateActivity(sessionId);

  req.user = { id: user.id, username: user.username, is_admin: user.is_admin };
  req.sessionId = sessionId;
  next();
}

/**
 * Bloqueia quem não é admin (usado após requireAuth).
 */
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Apenas administradores podem fazer isso.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, JWT_SECRET };
