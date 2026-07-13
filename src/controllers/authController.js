const authService = require('../services/authService');
const { catchAsync } = require('../middleware/errorHandler');

/**
 * POST /api/auth/register - Registra novo usuário
 */
const register = catchAsync(async (req, res) => {
  const { username, email, password } = req.body;

  const user = await authService.register(username, email, password);

  res.status(201).json({
    message: 'Usuário registrado com sucesso',
    user,
  });
});

/**
 * POST /api/auth/login - Faz login
 */
const login = catchAsync(async (req, res) => {
  const { username, password } = req.body;

  const result = await authService.login(
    username,
    password,
    req.ip,
    req.headers['user-agent']
  );

  res.json(result);
});

/**
 * POST /api/auth/logout - Faz logout
 */
const logout = catchAsync(async (req, res) => {
  await authService.logout(req.sessionId, req.user.id, req.ip);

  res.json({ ok: true, message: 'Logout realizado' });
});

/**
 * PUT /api/auth/password - Muda senha do usuário
 */
const changePassword = catchAsync(async (req, res) => {
  const { current_password, new_password } = req.body;

  await authService.changePassword(req.user.id, current_password, new_password);

  res.json({
    ok: true,
    message: 'Senha alterada. Faça login novamente.',
    redirectTo: '/login.html',
  });
});

/**
 * PUT /api/auth/password/admin/:userId - Admin altera senha de outro usuário
 */
const adminChangePassword = catchAsync(async (req, res) => {
  const { password } = req.body;

  await authService.adminChangePassword(
    req.user.id,
    parseInt(req.params.userId, 10),
    password,
    req.ip
  );

  res.json({ ok: true, message: 'Senha alterada' });
});

/**
 * PUT /api/auth/force-password-change/:userId - Admin força mudança de senha
 */
const forcePasswordChange = catchAsync(async (req, res) => {
  const { enabled } = req.body;

  await authService.forcePasswordChange(
    req.user.id,
    parseInt(req.params.userId, 10),
    enabled,
    req.ip
  );

  res.json({ ok: true });
});

module.exports = {
  register,
  login,
  logout,
  changePassword,
  adminChangePassword,
  forcePasswordChange,
};
