const express = require('express');
const marketsController = require('../controllers/marketsController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, marketsController.listMarkets);
router.post('/', requireAuth, requireAdmin, marketsController.createMarket);
router.put('/:id/status', requireAuth, requireAdmin, marketsController.updateMarketStatus);
router.put('/:id/resolve', requireAuth, requireAdmin, marketsController.resolveMarket);
router.delete('/:id', requireAuth, requireAdmin, marketsController.deleteMarket);

module.exports = router;
