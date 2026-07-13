const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { loginLimiter, registerLimiter, passwordLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

/**
 * Públicos (sem autenticação)
 */
router.post('/register', registerLimiter, authController.register);
router.post('/login', loginLimiter, authController.login);

/**
 * Autenticados
 */
router.post('/logout', requireAuth, authController.logout);
router.put('/password', requireAuth, passwordLimiter, authController.changePassword);

/**
 * Admin only
 */
router.put(
  '/password/admin/:userId',
  requireAuth,
  requireAdmin,
  passwordLimiter,
  authController.adminChangePassword
);

router.put(
  '/force-password-change/:userId',
  requireAuth,
  requireAdmin,
  authController.forcePasswordChange
);

module.exports = router;
