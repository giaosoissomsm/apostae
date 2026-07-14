// Requisito coberto: NOTIF-08 — ownership scoping (IDOR): um usuário nunca
// pode ler, listar ou marcar como lida a notificação de outro usuário.

require('./helpers/testDb');

test.todo('usuário não pode acessar/marcar como lida notificação de outro usuário (404, não 403)');
