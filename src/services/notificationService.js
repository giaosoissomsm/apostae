const domainEvents = require('../events/domainEvents');
const notificationRepository = require('../repositories/notificationRepository');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

// Este é o ÚNICO módulo do sistema que importa notificationRepository
// (NOTIF-09/D-01) — todo acesso à tabela notifications passa por aqui.

// Contém o erro de um listener (logando, nunca relançando) pra um bug num
// handler nunca derrubar o processo nem impedir os outros listeners de
// rodarem (T-01-03).
function safeHandler(fn) {
  return async (payload) => {
    try {
      await fn(payload);
    } catch (err) {
      logger.error('notificationService listener failed', { err: err.message, payload });
    }
  };
}

// Cria a notificação, tratando entrega duplicada do evento como no-op
// idempotente. IMPORTANTE: o '23505' (unique_violation) do Postgres não
// começa com 'P', então errorHandler.js NÃO trata esse código — precisa
// ser capturado aqui, antes de qualquer chance de vazar pro handler global.
async function notify(userId, { type, title, body, relatedEntity, relatedId }) {
  try {
    await notificationRepository.create({ userId, type, title, body, relatedEntity, relatedId });
  } catch (err) {
    if (err.code === '23505') {
      logger.debug(`Notificação duplicada ignorada: ${type} ${relatedEntity}#${relatedId} usuário ${userId}`);
      return;
    }
    throw err;
  }
}

// Registra um listener por evento do catálogo (D-05). Mecanismo genérico:
// fases futuras registram seus próprios `.on(...)` aqui sem precisar mexer
// num switch fixo (D-06).
function register() {
  domainEvents.on('wager.placed', safeHandler(async (evt) => {
    await notify(evt.userId, {
      type: 'wager.placed',
      title: 'Aposta registrada',
      body: `Sua aposta de R$${evt.amount.toFixed(2)} em "${evt.question}" foi registrada.`,
      relatedEntity: 'wager',
      relatedId: evt.wagerId,
    });
  }));

  domainEvents.on('wager.cancelled', safeHandler(async (evt) => {
    await notify(evt.userId, {
      type: 'wager.cancelled',
      title: 'Aposta cancelada',
      body: `Sua aposta de R$${evt.amount.toFixed(2)} em "${evt.question}" foi cancelada e o valor foi devolvido pra sua carteira.`,
      relatedEntity: 'wager',
      relatedId: evt.wagerId,
    });
  }));

  domainEvents.on('wager.won', safeHandler(async (evt) => {
    await notify(evt.userId, {
      type: 'wager.won',
      title: 'Você ganhou!',
      body: `Sua aposta de R$${evt.amount.toFixed(2)} em "${evt.question}" venceu! +R$${evt.payout.toFixed(2)}`,
      relatedEntity: 'wager',
      relatedId: evt.wagerId,
    });
  }));

  domainEvents.on('wager.lost', safeHandler(async (evt) => {
    await notify(evt.userId, {
      type: 'wager.lost',
      title: 'Aposta perdida',
      body: `Sua aposta de R$${evt.amount.toFixed(2)} em "${evt.question}" não venceu.`,
      relatedEntity: 'wager',
      relatedId: evt.wagerId,
    });
  }));

  domainEvents.on('market.closed', safeHandler(async (evt) => {
    for (const userId of evt.recipients) {
      await notify(userId, {
        type: 'market.closed',
        title: 'Mercado fechado',
        body: `O mercado "${evt.question}" foi fechado pra novas apostas.`,
        relatedEntity: 'market',
        relatedId: evt.marketId,
      });
    }
  }));

  domainEvents.on('market.resolved', safeHandler(async (evt) => {
    for (const userId of evt.recipients) {
      await notify(userId, {
        type: 'market.resolved',
        title: 'Mercado resolvido',
        body: `O mercado "${evt.question}" foi resolvido com resultado "${evt.outcome}".`,
        relatedEntity: 'market',
        relatedId: evt.marketId,
      });
    }
  }));

  domainEvents.on('market.deleted', safeHandler(async (evt) => {
    for (const refund of evt.refunds) {
      await notify(refund.userId, {
        type: 'market.deleted',
        title: 'Mercado cancelado',
        body: `O mercado "${evt.question}" foi cancelado. Sua aposta de R$${refund.amount.toFixed(2)} foi reembolsada pra sua carteira.`,
        relatedEntity: 'wager',
        relatedId: refund.wagerId,
      });
    }
  }));

  // relatedId aqui é evt.cashoutId (id da própria linha de wager_cashouts),
  // NUNCA evt.wagerId — um mesmo wager pode ser objeto de vários cashouts
  // parciais, e usar wagerId colidiria com a constraint
  // UNIQUE(user_id, type, related_entity, related_id), fazendo o segundo
  // cashout do mesmo wager ser silenciosamente engolido pelo catch de 23505
  // acima (ver RESEARCH.md Pitfall 3).
  domainEvents.on('wager.cashed_out', safeHandler(async (evt) => {
    await notify(evt.userId, {
      type: 'wager.cashed_out',
      title: 'Cashout realizado',
      body: `Você sacou R$${evt.netValue.toFixed(2)} da sua aposta em "${evt.question}". O restante continua ativo.`,
      relatedEntity: 'cashout',
      relatedId: evt.cashoutId,
    });
  }));
}

async function listForUser(userId, { page, limit, unreadOnly } = {}) {
  return notificationRepository.findByUserId(userId, { page, limit, unreadOnly });
}

// 404 (não 403) em posse não-batendo/inexistência — não vaza se a
// notificação existe pra outro usuário (Pattern 4, desvio intencional do
// precedente de wagers.js que usa 403).
async function markRead(id, userId) {
  const updated = await notificationRepository.markRead(id, userId);
  if (updated) return updated;

  const existing = await notificationRepository.findById(id, userId);
  if (!existing) throw new NotFoundError('Notificação não encontrada.');
  return existing; // já estava lida — sucesso idempotente, não erro
}

async function getUnreadCount(userId) {
  return notificationRepository.countUnread(userId);
}

module.exports = { register, notify, listForUser, markRead, getUnreadCount };
