require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { requireAuth } = require('./middleware/auth');
const { startScheduler } = require('./scheduler');
const { cleanupExpiredSessions } = require('./services/sessionService');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const marketRoutes = require('./routes/markets');
const wagerRoutes = require('./routes/wagers');
const sessionRoutes = require('./routes/sessions');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/markets', marketRoutes);
app.use('/api/wagers', wagerRoutes);
app.use('/api/sessions', sessionRoutes);

// Ranking público (entre usuários logados) por créditos
app.get('/api/leaderboard', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT username, credits FROM users ORDER BY credits DESC LIMIT 50').all();
  res.json(rows);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`>> ApostaZueira rodando em http://localhost:${PORT}`);
  startScheduler();
  
  // Limpa sessões expiradas a cada 1 hora
  setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
  console.log('>> Limpeza de sessões iniciada (a cada 1 hora)');
});
