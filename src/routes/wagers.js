const express = require('express');
const wagersController = require('../controllers/wagersController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/user/:username', requireAuth, wagersController.getUserWagers);
router.post('/', requireAuth, wagersController.placeWager);
router.delete('/:id', requireAuth, wagersController.cancelWager);
router.post('/:id/cashout', requireAuth, wagersController.cashoutWager);

module.exports = router;
