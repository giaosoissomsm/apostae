// Requisitos cobertos: MARKET-04, MARKET-05 — toda rejeição server-side de
// marketService.createMarket (contagem de opções, threshold malformado,
// rótulos duplicados, limite de 20 opções, odds fora da faixa, market_type
// desconhecido), sempre lançando ValidationError ANTES de qualquer gravação.
// Execução contra Postgres real é o phase gate (03-07) — ver carried-forward
// no-test-DB blocker em STATE.md (nenhum banco *test*-named está acessível
// neste sandbox).

const {
  applyBaseSchema,
  applyMarketTypesMigration,
  seedTestUser,
  closePool,
} = require('./helpers/testDb');
const { query } = require('../src/config/database');
const marketService = require('../src/services/marketService');
const { ValidationError } = require('../src/utils/errors');

describe('marketService.createMarket — validação e rejeições (MARKET-04, MARKET-05)', () => {
  let adminId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyMarketTypesMigration();
    adminId = await seedTestUser('markets_validation_admin');
  });

  afterAll(async () => {
    await closePool();
  });

  async function countMarkets() {
    const result = await query('SELECT COUNT(*)::int AS c FROM markets;');
    return result.rows[0].c;
  }

  test('multiple_choice com 1 opção (abaixo do piso de 2) lança ValidationError sem gravar', async () => {
    const before = await countMarkets();
    await expect(
      marketService.createMarket(
        { market_type: 'multiple_choice', question: 'Pergunta valida?', options: [{ label: 'Unica', odds: 2.0 }] },
        adminId
      )
    ).rejects.toThrow(ValidationError);
    expect(await countMarkets()).toBe(before);
  });

  test('multiple_choice com 21 opções (acima do limite travado de 20, MARKET-05) lança ValidationError sem gravar', async () => {
    const before = await countMarkets();
    const options = Array.from({ length: 21 }, (_, i) => ({ label: `Opcao ${i}`, odds: 2.0 }));
    await expect(
      marketService.createMarket({ market_type: 'multiple_choice', question: 'Pergunta valida?', options }, adminId)
    ).rejects.toThrow(ValidationError);
    expect(await countMarkets()).toBe(before);
  });

  test('multiple_choice com exatamente 20 opções (limite, não acima dele) é aceito', async () => {
    const before = await countMarkets();
    const options = Array.from({ length: 20 }, (_, i) => ({ label: `Opcao ${i}`, odds: 2.0 }));
    const market = await marketService.createMarket(
      { market_type: 'multiple_choice', question: 'Pergunta valida?', options },
      adminId
    );
    expect(market.options).toHaveLength(20);
    expect(await countMarkets()).toBe(before + 1);
  });

  test('multiple_choice com rótulos duplicados (diferindo só por maiúsculas/espaços) lança ValidationError sem gravar', async () => {
    const before = await countMarkets();
    await expect(
      marketService.createMarket(
        {
          market_type: 'multiple_choice',
          question: 'Pergunta valida?',
          options: [
            { label: 'Time A', odds: 2.0 },
            { label: '  time a  ', odds: 3.0 },
          ],
        },
        adminId
      )
    ).rejects.toThrow(ValidationError);
    expect(await countMarkets()).toBe(before);
  });

  test.each([0, -1, NaN, 'abc'])('over_under com threshold inválido (%p) lança ValidationError sem gravar', async (threshold) => {
    const before = await countMarkets();
    await expect(
      marketService.createMarket(
        { market_type: 'over_under', question: 'Pergunta valida?', threshold, odds_over: 1.9, odds_under: 1.9 },
        adminId
      )
    ).rejects.toThrow(ValidationError);
    expect(await countMarkets()).toBe(before);
  });

  test.each([0.5, 1000.01, -2, 'abc'])('odds fora da faixa 1.01-1000 (%p) lança ValidationError sem gravar', async (badOdds) => {
    const before = await countMarkets();
    await expect(
      marketService.createMarket(
        { market_type: 'over_under', question: 'Pergunta valida?', threshold: 2.5, odds_over: badOdds, odds_under: 1.9 },
        adminId
      )
    ).rejects.toThrow(ValidationError);
    expect(await countMarkets()).toBe(before);
  });

  test('market_type desconhecido lança ValidationError sem gravar', async () => {
    const before = await countMarkets();
    await expect(
      marketService.createMarket({ market_type: 'exotic_type', question: 'Pergunta valida?' }, adminId)
    ).rejects.toThrow(ValidationError);
    expect(await countMarkets()).toBe(before);
  });

  test('binary com odds fora da faixa continua rejeitando (comportamento inalterado, MARKET-03)', async () => {
    const before = await countMarkets();
    await expect(
      marketService.createMarket({ question: 'Pergunta valida?', odds_yes: 0.5, odds_no: 2.0 }, adminId)
    ).rejects.toThrow(ValidationError);
    expect(await countMarkets()).toBe(before);
  });

  test('pergunta curta demais (<4 chars) lança ValidationError pra qualquer tipo', async () => {
    const before = await countMarkets();
    await expect(
      marketService.createMarket(
        { market_type: 'over_under', question: 'ab', threshold: 2.5, odds_over: 1.9, odds_under: 1.9 },
        adminId
      )
    ).rejects.toThrow(ValidationError);
    expect(await countMarkets()).toBe(before);
  });
});
