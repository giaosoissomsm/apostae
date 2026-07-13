const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    is_admin: !!u.is_admin,
    is_active: !!u.is_active,
    credits: u.credits,
    created_at: u.created_at,
  };
}

// ---------- Perfil do próprio usuário ----------
// GET /api/users/me - sempre usa req.user.id (do token), nunca um id do request
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json(publicUser(user));
});

// PUT /api/users/me/password - troca a PRÓPRIA senha (usuário comum ou admin).
// Exige a senha atual pra confirmar que é realmente o dono da conta digitando.
// Mesmo que o body venha com um "id" ou "user_id", isso é ignorado: usamos req.user.id.
router.put('/me/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};

  if (typeof current_password !== 'string' || !current_password) {
    return res.status(400).json({ error: 'Informe sua senha atual.' });
  }
  if (typeof new_password !== 'string' || new_password.length < 6) {
    return res.status(400).json({ error: 'A nova senha precisa ter ao menos 6 caracteres.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Senha atual incorreta.' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true, message: 'Senha atualizada.' });
});

// GET /api/users/me/wagers - histórico de apostas do usuário logado
router.get('/me/wagers', requireAuth, (req, res) => {
  const wagers = db
    .prepare(
      `SELECT w.*, m.question, m.status AS market_status, m.outcome AS market_outcome
       FROM wagers w JOIN markets m ON m.id = w.market_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`
    )
    .all(req.user.id);
  res.json(wagers);
});

// ---------- Administração (somente admin) ----------
// GET /api/users - lista todos os usuários
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json(users.map(publicUser));
});

// POST /api/users - admin cria um usuário diretamente (com créditos iniciais opcionais)
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { username, password, credits, is_admin } = req.body || {};

  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    username.trim().length < 3 ||
    password.length < 6
  ) {
    return res.status(400).json({ error: 'Usuário (min 3) e senha (min 6) são obrigatórios.' });
  }

  const cleanUsername = username.trim();
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (exists) return res.status(409).json({ error: 'Esse nome de usuário já está em uso.' });

  const startingCredits = Number.isFinite(credits) ? Number(credits) : 100;
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, is_admin, credits) VALUES (?, ?, ?, ?)')
    .run(cleanUsername, hash, is_admin ? 1 : 0, startingCredits);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(publicUser(user));
});

// PUT /api/users/:id/credits - admin ajusta créditos de qualquer usuário
// O :id aqui é legítimo pois a rota é protegida por requireAdmin - só o admin pode mexer no saldo de outros.
router.put('/:id/credits', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  const { credits } = req.body || {};

  if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'ID inválido.' });
  if (!Number.isFinite(credits) || credits < 0) {
    return res.status(400).json({ error: 'Informe um valor de créditos válido (>= 0).' });
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

  db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(Number(credits), targetId);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  res.json(publicUser(updated));
});

// PUT /api/users/:id/admin - admin promove/rebaixa outro usuário
router.put('/:id/admin', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  const { is_admin } = req.body || {};

  if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'ID inválido.' });
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'Você não pode alterar sua própria permissão de admin.' });
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, targetId);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  res.json(publicUser(updated));
});

// PUT /api/users/:id/status - admin ativa ou desativa a conta de outro usuário.
// Uma conta desativada não consegue mais logar nem usar um token antigo (checado no requireAuth).
router.put('/:id/status', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  const { is_active } = req.body || {};

  if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'ID inválido.' });
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'Você não pode desativar a própria conta.' });
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, targetId);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  res.json(publicUser(updated));
});

// DELETE /api/users/:id - admin apaga a conta de outro usuário PERMANENTEMENTE.
// Apaga também as apostas dele (não dá pra manter uma aposta órfã sem dono).
// Não deixa apagar quem já criou mercados, pra não quebrar o histórico - nesse
// caso o admin deve desativar a conta em vez de excluir.
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'ID inválido.' });
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'Você não pode excluir a própria conta.' });
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const createdMarkets = db.prepare('SELECT COUNT(*) AS n FROM markets WHERE created_by = ?').get(targetId);
  if (createdMarkets.n > 0) {
    return res.status(409).json({
      error: 'Esse usuário criou mercados e não pode ser excluído (isso apagaria o histórico). Desative a conta em vez disso.'
    });
  }

  const del = db.transaction(() => {
    db.prepare('DELETE FROM wagers WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  });
  del();

  res.json({ ok: true, message: 'Usuário excluído permanentemente.' });
});

// PUT /api/users/:id/password - admin altera senha de qualquer usuário
// Não exige senha atual, invalida todas as sessões do usuário
router.put('/:id/password', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  const { password } = req.body || {};

  if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'ID inválido.' });
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Senha precisa ter ao menos 6 caracteres.' });
  }
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'Use a rota de perfil pra alterar sua própria senha.' });
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const changePw = db.transaction(() => {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, targetId);

    // Invalida todas as sessões do usuário (força re-login)
    const { invalidateAllUserSessions } = require('../services/sessionService');
    invalidateAllUserSessions(targetId);

    // Registra na auditoria
    const { logAudit } = require('../services/auditService');
    logAudit('admin_change_password', req.user.id, targetId, req, 'Administrador alterou a senha do usuário.');
  });

  changePw();
  res.json({ ok: true, message: 'Senha alterada. Usuário precisa fazer login novamente.' });
});

// PUT /api/users/:id/password-expires - admin força mudança de senha no próximo login
router.put('/:id/password-expires', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  const { enabled } = req.body || {};

  if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'ID inválido.' });
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'Você não pode forçar mudança de senha em si mesmo.' });
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

  db.prepare('UPDATE users SET password_expires_next_login = ? WHERE id = ?')
    .run(enabled ? 1 : 0, targetId);

  const { logAudit } = require('../services/auditService');
  logAudit(
    'admin_force_password_change',
    req.user.id,
    targetId,
    req,
    enabled ? 'Forçou mudança de senha no próximo login.' : 'Removeu requisição de mudança de senha.'
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  res.json(publicUser(updated));
});

// GET /api/audit-logs - admin vê logs de auditoria (paginados)
router.get('/audit/logs', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const offset = Number(req.query.offset) || 0;

  const logs = require('../services/auditService').getAuditLogs(limit, offset);
  res.json(logs);
});

// GET /api/audit-logs/:userId - admin vê logs de um usuário específico
router.get('/audit/logs/:userId', requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'ID inválido.' });

  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const offset = Number(req.query.offset) || 0;

  const logs = require('../services/auditService').getAuditLogsForUser(userId, limit, offset);
  res.json(logs);
});

module.exports = router;
