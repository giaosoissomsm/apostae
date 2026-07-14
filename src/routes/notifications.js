const express = require('express');
const notificationsController = require('../controllers/notificationsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, notificationsController.listMyNotifications);
router.get('/unread-count', requireAuth, notificationsController.getUnreadCount);
router.patch('/:id/read', requireAuth, notificationsController.markRead);

module.exports = router;
