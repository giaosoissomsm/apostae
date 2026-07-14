/**
 * Testes unitários de src/utils/money.js (CASHOUT-10).
 * Funções puras, sem I/O — rodam de verdade neste sandbox (sem depender de
 * um Postgres de teste alcançável, ao contrário dos testes de integração).
 */

const money = require('../src/utils/money');

describe('money.toCents / money.fromCents', () => {
  test('toCents(1.005) arredonda para 101 (corrige erro de ponto flutuante)', () => {
    expect(money.toCents(1.005)).toBe(101);
  });

  test('fromCents(101) é 1.01', () => {
    expect(money.fromCents(101)).toBe(1.01);
  });
});

describe('money.multiply', () => {
  test('multiply(10, 2.5) === 25 (stake × odds)', () => {
    expect(money.multiply(10, 2.5)).toBe(25);
  });

  test('multiply(33.33, 3) === 99.99, sem resíduo de ponto flutuante', () => {
    expect(money.multiply(33.33, 3)).toBe(99.99);
  });
});

describe('money.subtract', () => {
  test('subtract(100, 33.33) === 66.67, sem artefato de float', () => {
    expect(money.subtract(100, 33.33)).toBe(66.67);
  });
});

describe('money.applyFeePercent', () => {
  test('applyFeePercent(100, 0) retorna { fee: 0, net: 100 } (BR-1: termo de taxa presente mas zero)', () => {
    expect(money.applyFeePercent(100, 0)).toEqual({ fee: 0, net: 100 });
  });

  test('applyFeePercent(100, 5) retorna { fee: 5, net: 95 } (prova que o termo de taxa funciona pra uma taxa futura não-zero)', () => {
    expect(money.applyFeePercent(100, 5)).toEqual({ fee: 5, net: 95 });
  });
});

describe('CASHOUT-10: ausência de drift em operações repetidas', () => {
  test('20 iterações de multiply + subtract não acumulam nenhum drift de ponto flutuante', () => {
    let remaining = 1000;
    let totalCashedOut = 0;

    for (let i = 0; i < 20; i += 1) {
      const cashout = money.multiply(10, 3.33); // 33.3 por iteração
      remaining = money.subtract(remaining, cashout);
      totalCashedOut = money.subtract(totalCashedOut, -cashout); // totalCashedOut += cashout
    }

    expect(remaining).toBe(334);
    expect(totalCashedOut).toBe(666);
    // Invariante: o que sobra + o que foi sacado sempre reconstrói o valor original.
    expect(money.subtract(remaining, -totalCashedOut)).toBe(1000);
  });
});
