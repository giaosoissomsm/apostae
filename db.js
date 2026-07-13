const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'apostas.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  password_expires_next_login INTEGER NOT NULL DEFAULT 0,
  credits REAL NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  invalidated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  admin_id INTEGER,
  target_user_id INTEGER,
  ip_address TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES users(id),
  FOREIGN KEY (target_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  description TEXT DEFAULT '',
  odds_yes REAL NOT NULL,
  odds_no REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed | resolved
  outcome TEXT, -- 'yes' | 'no' | NULL
  closes_at TEXT, -- quando as apostas fecham sozinhas (opcional)
  reveal_at TEXT, -- quando o resultado agendado é revelado (opcional)
  scheduled_outcome TEXT, -- 'yes' | 'no' | NULL - resultado pré-definido pelo admin
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS wagers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  market_id INTEGER NOT NULL,
  choice TEXT NOT NULL, -- 'yes' | 'no'
  amount REAL NOT NULL,
  odds_at_time REAL NOT NULL,
  potential_payout REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | won | lost | refunded
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (market_id) REFERENCES markets(id)
);
`);

// ---------- Migrações idempotentes (bancos criados por versões antigas) ----------
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'password_expires_next_login', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('markets', 'closes_at', 'TEXT');
ensureColumn('markets', 'reveal_at', 'TEXT');
ensureColumn('markets', 'scheduled_outcome', 'TEXT');

function ensureTable(name, definition) {
  const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  if (!exists) {
    db.exec(definition);
  }
}

ensureTable('sessions', `CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  invalidated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`);

ensureTable('audit_logs', `CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  admin_id INTEGER,
  target_user_id INTEGER,
  ip_address TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES users(id),
  FOREIGN KEY (target_user_id) REFERENCES users(id)
)`);

// Cria um admin padrão na primeira execução (senha deve ser trocada depois)
const adminExists = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(
    'INSERT INTO users (username, password_hash, is_admin, credits) VALUES (?, ?, 1, ?)'
  ).run('admin', hash, 10000);
  console.log('>> Usuário admin padrão criado: username="admin" senha="admin123" (troque a senha!)');
}

module.exports = db;
