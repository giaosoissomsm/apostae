// Requisitos cobertos: CASHOUT-01, CASHOUT-02 — a rota/controller nunca confia
// em wagerId/userId/valores monetários enviados pelo cliente. O wagerId vem
// sempre de req.params.id, o userId vem sempre de req.user.id (sessão JWT),
// e apenas { amount, idempotency_key } são lidos do corpo da requisição.

jest.mock('../src/services/wagerService');

const wagerService = require('../src/services/wagerService');
const wagersController = require('../src/controllers/wagersController');

describe('wagersController.cashoutWager — boundary de mass-assignment/parameter-tampering (CASHOUT-01, CASHOUT-02)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function buildRes() {
    return { json: jest.fn() };
  }

  test('encaminha exatamente (wagerId, userId, { amount, idempotencyKey }) a partir de params/user/body válidos', async () => {
    const fakeResult = { netValue: 60, grossValue: 60, feeAmount: 0 };
    wagerService.cashoutWager.mockResolvedValue(fakeResult);

    const req = {
      params: { id: '5' },
      user: { id: 7 },
      body: { amount: 30, idempotency_key: 'abc' },
    };
    const res = buildRes();

    await wagersController.cashoutWager(req, res);

    expect(wagerService.cashoutWager).toHaveBeenCalledTimes(1);
    expect(wagerService.cashoutWager).toHaveBeenCalledWith(5, 7, { amount: 30, idempotencyKey: 'abc' });
    expect(res.json).toHaveBeenCalledWith(fakeResult);
  });

  test('ignora tentativa de mass-assignment (userId/wagerId/user_id falsos no corpo) — sempre usa params.id/user.id', async () => {
    const fakeResult = { netValue: 60 };
    wagerService.cashoutWager.mockResolvedValue(fakeResult);

    const req = {
      params: { id: '5' },
      user: { id: 7 },
      body: {
        amount: 30,
        idempotency_key: 'abc',
        userId: 999,
        wagerId: 111,
        user_id: 999,
      },
    };
    const res = buildRes();

    await wagersController.cashoutWager(req, res);

    expect(wagerService.cashoutWager).toHaveBeenCalledWith(5, 7, { amount: 30, idempotencyKey: 'abc' });
    const [calledWagerId, calledUserId] = wagerService.cashoutWager.mock.calls[0];
    expect(calledWagerId).not.toBe(999);
    expect(calledWagerId).not.toBe(111);
    expect(calledUserId).not.toBe(999);
  });

  test('ignora tentativa de parameter-tampering (netValue/payout/value falsos no corpo) — terceiro argumento nunca contém campos extras', async () => {
    const fakeResult = { netValue: 60 };
    wagerService.cashoutWager.mockResolvedValue(fakeResult);

    const req = {
      params: { id: '5' },
      user: { id: 7 },
      body: {
        amount: 30,
        idempotency_key: 'abc',
        netValue: 999999,
        payout: 999999,
        value: 999999,
      },
    };
    const res = buildRes();

    await wagersController.cashoutWager(req, res);

    const [, , options] = wagerService.cashoutWager.mock.calls[0];
    expect(options).toEqual({ amount: 30, idempotencyKey: 'abc' });
    expect(Object.keys(options).sort()).toEqual(['amount', 'idempotencyKey']);
  });

  test('res.json repassa diretamente o resultado resolvido pelo service (sem transformação extra)', async () => {
    const fakeResult = { netValue: 42, grossValue: 42, feeAmount: 0, stakeCashedOut: 20 };
    wagerService.cashoutWager.mockResolvedValue(fakeResult);

    const req = {
      params: { id: '5' },
      user: { id: 7 },
      body: { amount: 20, idempotency_key: 'xyz' },
    };
    const res = buildRes();

    await wagersController.cashoutWager(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(fakeResult);
  });
});
