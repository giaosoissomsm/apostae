const { transaction } = require('../config/database');
const wagerRepository = require('../repositories/wagerRepository');
const walletRepository = require('../repositories/walletRepository');
const userRepository = require('../repositories/userRepository');
const domainEvents = require('../events/domainEvents');
const { ValidationError, NotFoundError, ConflictError, AuthorizationError } = require('../utils/errors');
const logger = require('../utils/logger');

class WagerService {
  // O dono da aposta é sempre o userId do token - nunca é lido do body.
  async placeWager(userId, { market_id, choice, amount }) {
    const marketId = Number(market_id);
    const wagerAmount = Number(amount);

    if (!Number.isFinite(marketId)) throw new ValidationError('market_id inválido.');
    if (choice !== 'yes' && choice !== 'no') throw new ValidationError("choice precisa ser 'yes' ou 'no'.");
    if (!Number.isFinite(wagerAmount) || wagerAmount <= 0) {
      throw new ValidationError('Valor da aposta precisa ser maior que zero.');
    }

    let marketQuestion;

    const wager = await transaction(async (client) => {
      const marketResult = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [marketId]);
      const market = marketResult.rows[0];
      if (!market) throw new NotFoundError('Mercado não encontrado.');
      if (market.status !== 'open') throw new ConflictError('Esse mercado não está mais aberto para apostas.');
      if (market.closes_at && new Date(market.closes_at) <= new Date()) {
        throw new ConflictError('O prazo pra apostar nesse mercado já acabou.');
      }

      marketQuestion = market.question;

      const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
      if (Number(wallet.balance) < wagerAmount) throw new ValidationError('Créditos insuficientes.');

      const odds = choice === 'yes' ? Number(market.odds_yes) : Number(market.odds_no);
      const potentialPayout = Math.round(wagerAmount * odds * 100) / 100;

      const createdWager = await wagerRepository.create(
        { userId, marketId, choice, amount: wagerAmount, oddsAtTime: odds, potentialPayout },
        client
      );

      const balanceBefore = wallet.balance;
      const updated = await walletRepository.adjustBalance(wallet.id, -wagerAmount, client);
      await walletRepository.recordTransaction({
        walletId: wallet.id,
        type: 'debit',
        amount: wagerAmount,
        balanceBefore,
        balanceAfter: updated.balance,
        relatedEntity: 'wager',
        relatedId: createdWager.id,
        description: `Aposta #${createdWager.id} no mercado #${marketId}`,
      }, client);

      return createdWager;
    });

    // Emitido só depois do commit (D-01): um rollback nunca deve deixar um
    // evento "fantasma" sem linha correspondente no banco.
    domainEvents.emit('wager.placed', {
      wagerId: wager.id,
      userId,
      marketId,
      question: marketQuestion,
      choice,
      amount: wagerAmount,
    });

    return wager;
  }

  // Cancela a PRÓPRIA aposta (só se o mercado ainda estiver aberto). Posse checada contra userId do token.
  async cancelWager(wagerId, userId) {
    const result = await transaction(async (client) => {
      const wagerResult = await client.query('SELECT * FROM wagers WHERE id = $1 FOR UPDATE;', [wagerId]);
      const wager = wagerResult.rows[0];
      if (!wager) throw new NotFoundError('Aposta não encontrada.');
      if (wager.user_id !== userId) throw new AuthorizationError('Essa aposta não é sua.');
      if (wager.status !== 'pending') throw new ConflictError('Essa aposta não pode mais ser cancelada.');

      const marketResult = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [wager.market_id]);
      const market = marketResult.rows[0];
      if (!market || market.status !== 'open') {
        throw new ConflictError('Não é mais possível cancelar: o mercado já fechou.');
      }
      if (market.closes_at && new Date(market.closes_at) <= new Date()) {
        throw new ConflictError('Não é mais possível cancelar: o prazo já acabou.');
      }

      await wagerRepository.updateStatus(wagerId, 'refunded', client);

      const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
      const balanceBefore = wallet.balance;
      const updated = await walletRepository.adjustBalance(wallet.id, Number(wager.amount), client);
      await walletRepository.recordTransaction({
        walletId: wallet.id,
        type: 'refund',
        amount: wager.amount,
        balanceBefore,
        balanceAfter: updated.balance,
        relatedEntity: 'wager',
        relatedId: wager.id,
        description: `Cancelamento da aposta #${wager.id}`,
      }, client);

      return { marketId: wager.market_id, amount: Number(wager.amount), question: market.question };
    });

    // Emitido só depois do commit (D-01): um rollback nunca deve deixar um
    // evento "fantasma" sem linha correspondente no banco.
    domainEvents.emit('wager.cancelled', {
      wagerId,
      userId,
      marketId: result.marketId,
      question: result.question,
      amount: result.amount,
    });

    logger.info(`Usuário ${userId} cancelou a aposta #${wagerId}`);
    return { ok: true };
  }

  async getMyWagers(userId) {
    return wagerRepository.findByUserId(userId);
  }

  async getWagersByUsername(username) {
    const user = await userRepository.findByUsername(username);
    if (!user) throw new NotFoundError('Usuário não encontrado.');
    return wagerRepository.findByUsername(username);
  }
}

module.exports = new WagerService();
