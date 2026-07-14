// Requisito coberto: NOTIF-09 — idempotência: o mesmo evento de domínio não
// deve gerar notificações duplicadas (UNIQUE(user_id, type, related_entity, related_id)).

require('./helpers/testDb');

test.todo('emitir o mesmo evento de domínio duas vezes gera apenas uma notificação (23505 ignorado)');
