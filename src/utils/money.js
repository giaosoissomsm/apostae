/**
 * Utilitário de matemática monetária decimal-safe (CASHOUT-10).
 *
 * Toda operação financeira que multiplica/soma/subtrai valores em dinheiro
 * deve usar essas funções — nunca `Math.round(x * 100) / 100` direto
 * espalhado pelo código (esse era o único padrão existente antes desta
 * refatoração, ver src/services/wagerService.js:38). Ponto flutuante puro
 * acumula erro em operações repetidas (múltiplos cashouts parciais sobre a
 * mesma aposta, por exemplo), o que essa utilidade existe pra evitar.
 *
 * Estratégia: converte o valor decimal pra "centavos inteiros" (toda coluna
 * monetária do schema é NUMERIC(15,2) — 2 casas decimais), faz a aritmética
 * em espaço inteiro, converte de volta pra decimal no final. `Number.EPSILON`
 * corrige o caso clássico em que a própria multiplicação por 100 já introduz
 * erro de representação binária ANTES do arredondamento — ex.: em IEEE 754,
 * `1.005 * 100 === 100.49999999999999`, o que faria `Math.round` devolver
 * 100 (errado) em vez de 101 (correto, 1.005 arredondado pra cima em 2 casas).
 * Somar `Number.EPSILON` antes de arredondar empurra esses casos de borda
 * pro lado certo sem afetar valores que já caem exatamente num inteiro.
 */

function toCents(amount) {
  return Math.round((Number(amount) + Number.EPSILON) * 100);
}

function fromCents(cents) {
  return cents / 100;
}

// stake * odds (ou qualquer fator), arredondado a 2 casas, calculado em espaço inteiro.
function multiply(amount, factor) {
  return fromCents(Math.round(toCents(amount) * factor + Number.EPSILON));
}

function subtract(a, b) {
  return fromCents(toCents(a) - toCents(b));
}

// Aplica uma taxa percentual sobre `amount`. `feePercent` é um número tipo 5
// (para 5%), não uma fração 0.05. Com feePercent=0 (padrão desta milestone,
// BR-1), fee sempre resolve pra 0 e net === amount — mas o termo da taxa
// fica presente na fórmula pra uma milestone futura poder ligar uma taxa
// não-zero sem reescrever a fórmula de payout.
function applyFeePercent(amount, feePercent) {
  const fee = fromCents(Math.round(toCents(amount) * (feePercent / 100) + Number.EPSILON));
  return { fee, net: subtract(amount, fee) };
}

module.exports = { toCents, fromCents, multiply, subtract, applyFeePercent };
