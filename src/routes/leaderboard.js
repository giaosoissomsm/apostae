const express = require('express');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { catchAsync } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/', requireAuth, catchAsync(async (req, res) => {
  const result = await query(
    `SELECT u.username, w.balance AS credits
     FROM users u
     JOIN wallets w ON w.user_id = u.id
     WHERE u.deleted_at IS NULL AND u.is_active
     ORDER BY w.balance DESC
     LIMIT 50;`
  );
  res.json(result.rows);
}));

module.exports = router;
