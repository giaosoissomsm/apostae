const { transaction } = require('../config/database');
const wagerRepository = require('../repositories/wagerRepository');
const walletRepository = require('../repositories/walletRepository');
const userRepository = require('../repositories/userRepository');
const marketRepository = require('../repositories/marketRepository');
const cashoutRepository = require('../repositories/cashoutRepository');
const money = require('../utils/money');
const env = require('../config/env');
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

      // Reembolsa só a fração AINDA presa na aposta (amount - cashed_out_amount)
      // — um cashout parcial prévio já devolveu parte do valor ao usuário, então
      // reembolsar o wager.amount integral aqui seria um pagamento duplicado
      // sobre a mesma stake (mesma classe de bug de RESEARCH.md Pitfall 2,
      // já corrigida em resolveMarket — ver 02-REVIEW.md CR-02). Quando
      // cashed_out_amount = 0 (padrão), remainingStake é idêntico ao
      // wager.amount original (garantia de regressão).
      const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);

      const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
      const balanceBefore = wallet.balance;
      const updated = await walletRepository.adjustBalance(wallet.id, remainingStake, client);
      await walletRepository.recordTransaction({
        walletId: wallet.id,
        type: 'refund',
        amount: remainingStake,
        balanceBefore,
        balanceAfter: updated.balance,
        relatedEntity: 'wager',
        relatedId: wager.id,
        description: `Cancelamento da aposta #${wager.id}`,
      }, client);

      return { marketId: wager.market_id, amount: remainingStake, question: market.question };
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

  // Executa um cashout parcial da PRÓPRIA aposta. Valor sempre calculado no
  // servidor (stake * odds_at_time, menos taxa) — nunca lido do body do
  // cliente. Ordem de lock fixa: mercado -> aposta -> carteira (igual
  // placeWager/resolveMarket/deleteMarket, NUNCA a ordem oposta de
  // cancelWager — ver 02-RESEARCH.md Pitfall 1). Idempotente via
  // UNIQUE(wager_id, idempotency_key): uma retentativa com a mesma chave
  // nunca reaplica o crédito na carteira nem o incremento de
  // cashed_out_amount (CASHOUT-07).
  async cashoutWager(wagerId, userId, { amount, idempotencyKey }) {
    const requestedStake = Number(amount);
    if (!Number.isFinite(requestedStake) || requestedStake <= 0) {
      throw new ValidationError('Valor do cashout precisa ser maior que zero.');
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw new ValidationError('idempotency_key é obrigatório.');
    }
    // wager_cashouts.idempotency_key é VARCHAR(200) — sem esta checagem, uma
    // chave maior estoura a coluna dentro da transação com um erro Postgres
    // 22001 não tratado (errorHandler.js só reconhece códigos que começam
    // com 'P', o que nenhum SQLSTATE real faz), vazando o texto bruto do
    // erro numa resposta 500 em vez do ValidationError operacional que o
    // resto desta validação usa.
    if (idempotencyKey.length > 200) {
      throw new ValidationError('idempotency_key excede o tamanho máximo permitido (200 caracteres).');
    }

    const result = await transaction(async (client) => {
      // Peek não travado — só pra descobrir qual mercado travar. market_id
      // nunca muda numa aposta existente, então isso não é um risco de TOCTOU.
      const peek = await client.query('SELECT market_id FROM wagers WHERE id = $1;', [wagerId]);
      if (!peek.rows[0]) throw new NotFoundError('Aposta não encontrada.');

      // ORDEM DE LOCK: mercado PRIMEIRO (igual placeWager/resolveMarket/deleteMarket).
      const market = await marketRepository.findByIdForUpdate(peek.rows[0].market_id, client);
      if (!market || market.status !== 'open') {
        throw new ConflictError('Cashout indisponível: o mercado não está mais aberto.');
      }

      // ORDEM DE LOCK: aposta SEGUNDA. Posse + mercado embutidos no WHERE
      // (IDOR-safe — ver findByIdForUpdate).
      const wager = await wagerRepository.findByIdForUpdate(wagerId, market.id, userId, client);
      if (!wager) throw new NotFoundError('Aposta não encontrada.');
      if (wager.status !== 'pending') {
        throw new ConflictError('Cashout indisponível: essa aposta já foi resolvida.');
      }

      const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);
      if (requestedStake >= remainingStake) {
        // Nunca deixa o restante chegar a exatamente zero nesta milestone
        // (cashout total é só v2 — CASHOUT-V2-01).
        throw new ValidationError('Valor excede o saldo apostável restante para cashout parcial.');
      }

      const gross = money.multiply(requestedStake, Number(wager.odds_at_time));
      const { fee, net } = money.applyFeePercent(gross, env.CASHOUT_FEE_PERCENT);

      // SAVEPOINT antes do INSERT especulativo: um 23505 (unique-violation em
      // wager_cashouts(wager_id, idempotency_key)) deixa a transação inteira
      // em estado "aborted" no Postgres real até um ROLLBACK explícito — sem
      // um savepoint aqui, o SELECT de replay logo abaixo falharia com 25P02
      // ("current transaction is aborted"), e nunca com o 23505 que este
      // catch espera (ver 02-REVIEW.md CR-01). ROLLBACK TO SAVEPOINT desfaz
      // só o INSERT que falhou, mantendo o resto da transação (locks de
      // mercado/aposta) intacto pra ler o resultado já commitado.
      await client.query('SAVEPOINT cashout_insert');

      let cashout;
      let isReplay = false;
      try {
        cashout = await cashoutRepository.create(
          {
            wagerId,
            userId,
            stakeCashedOut: requestedStake,
            grossValue: gross,
            feeAmount: fee,
            netValue: net,
            idempotencyKey,
          },
          client
        );
      } catch (err) {
        if (err.code === '23505') {
          // Mesma (wager_id, idempotency_key) já commitada antes — devolve o
          // resultado já existente, NÃO reaplica o crédito na carteira nem o
          // incremento de cashed_out_amount.
          await client.query('ROLLBACK TO SAVEPOINT cashout_insert');
          cashout = await cashoutRepository.findByIdempotencyKey(wagerId, idempotencyKey, client);
          isReplay = true;
        } else {
          throw err;
        }
      }

      let remainingStakeAfter;
      if (!isReplay) {
        await wagerRepository.incrementCashedOutAmount(wagerId, requestedStake, client);

        // ORDEM DE LOCK: carteira TERCEIRA.
        const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
        const balanceBefore = wallet.balance;
        const updated = await walletRepository.adjustBalance(wallet.id, Number(cashout.net_value), client);
        await walletRepository.recordTransaction(
          {
            walletId: wallet.id,
            type: 'credit',
            amount: Number(cashout.net_value),
            balanceBefore,
            balanceAfter: updated.balance,
            relatedEntity: 'cashout',
            relatedId: cashout.id,
            description: `Cashout parcial da aposta #${wagerId}`,
          },
          client
        );

        remainingStakeAfter = remainingStake - requestedStake;
      } else {
        remainingStakeAfter = Number(wager.amount) - Number(wager.cashed_out_amount);
      }

      return {
        cashout,
        wagerId,
        marketId: market.id,
        userId,
        question: market.question,
        netValue: Number(cashout.net_value),
        grossValue: Number(cashout.gross_value),
        feeAmount: Number(cashout.fee_amount),
        stakeCashedOut: Number(cashout.stake_cashed_out),
        remainingStake: remainingStakeAfter,
      };
    });

    // Emitido só depois do commit (D-01): um rollback nunca deve deixar um
    // evento "fantasma" sem linha correspondente no banco. Também dispara
    // numa reprodução idempotente — o próprio listener (Plan 02-05) é
    // idempotente por relatedId, seguindo a convenção já existente de "emit
    // é best-effort, quem consome trata a deduplicação".
    domainEvents.emit('wager.cashed_out', {
      cashoutId: result.cashout.id,
      wagerId: result.wagerId,
      userId: result.userId,
      marketId: result.marketId,
      question: result.question,
      netValue: result.netValue,
      grossValue: result.grossValue,
      feeAmount: result.feeAmount,
      stakeCashedOut: result.stakeCashedOut,
      remainingStake: result.remainingStake,
    });

    return result;
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
