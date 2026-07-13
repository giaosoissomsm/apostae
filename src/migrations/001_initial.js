/**
 * Migration 001: Schema Inicial
 * Cria todas as tabelas essenciais do sistema
 */

const migrations = [
  // Roles (papéis de usuário)
  `CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`,

  // Usuários
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id INTEGER REFERENCES roles(id) DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    password_expires_next_login BOOLEAN DEFAULT false,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);`,

  // Permissões
  `CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`,

  // Associação role-permission
  `CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
  );`,

  // Mercados
  `CREATE TABLE IF NOT EXISTS markets (
    id SERIAL PRIMARY KEY,
    question VARCHAR(500) NOT NULL,
    description TEXT,
    odds_yes NUMERIC(10, 2) NOT NULL CHECK (odds_yes >= 1.01 AND odds_yes <= 1000),
    odds_no NUMERIC(10, 2) NOT NULL CHECK (odds_no >= 1.01 AND odds_no <= 1000),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed', 'resolved')),
    outcome VARCHAR(3) CHECK (outcome IN ('yes', 'no', NULL)),
    closes_at TIMESTAMP,
    reveal_at TIMESTAMP,
    scheduled_outcome VARCHAR(3) CHECK (scheduled_outcome IN ('yes', 'no', NULL)),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
  CREATE INDEX IF NOT EXISTS idx_markets_created_by ON markets(created_by);
  CREATE INDEX IF NOT EXISTS idx_markets_closes_at ON markets(closes_at);
  CREATE INDEX IF NOT EXISTS idx_markets_reveal_at ON markets(reveal_at);`,

  // Apostas
  `CREATE TABLE IF NOT EXISTS wagers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    choice VARCHAR(3) NOT NULL CHECK (choice IN ('yes', 'no')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    odds_at_time NUMERIC(10, 2) NOT NULL,
    potential_payout NUMERIC(12, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'refunded', 'voided')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_wagers_user_id ON wagers(user_id);
  CREATE INDEX IF NOT EXISTS idx_wagers_market_id ON wagers(market_id);
  CREATE INDEX IF NOT EXISTS idx_wagers_status ON wagers(status);`,

  // Sessões
  `CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    invalidated_at TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);`,

  // Logs de auditoria
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    admin_id INTEGER REFERENCES users(id),
    target_user_id INTEGER REFERENCES users(id),
    table_name VARCHAR(100),
    record_id INTEGER,
    changes JSONB,
    ip_address VARCHAR(45),
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON audit_logs(admin_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user_id ON audit_logs(target_user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);`,

  // Configurações do sistema
  `CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    type VARCHAR(20) DEFAULT 'string',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`,
];

module.exports = {
  id: '001_initial',
  up: migrations,
  down: [
    'DROP TABLE IF EXISTS settings;',
    'DROP TABLE IF EXISTS audit_logs;',
    'DROP TABLE IF EXISTS sessions;',
    'DROP TABLE IF EXISTS wagers;',
    'DROP TABLE IF EXISTS markets;',
    'DROP TABLE IF EXISTS role_permissions;',
    'DROP TABLE IF EXISTS permissions;',
    'DROP TABLE IF EXISTS users;',
    'DROP TABLE IF EXISTS roles;',
  ],
};
