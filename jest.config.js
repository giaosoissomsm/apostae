/**
 * Configuração do Jest.
 * Testes de integração compartilham uma única base Postgres de teste
 * (ver tests/helpers/testDb.js), por isso `npm test` roda em série
 * (--runInBand, configurado em package.json).
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
};
