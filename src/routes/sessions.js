const express = require('express');
const sessionsController = require('../controllers/sessionsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/current', requireAuth, sessionsController.getCurrentSession);
router.post('/keep-alive', requireAuth, sessionsController.keepAlive);

module.exports = router;
