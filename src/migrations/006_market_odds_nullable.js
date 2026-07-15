/**
 * Migration 006: Odds Binárias Opcionais
 * Corrige uma lacuna deixada pela migration 005: markets.odds_yes/odds_no
 * ainda eram NOT NULL, o que impediria QUALQUER INSERT de mercado
 * over_under/multiple_choice (esses tipos não usam odds_yes/odds_no — usam
 * market_options.odds por linha). markets.threshold já era nullable desde a
 * 005, mas odds_yes/odds_no foram esquecidas na mesma generalização.
 *
 * Puramente aditiva/relaxante: nenhuma linha existente muda de valor —
 * mercados binários continuam com odds_yes/odds_no preenchidas exatamente
 * como hoje (a coluna só deixa de EXIGIR um valor, não deixa de aceitá-lo).
 * As CHECK constraints (odds_yes >= 1.01 AND odds_yes <= 1000) já toleravam
 * NULL sem alteração — CHECK só rejeita quando a expressão avalia FALSE, e
 * uma comparação com NULL avalia UNKNOWN, que o Postgres trata como
 * satisfeita.
 */

const migrations = [
  `ALTER TABLE markets ALTER COLUMN odds_yes DROP NOT NULL;`,
  `ALTER TABLE markets ALTER COLUMN odds_no DROP NOT NULL;`,
];

module.exports = {
  id: '006_market_odds_nullable',
  up: migrations,
  down: [
    // NOTA: lossy/pode falhar se alguma linha over_under/multiple_choice já
    // tiver odds_yes/odds_no NULL — mesma convenção de down "melhor esforço"
    // já usada em 005_market_types.js (down também é lossy pra option_id).
    'ALTER TABLE markets ALTER COLUMN odds_no SET NOT NULL;',
    'ALTER TABLE markets ALTER COLUMN odds_yes SET NOT NULL;',
  ],
};
