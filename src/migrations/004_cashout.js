/**
 * Migration 004: Cashout Parcial
 * Cria a tabela append-only de registros de cashout (wager_cashouts) e
 * adiciona a coluna cumulativa wagers.cashed_out_amount, que todo o resto
 * da Fase 2 (repositórios, serviço, edição de resolveMarket) lê/grava.
 */

const migrations = [
  // Registros de cashout (append-only). UNIQUE(wager_id, idempotency_key) é
  // a espinha dorsal da proteção contra replay (CASHOUT-07) — uma segunda
  // linha com a mesma chave de idempotência pra mesma aposta é rejeitada
  // pelo próprio banco, não por lógica de aplicação.
  `CREATE TABLE IF NOT EXISTS wager_cashouts (
    id SERIAL PRIMARY KEY,
    wager_id INTEGER NOT NULL REFERENCES wagers(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stake_cashed_out NUMERIC(15, 2) NOT NULL CHECK (stake_cashed_out > 0),
    gross_value NUMERIC(15, 2) NOT NULL,
    fee_amount NUMERIC(15, 2) NOT NULL,
    net_value NUMERIC(15, 2) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (wager_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS idx_wager_cashouts_wager_id ON wager_cashouts(wager_id);`,

  // Rastreamento cumulativo do quanto já foi sacado por cashout parcial em
  // cada aposta. wagers.amount/odds_at_time/potential_payout permanecem
  // imutáveis (CLAUDE.md) — esta é a única coluna nova em wagers, e o
  // default 0 faz o cálculo de payout restante em resolveMarket (Plan 03)
  // se reduzir ao comportamento atual quando nenhum cashout ocorreu.
  `ALTER TABLE wagers ADD COLUMN IF NOT EXISTS cashed_out_amount NUMERIC(15, 2) NOT NULL DEFAULT 0;`,
];

module.exports = {
  id: '004_cashout',
  up: migrations,
  down: [
    'ALTER TABLE wagers DROP COLUMN IF EXISTS cashed_out_amount;',
    'DROP TABLE IF EXISTS wager_cashouts;',
  ],
};
