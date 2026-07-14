/**
 * Barramento de eventos de domínio (event bus).
 *
 * Singleton compartilhado por todo o processo (cache de módulos do Node):
 * qualquer `require('./domainEvents')` retorna a mesma instância. É genérico
 * por design (D-02/D-06) — não define nomes de evento fixos nem lógica
 * específica de notificações; qualquer módulo pode emitir/assinar qualquer
 * evento string. Este é o ponto de troca futuro para entrega em tempo real
 * (NOTIF-10).
 *
 * Um handler de 'error' é registrado aqui no nível superior porque, por
 * padrão do Node, um EventEmitter que recebe um evento 'error' sem nenhum
 * listener lança a exceção e derruba o processo. Isso protege o restante do
 * sistema (inclusive código financeiro) de um listener com bug.
 */

const { EventEmitter } = require('events');

const domainEvents = new EventEmitter();

domainEvents.on('error', (err) => {
  require('../utils/logger').error('domainEvents listener error', err);
});

module.exports = domainEvents;
