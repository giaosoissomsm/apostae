// Requisito coberto: 02-REVIEW.md CR-01 — wagerService.cashoutWager() precisa
// emitir 'SAVEPOINT cashout_insert' ANTES do INSERT especulativo em
// wager_cashouts, e 'ROLLBACK TO SAVEPOINT cashout_insert' (nunca um ROLLBACK
// da transação inteira) IMEDIATAMENTE após uma colisão 23505 e ANTES de ler o
// resultado já commitado via findByIdempotencyKey.
//
// Por quê isso importa: no Postgres real, uma vez que qualquer statement
// dentro de BEGIN/COMMIT levanta um erro (incluindo um unique-violation), a
// transação inteira entra em estado "aborted" e todo statement seguinte na
// mesma conexão falha com 25P02 ("current transaction is aborted") até um
// ROLLBACK explícito (ou ROLLBACK TO SAVEPOINT, se um savepoint foi
// estabelecido ANTES do statement que falhou). Sem o savepoint, o SELECT de
// replay (findByIdempotencyKey) levantaria 25P02 — não 23505 — e esse erro
// escaparia do catch, quebrando CASHOUT-07 (replay idempotente) em toda
// retentativa real. Ver 02-REVIEW.md CR-01 pro repro completo.
//
// NENHUM Postgres real está acessível neste sandbox (mesmo bloqueio
// documentado em toda SUMMARY de fase 1/2 anterior). Este teste usa um
// client Postgres FALSO (mock) que simula o efeito observável de uma colisão
// 23505 e verifica, na ORDEM EXATA das operações, que o savepoint é
// estabelecido antes do INSERT e o rollback-to-savepoint acontece entre o
// 23505 e a leitura de replay — sem isso, o teste falha se alguém remover o
// SAVEPOINT/ROLLBACK TO SAVEPOINT do código de produção. Isto NÃO substitui a
// verificação contra um Postgres real (que não pode rodar aqui) — ver
// 02-REVIEW-FIX.md pra o que foi e não foi verificado contra Postgres real.

jest.mock('../src/config/database');
jest.mock('../src/repositories/marketRepository');
jest.mock('../src/repositories/wagerRepository');
jest.mock('../src/repositories/walletRepository');
jest.mock('../src/repositories/cashoutRepository');

const { transaction } = require('../src/config/database');
const marketRepository = require('../src/repositories/marketRepository');
const wagerRepository = require('../src/repositories/wagerRepository');
const walletRepository = require('../src/repositories/walletRepository');
const cashoutRepository = require('../src/repositories/cashoutRepository');
const wagerService = require('../src/services/wagerService');

describe('wagerService.cashoutWager — SAVEPOINT + ROLLBACK TO SAVEPOINT antes do replay idempotente (CR-01)', () => {
  let steps;
  let fakeClient;

  beforeEach(() => {
    jest.clearAllMocks();
    steps = [];

    fakeClient = {
      query: jest.fn(async (sql) => {
        const trimmed = sql.trim();
        if (/^SELECT market_id FROM wagers/.test(trimmed)) {
          return { rows: [{ market_id: 1 }] };
        }
        if (/^SAVEPOINT cashout_insert$/.test(trimmed)) {
          steps.push('SAVEPOINT');
          return { rows: [] };
        }
        if (/^ROLLBACK TO SAVEPOINT cashout_insert$/.test(trimmed)) {
          steps.push('ROLLBACK_TO_SAVEPOINT');
          return { rows: [] };
        }
        throw new Error(`query inesperada no fake client (não coberta por este teste): ${trimmed}`);
      }),
    };

    transaction.mockImplementation((callback) => callback(fakeClient));

    marketRepository.findByIdForUpdate.mockResolvedValue({
      id: 1,
      status: 'open',
      question: 'Mercado de teste?',
    });

    wagerRepository.findByIdForUpdate.mockResolvedValue({
      id: 5,
      amount: 100,
      cashed_out_amount: 0,
      odds_at_time: 2,
      status: 'pending',
    });
  });

  test('numa colisão 23505: SAVEPOINT -> INSERT (falha) -> ROLLBACK TO SAVEPOINT -> replay, sem reaplicar o crédito', async () => {
    const duplicateKeyError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });

    cashoutRepository.create.mockImplementation(async () => {
      steps.push('INSERT_ATTEMPT');
      throw duplicateKeyError;
    });

    const existingCashout = {
      id: 99,
      net_value: '55.00',
      gross_value: '60.00',
      fee_amount: '5.00',
      stake_cashed_out: '30.00',
    };
    cashoutRepository.findByIdempotencyKey.mockImplementation(async () => {
      steps.push('REPLAY_SELECT');
      return existingCashout;
    });

    const result = await wagerService.cashoutWager(5, 7, { amount: 30, idempotencyKey: 'retry-key' });

    // Ordem exata das operações dentro da transação — se o SAVEPOINT ou o
    // ROLLBACK TO SAVEPOINT forem removidos/reordenados, esta asserção falha.
    expect(steps).toEqual(['SAVEPOINT', 'INSERT_ATTEMPT', 'ROLLBACK_TO_SAVEPOINT', 'REPLAY_SELECT']);

    // Resultado é o cashout já commitado (replay), não um novo.
    expect(result.cashout.id).toBe(99);
    expect(result.netValue).toBe(55);

    // Réplica idempotente nunca reaplica o crédito na carteira nem o
    // incremento de cashed_out_amount (CASHOUT-07).
    expect(wagerRepository.incrementCashedOutAmount).not.toHaveBeenCalled();
    expect(walletRepository.adjustBalance).not.toHaveBeenCalled();
    expect(walletRepository.recordTransaction).not.toHaveBeenCalled();
  });

  test('sem colisão (cashout novo): SAVEPOINT é emitido mas o fluxo normal credita a carteira uma única vez', async () => {
    const newCashout = {
      id: 1,
      net_value: '60.00',
      gross_value: '60.00',
      fee_amount: '0.00',
      stake_cashed_out: '30.00',
    };
    cashoutRepository.create.mockImplementation(async () => {
      steps.push('INSERT_OK');
      return newCashout;
    });

    wagerRepository.incrementCashedOutAmount.mockResolvedValue({});
    walletRepository.findByUserIdForUpdate.mockResolvedValue({ id: 42, balance: 500 });
    walletRepository.adjustBalance.mockResolvedValue({ balance: 560 });
    walletRepository.recordTransaction.mockResolvedValue({});

    const result = await wagerService.cashoutWager(5, 7, { amount: 30, idempotencyKey: 'fresh-key' });

    expect(steps).toEqual(['SAVEPOINT', 'INSERT_OK']);
    expect(cashoutRepository.findByIdempotencyKey).not.toHaveBeenCalled();
    expect(result.cashout.id).toBe(1);
    expect(wagerRepository.incrementCashedOutAmount).toHaveBeenCalledTimes(1);
    expect(walletRepository.adjustBalance).toHaveBeenCalledTimes(1);
  });
});
