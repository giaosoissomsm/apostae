// Requisitos cobertos: MARKET-01, MARKET-02, MARKET-03 — criação positiva dos
// 3 tipos de mercado (binary regressão, over_under, multiple_choice) via
// marketService.createMarket. Execução contra Postgres real é o phase gate
// (03-07) — ver carried-forward no-test-DB blocker em STATE.md (nenhum banco
// *test*-named está acessível neste sandbox).

const {
  applyBaseSchema,
  applyMarketTypesMigration,
  seedTestUser,
  closePool,
} = require('./helpers/testDb');
const marketService = require('../src/services/marketService');

describe('marketService.createMarket — criação positiva por tipo (MARKET-01/02/03)', () => {
  let adminId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyMarketTypesMigration();
    adminId = await seedTestUser('markets_creation_admin');
  });

  afterAll(async () => {
    await closePool();
  });

  test('binary: cria mercado sem opções, mesmo formato de hoje (regressão MARKET-03)', async () => {
    const market = await marketService.createMarket(
      { question: 'Vai chover amanha?', odds_yes: 1.8, odds_no: 2.1 },
      adminId
    );

    expect(market.market_type).toBe('binary');
    expect(Number(market.odds_yes)).toBe(1.8);
    expect(Number(market.odds_no)).toBe(2.1);
    expect(market.threshold).toBeNull();
    expect(market.status).toBe('open');
    expect(market.options).toBeUndefined();
  });

  test('binary: market_type ausente no body se comporta exatamente como binary explícito', async () => {
    const market = await marketService.createMarket(
      { question: 'Outro mercado binario?', odds_yes: 1.5, odds_no: 2.5 },
      adminId
    );

    expect(market.market_type).toBe('binary');
    expect(market.options).toBeUndefined();
  });

  test('over_under: cria mercado com threshold + exatamente 2 opções auto-rotuladas', async () => {
    const market = await marketService.createMarket(
      {
        market_type: 'over_under',
        question: 'Total de gols no jogo?',
        threshold: 2.5,
        odds_over: 1.9,
        odds_under: 1.95,
      },
      adminId
    );

    expect(market.market_type).toBe('over_under');
    expect(Number(market.threshold)).toBe(2.5);
    expect(market.odds_yes).toBeNull();
    expect(market.odds_no).toBeNull();
    expect(market.options).toHaveLength(2);

    const [over, under] = market.options;
    expect(over.label).toBe('Over 2.5');
    expect(under.label).toBe('Under 2.5');
    expect(Number(over.odds)).toBe(1.9);
    expect(Number(under.odds)).toBe(1.95);
    expect(over.sort_order).toBe(0);
    expect(under.sort_order).toBe(1);
  });

  test('multiple_choice: cria mercado com N (4) opções na ordem enviada', async () => {
    const market = await marketService.createMarket(
      {
        market_type: 'multiple_choice',
        question: 'Quem marca o primeiro gol?',
        options: [
          { label: 'Time A', odds: 2.0 },
          { label: 'Time B', odds: 3.5 },
          { label: 'Ninguem', odds: 5.0 },
          { label: 'Empate 0x0', odds: 10.0 },
        ],
      },
      adminId
    );

    expect(market.market_type).toBe('multiple_choice');
    expect(market.threshold).toBeNull();
    expect(market.odds_yes).toBeNull();
    expect(market.odds_no).toBeNull();
    expect(market.options).toHaveLength(4);
    expect(market.options.map((o) => o.label)).toEqual(['Time A', 'Time B', 'Ninguem', 'Empate 0x0']);
    expect(market.options.map((o) => o.sort_order)).toEqual([0, 1, 2, 3]);
  });

  test('multiple_choice: piso de 2 opções é aceito (não exige 3+)', async () => {
    const market = await marketService.createMarket(
      {
        market_type: 'multiple_choice',
        question: 'Vai bater o recorde?',
        options: [
          { label: 'Sim, com folga', odds: 2.5 },
          { label: 'Nao', odds: 1.6 },
        ],
      },
      adminId
    );

    expect(market.options).toHaveLength(2);
  });
});
