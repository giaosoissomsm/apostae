/**
 * Migration 003: Sistema de Notificações
 * Cria tabela para notificações de eventos de apostas e mercados
 */

const migrations = [
  // Notificações
  `CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT,
    related_entity VARCHAR(50), -- 'wager', 'market', etc
    related_id INTEGER,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, type, related_entity, related_id)
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications(user_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;`,
];

module.exports = {
  id: '003_notifications',
  up: migrations,
  down: [
    'DROP TABLE IF EXISTS notifications;',
  ],
};
