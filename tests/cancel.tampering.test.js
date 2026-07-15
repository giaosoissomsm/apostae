// Requisito coberto: CANCEL-08 e os invariantes de controle de acesso da
// Fase 4 — superfície de ataque de cancelWager: IDOR (cancelar aposta de
// outro usuário), nenhum valor de taxa/reembolso confiado do corpo da
// requisição, e a rota/método DELETE /:id permanece exatamente a mesma
// (sem versionamento/flag). Os testes 2 e 3 são estáticos/estruturais (sem
// necessidade de banco); o teste 1 (IDOR) é de integração e precisa do banco
// de teste real.

const fs = require('fs');
const path = require('path');
const {
  applyBaseSchema,
  applyWalletSchema,
  applyCashoutMigration,
  seedTestUser,
  seedWallet,
  seedOpenMarket,
  seedWager,
  wait,
  closePool,
} = require('./helpers/testDb');
const { query } = require('../src/config/database');
const wagerService = require('../src/services/wagerService');
const { NotFoundError } = require('../src/utils/errors');

// Describe isolado (com beforeAll/afterAll de banco) só pro teste de
// integração IDOR — mantido separado dos testes estáticos abaixo pra que uma
// falha do beforeAll de banco (carried-forward blocker, ver SUMMARY) não
// derrube os dois testes estruturais que não precisam de banco nenhum.
describe('cancelWager - IDOR (integração, precisa de banco de teste)', () => {
  let ownerId;
  let attackerId;

  beforeAll(async () => {
    await applyBaseSchema();
    await applyWalletSchema();
    await applyCashoutMigration();
    ownerId = await seedTestUser('cancel_tampering_owner');
    attackerId = await seedTestUser('cancel_tampering_attacker');
  });

  afterAll(async () => {
    await closePool();
  });

  async function getWalletBalance(uid) {
    const result = await query('SELECT balance FROM wallets WHERE user_id = $1;', [uid]);
    return Number(result.rows[0].balance);
  }

  test('IDOR: usuário não-dono tentando cancelar aposta alheia recebe NotFoundError (404), não AuthorizationError (403) — sem vazar existência', async () => {
    await seedWallet(ownerId, 1000);
    await seedWallet(attackerId, 1000);
    const ownerBalanceBefore = await getWalletBalance(ownerId);
    const attackerBalanceBefore = await getWalletBalance(attackerId);

    const marketId = await seedOpenMarket({ createdBy: ownerId, oddsYes: 2.0, oddsNo: 2.0 });
    const wagerId = await seedWager({
      userId: ownerId,
      marketId,
      choice: 'yes',
      amount: 100,
      oddsAtTime: 2.0,
      potentialPayout: 200,
      cashedOutAmount: 0,
    });

    // attackerId tenta cancelar a aposta de ownerId. Ownership está embutida
    // no WHERE da query de lock (wagerRepository.findByIdForUpdate) — a
    // linha simplesmente não bate pra esse userId, então o SELECT ... FOR
    // UPDATE retorna vazio e o serviço lança NotFoundError, não
    // AuthorizationError. Isso evita confirmar pro atacante que a aposta #id
    // sequer existe.
    const rejection = await wagerService.cancelWager(wagerId, attackerId).catch((err) => err);
    expect(rejection).toBeInstanceOf(NotFoundError);
    expect(rejection.constructor.name).toBe('NotFoundError');
    expect(rejection.statusCode).toBe(404);
    await wait();

    const wagerRow = await query('SELECT status FROM wagers WHERE id = $1;', [wagerId]);
    expect(wagerRow.rows[0].status).toBe('pending');

    const ownerBalanceAfter = await getWalletBalance(ownerId);
    const attackerBalanceAfter = await getWalletBalance(attackerId);
    expect(ownerBalanceAfter).toBe(ownerBalanceBefore);
    expect(attackerBalanceAfter).toBe(attackerBalanceBefore);
  });
});

// Describe estático — SEM beforeAll de banco. Roda independente do banco de
// teste estar acessível ou não (per 04-03-PLAN.md: "Tests 2 and 3 are
// static/structural and require no DB").
describe('cancelWager - superfície de ataque estática (CANCEL-08, sem banco)', () => {
  test('nenhum valor de taxa/reembolso é confiado do cliente: assinatura do serviço aceita apenas (wagerId, userId), controller lê só req.params.id + req.user.id', () => {
    // Assinatura estrutural: cancelWager.length === 2 garante que um futuro
    // refactor não consegue contrabandear um terceiro parâmetro de
    // opções (ex.: { fee, amount }) sem que essa asserção quebre primeiro.
    expect(wagerService.cancelWager.length).toBe(2);

    // Checagem estática do controller: lê a fatia do handler cancelWager e
    // confirma que ele só repassa req.params.id + req.user.id ao serviço, e
    // que NUNCA referencia req.body dentro desse handler específico.
    const controllerSource = fs.readFileSync(
      path.join(__dirname, '../src/controllers/wagersController.js'),
      'utf8'
    );
    const handlerMatch = controllerSource.match(/const cancelWager = catchAsync\(async \(req, res\) => \{[\s\S]*?\n\}\);/);
    expect(handlerMatch).not.toBeNull();
    const handlerSlice = handlerMatch[0];

    expect(handlerSlice).toContain('req.params.id');
    expect(handlerSlice).toContain('req.user.id');
    expect(handlerSlice).not.toContain('req.body');
  });

  test('CANCEL-08: rota DELETE /:id com requireAuth permanece inalterada — sem endpoint versionado nem feature flag', () => {
    const routesSource = fs.readFileSync(path.join(__dirname, '../src/routes/wagers.js'), 'utf8');
    expect(routesSource).toContain("router.delete('/:id', requireAuth, wagersController.cancelWager)");
  });
});
