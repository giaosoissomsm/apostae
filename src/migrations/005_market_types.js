/**
 * Migration 005: Novos Tipos de Mercado
 * Generaliza o schema binário (Sim/Não) pra suportar Over/Under (limite
 * configurável) e Múltipla Escolha (N opções), sem alterar nenhum dado ou
 * comportamento existente de mercados binários (MARKET-03). Puramente
 * aditiva — nenhuma linha existente muda de semântica.
 */

const migrations = [
  // Discriminador de tipo de mercado. Mercados existentes recebem 'binary'
  // via DEFAULT — nenhum backfill necessário, migração puramente aditiva (MARKET-03).
  `ALTER TABLE markets ADD COLUMN IF NOT EXISTS market_type VARCHAR(20) NOT NULL DEFAULT 'binary'
     CHECK (market_type IN ('binary', 'over_under', 'multiple_choice'));`,

  // Limite livre do admin para mercados Over/Under (MARKET-01). NULL pros outros tipos.
  `ALTER TABLE markets ADD COLUMN IF NOT EXISTS threshold NUMERIC(10, 2);`,

  // Opções selecionáveis — uma linha por alternativa. odds usa a mesma faixa de
  // isValidOdds() (1.01-1000) já aplicada a odds_yes/odds_no. ON DELETE CASCADE
  // é a base do FK de propriedade que o guard de IDOR (MARKET-06) consulta.
  `CREATE TABLE IF NOT EXISTS market_options (
    id SERIAL PRIMARY KEY,
    market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    label VARCHAR(200) NOT NULL,
    odds NUMERIC(10, 2) NOT NULL CHECK (odds >= 1.01 AND odds <= 1000),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (market_id, label)
  );
  CREATE INDEX IF NOT EXISTS idx_market_options_market_id ON market_options(market_id);`,

  // Resultado vencedor pra mercados N-outcome. NULL pra binary (que continua
  // usando markets.outcome, intocado).
  `ALTER TABLE markets ADD COLUMN IF NOT EXISTS winning_option_id INTEGER REFERENCES market_options(id);`,

  // Cada aposta referencia OU choice (binary) OU option_id (novos tipos), nunca os dois.
  `ALTER TABLE wagers ALTER COLUMN choice DROP NOT NULL;`,
  `ALTER TABLE wagers ADD COLUMN IF NOT EXISTS option_id INTEGER REFERENCES market_options(id);`,
  `ALTER TABLE wagers ADD CONSTRAINT wagers_choice_xor_option CHECK (
     (choice IS NOT NULL AND option_id IS NULL) OR (choice IS NULL AND option_id IS NOT NULL)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_wagers_option_id ON wagers(option_id);`,
];

module.exports = {
  id: '005_market_types',
  up: migrations,
  down: [
    // NOTA: lossy pra qualquer linha que usou option_id (choice não pode ser
    // recuperado) — aceitável, seguindo a mesma convenção de down migration
    // já usada neste repo (down de 002_wallet.js também não tenta preservar dados).
    'ALTER TABLE wagers DROP CONSTRAINT IF EXISTS wagers_choice_xor_option;',
    'ALTER TABLE wagers DROP COLUMN IF EXISTS option_id;',
    'ALTER TABLE wagers ALTER COLUMN choice SET NOT NULL;',
    'ALTER TABLE markets DROP COLUMN IF EXISTS winning_option_id;',
    'DROP TABLE IF EXISTS market_options;',
    'ALTER TABLE markets DROP COLUMN IF EXISTS threshold;',
    'ALTER TABLE markets DROP COLUMN IF EXISTS market_type;',
  ],
};
