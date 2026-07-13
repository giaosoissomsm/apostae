/**
 * Migration 002: Sistema de Carteira
 * Cria tabelas para gerenciamento de créditos e transações
 */

const migrations = [
  // Carteiras
  `CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance NUMERIC(15, 2) NOT NULL DEFAULT 100 CHECK (balance >= 0),
    currency VARCHAR(3) DEFAULT 'BRL',
    locked_balance NUMERIC(15, 2) DEFAULT 0 CHECK (locked_balance >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);`,

  // Transações de carteira
  `CREATE TABLE IF NOT EXISTS wallet_transactions (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('credit', 'debit', 'refund', 'correction')),
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    balance_before NUMERIC(15, 2) NOT NULL,
    balance_after NUMERIC(15, 2) NOT NULL,
    related_entity VARCHAR(50), -- 'wager', 'market_resolved', 'admin_adjustment', etc
    related_id INTEGER,
    description TEXT,
    admin_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id);
  CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON wallet_transactions(type);
  CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_wallet_transactions_related ON wallet_transactions(related_entity, related_id);`,

  // Triggers para manter updated_at atualizado
  `CREATE OR REPLACE FUNCTION update_timestamp()
   RETURNS TRIGGER AS $$
   BEGIN
     NEW.updated_at = CURRENT_TIMESTAMP;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   DROP TRIGGER IF EXISTS trigger_users_update ON users;
   CREATE TRIGGER trigger_users_update BEFORE UPDATE ON users
     FOR EACH ROW EXECUTE FUNCTION update_timestamp();

   DROP TRIGGER IF EXISTS trigger_markets_update ON markets;
   CREATE TRIGGER trigger_markets_update BEFORE UPDATE ON markets
     FOR EACH ROW EXECUTE FUNCTION update_timestamp();

   DROP TRIGGER IF EXISTS trigger_wallets_update ON wallets;
   CREATE TRIGGER trigger_wallets_update BEFORE UPDATE ON wallets
     FOR EACH ROW EXECUTE FUNCTION update_timestamp();`,
];

module.exports = {
  id: '002_wallet',
  up: migrations,
  down: [
    'DROP TRIGGER IF EXISTS trigger_wallets_update ON wallets;',
    'DROP TRIGGER IF EXISTS trigger_markets_update ON markets;',
    'DROP TRIGGER IF EXISTS trigger_users_update ON users;',
    'DROP FUNCTION IF EXISTS update_timestamp();',
    'DROP TABLE IF EXISTS wallet_transactions;',
    'DROP TABLE IF EXISTS wallets;',
  ],
};
