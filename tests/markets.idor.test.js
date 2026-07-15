// Requisitos cobertos: MARKET-06 — todo caminho de rejeição/aceitação do
// chokepoint IDOR-safe de wagerService.placeWager (marketOptionRepository.
// findByIdForMarket), mais os vetores de ataque exigidos por requisitos.txt:
// option_id cruzando mercados, odds/potential_payout forjados pelo cliente,
// e criação de mercado por não-admin. Execução contra Postgres real é o
// phase gate (03-07) — ver carried-forward no-test-DB blocker em STATE.md
// (nenhum banco *test*-named está acessível neste sandbox); a checagem de
// não-admin (Teste 4) não depende de banco, roda estruturalmente sempre.

const {
  applyBaseSchema,
  applyWalletSchema,
  applyMarketTypesMigration,
  seedTestUser,
  seedWallet,
  seedOpenMarket,
  seedMarketOptions,
  closePool,
} = require('./helpers/testDb');
const wagerService = require('../src/services/wagerService');
const { ValidationError } = require('../src/utils/errors');

describe('wagerService.placeWager — IDOR e vetores de ataque em option_id (MARKET-06)', () => {
  let userId;
  let marketAId;
  let marketBId;
  let optionsA;
  let optionsB;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyMarketTypesMigration();

    userId = await seedTestUser('markets_idor_user');
    await seedWallet(userId, 1000);

    marketAId = await seedOpenMarket({
      createdBy: userId,
      question: 'Mercado A — quem vence?',
      marketType: 'multiple_choice',
    });
    marketBId = await seedOpenMarket({
      createdBy: userId,
      question: 'Mercado B — quem vence?',
      marketType: 'multiple_choice',
    });

    optionsA = await seedMarketOptions(marketAId, [
      { label: 'A - Time 1', odds: 2.0 },
      { label: 'A - Time 2', odds: 3.0 },
    ]);
    optionsB = await seedMarketOptions(marketBId, [
      { label: 'B - Time 1', odds: 1.5 },
      { label: 'B - Time 2', odds: 4.25 },
    ]);
  });

  afterAll(async () => {
    await closePool();
  });

  test('option_id pertencente ao mercado A é rejeitado ao apostar no mercado B (IDOR, MARKET-06)', async () => {
    const foreignOptionId = optionsA[0].id;

    await expect(
      wagerService.placeWager(userId, {
        market_id: marketBId,
        amount: 10,
        option_id: foreignOptionId,
      })
    ).rejects.toThrow(ValidationError);
  });

  test('option_id do próprio mercado é aceito e a odds gravada vem do servidor (market_options.odds)', async () => {
    const ownOption = optionsB[1]; // odds 4.25

    const wager = await wagerService.placeWager(userId, {
      market_id: marketBId,
      amount: 10,
      option_id: ownOption.id,
    });

    expect(Number(wager.odds_at_time)).toBe(4.25);
    expect(wager.option_id).toBe(ownOption.id);
    expect(wager.choice).toBeNull();
  });

  test('odds/potential_payout forjados no corpo da requisição são ignorados — servidor sempre recalcula a partir da opção travada', async () => {
    const ownOption = optionsA[1]; // odds 3.0

    const wager = await wagerService.placeWager(userId, {
      market_id: marketAId,
      amount: 20,
      option_id: ownOption.id,
      // Campos que o cliente NUNCA deveria conseguir controlar — a service
      // nem sequer os destructura, então não têm como influenciar o
      // resultado; a asserção abaixo prova isso.
      odds_at_time: 999,
      odds: 999,
      potential_payout: 999999,
    });

    expect(Number(wager.odds_at_time)).toBe(3.0);
    expect(Number(wager.potential_payout)).toBe(60); // 20 * 3.0, via money.multiply
  });

  test('option_id inexistente é rejeitado com ValidationError (não um erro cru de banco)', async () => {
    await expect(
      wagerService.placeWager(userId, {
        market_id: marketAId,
        amount: 10,
        option_id: 999999999,
      })
    ).rejects.toThrow(ValidationError);
  });
});

describe('POST /api/markets — vetor de ataque: criação de mercado por não-admin (MARKET-04)', () => {
  // Este repositório não tem um harness de requisição HTTP (supertest) nem
  // Playwright/Cypress instalados — nenhum dos testes de integração
  // existentes (Phase 1/2/3) monta o app Express real para simular uma
  // requisição autenticada fim-a-fim. Por isso, o vetor "não-admin não pode
  // criar mercado" é verificado no nível de wiring de rota: a própria
  // definição de POST /api/markets precisa carregar requireAdmin no
  // middleware stack ANTES do controller, garantindo que qualquer requisição
  // sem privilégio de admin é rejeitada com 403 antes de tocar
  // marketsController.createMarket — decisão documentada aqui conforme
  // pedido pelo plano (03-04-PLAN.md Task 2).
  test('POST /api/markets exige requireAdmin no middleware stack, antes do controller', () => {
    const router = require('../src/routes/markets');
    const { requireAuth, requireAdmin } = require('../src/middleware/auth');
    const marketsController = require('../src/controllers/marketsController');

    const postLayer = router.stack.find(
      (layer) => layer.route && layer.route.path === '/' && layer.route.methods.post
    );
    expect(postLayer).toBeDefined();

    const handlers = postLayer.route.stack.map((s) => s.handle);
    const authIndex = handlers.indexOf(requireAuth);
    const adminIndex = handlers.indexOf(requireAdmin);
    const controllerIndex = handlers.findIndex((h) => h === marketsController.createMarket || h.name === 'createMarket');

    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(adminIndex).toBeGreaterThanOrEqual(0);
    // Ordem importa: auth -> admin -> controller. Sem isso, um usuário
    // autenticado-mas-não-admin chegaria ao controller.
    expect(authIndex).toBeLessThan(adminIndex);
    expect(adminIndex).toBeLessThan(controllerIndex);
  });
});
