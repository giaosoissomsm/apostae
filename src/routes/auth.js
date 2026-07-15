const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * Públicos (sem autenticação)
 */
router.post('/register', authController.register);
router.post('/login', authController.login);

/**
 * Autenticados
 */
router.post('/logout', requireAuth, authController.logout);
router.put('/password', requireAuth, authController.changePassword);

/**
 * Admin only
 */
router.put(
  '/password/admin/:userId',
  requireAuth,
  requireAdmin,
  authController.adminChangePassword
);

router.put(
  '/force-password-change/:userId',
  requireAuth,
  requireAdmin,
  authController.forcePasswordChange
);

module.exports = router;
