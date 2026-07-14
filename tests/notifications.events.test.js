// Requisitos cobertos: NOTIF-01..05 — eventos de domínio (aposta feita,
// aposta ganha, aposta perdida, aposta cancelada, mercado fechado/resolvido)
// disparam a criação da notificação correspondente via domainEvents.

require('./helpers/testDb');

test.todo('cada evento de domínio (wager.*, market.*) gera a notificação correspondente');
