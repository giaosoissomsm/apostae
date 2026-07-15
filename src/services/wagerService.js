const { transaction } = require('../config/database');
const wagerRepository = require('../repositories/wagerRepository');
const walletRepository = require('../repositories/walletRepository');
const userRepository = require('../repositories/userRepository');
const marketRepository = require('../repositories/marketRepository');
const marketOptionRepository = require('../repositories/marketOptionRepository');
const cashoutRepository = require('../repositories/cashoutRepository');
const money = require('../utils/money');
const env = require('../config/env');
const domainEvents = require('../events/domainEvents');
const { ValidationError, NotFoundError, ConflictError } = require('../utils/errors');
const logger = require('../utils/logger');

class WagerService {
  // O dono da aposta é sempre o userId do token - nunca é lido do body.
  // choice (binary) e option_id (over_under/multiple_choice) são mutuamente
  // exclusivos — qual dos dois é válido depende do market_type carregado
  // dentro da transação, nunca decidido antes de travar o mercado.
  async placeWager(userId, { market_id, choice, amount, option_id }) {
    const marketId = Number(market_id);
    const wagerAmount = Number(amount);

    if (!Number.isFinite(marketId)) throw new ValidationError('market_id inválido.');
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

      // Odds sempre derivada server-side (T-03-15) — o cliente nunca informa
      // odds/potential_payout diretamente. binary preserva o comportamento
      // de hoje (choice 'yes'/'no' -> odds_yes/odds_no). Pra over_under e
      // multiple_choice, option_id precisa pertencer a ESTE mercado — o
      // lookup abaixo é o chokepoint IDOR-safe (MARKET-06/T-03-14): id é
      // sempre pareado com market_id na mesma query travada, nunca um lookup
      // solto por id. Uma option_id de outro mercado retorna null aqui e
      // nunca chega perto de virar uma aposta válida.
      let odds;
      let chosenOptionId = null;
      if (market.market_type === 'binary') {
        if (choice !== 'yes' && choice !== 'no') throw new ValidationError("choice precisa ser 'yes' ou 'no'.");
        odds = choice === 'yes' ? Number(market.odds_yes) : Number(market.odds_no);
      } else {
        const optionId = Number(option_id);
        if (!Number.isFinite(optionId)) throw new ValidationError('option_id inválido.');
        const option = await marketOptionRepository.findByIdForMarket(optionId, market.id, client);
        if (!option) throw new ValidationError('Opção inválida para esse mercado.');
        odds = Number(option.odds);
        chosenOptionId = optionId;
      }

      // money.multiply substitui o antigo cálculo via arredondamento manual
      // em ponto flutuante puro (o próprio anti-padrão citado no header de
      // money.js) — mesmo resultado numérico pra binary, decimal-safe pros
      // novos tipos.
      const potentialPayout = money.multiply(wagerAmount, odds);

      const createdWager = await wagerRepository.create(
        { userId, marketId, choice, optionId: chosenOptionId, amount: wagerAmount, oddsAtTime: odds, potentialPayout },
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

  // Cancela a PRÓPRIA aposta (só se o mercado ainda estiver aberto). Posse
  // embutida no WHERE da query de lock (IDOR-safe — ver findByIdForUpdate).
  // Ordem de lock fixa: mercado -> aposta -> carteira (igual
  // placeWager/cashoutWager/resolveMarket/deleteMarket — Fase 4 fecha o
  // último caminho que ainda travava na ordem oposta, ver 04-RESEARCH.md
  // Pitfall 2). Bloqueio TOTAL se qualquer cashout já ocorreu — não é mais
  // um netting parcial (CANCEL-06, decisão do dono do projeto em STATE.md).
  async cancelWager(wagerId, userId) {
    const result = await transaction(async (client) => {
      // Peek não travado — só pra descobrir qual mercado travar. market_id
      // nunca muda numa aposta existente, então isso não é um risco de TOCTOU.
      const peek = await client.query('SELECT market_id FROM wagers WHERE id = $1;', [wagerId]);
      if (!peek.rows[0]) throw new NotFoundError('Aposta não encontrada.');

      // ORDEM DE LOCK: mercado PRIMEIRO (igual placeWager/cashoutWager/resolveMarket/deleteMarket).
      const market = await marketRepository.findByIdForUpdate(peek.rows[0].market_id, client);
      if (!market || market.status !== 'open') {
        throw new ConflictError('Não é mais possível cancelar: o mercado já fechou.');
      }
      if (market.closes_at && new Date(market.closes_at) <= new Date()) {
        throw new ConflictError('Não é mais possível cancelar: o prazo já acabou.');
      }

      // ORDEM DE LOCK: aposta SEGUNDA. Posse + mercado embutidos no WHERE
      // (IDOR-safe — ver findByIdForUpdate). Retorna null tanto pra aposta
      // inexistente quanto pra aposta de outro usuário: sempre 404, nunca
      // 403 (não vaza existência pra quem não é dono).
      const wager = await wagerRepository.findByIdForUpdate(wagerId, market.id, userId, client);
      if (!wager) throw new NotFoundError('Aposta não encontrada.');
      if (wager.status !== 'pending') throw new ConflictError('Essa aposta não pode mais ser cancelada.');

      // CANCEL-06: bloqueio TOTAL se qualquer cashout já ocorreu — checado
      // ANTES de qualquer cálculo de reembolso/taxa. Substitui o antigo
      // comportamento (CR-02) que apenas nettava cashed_out_amount fora do
      // reembolso sem bloquear; a Fase 4 fecha isso outright, por decisão
      // explícita do dono do projeto (não há mais cancelamento parcial
      // pós-cashout nesta milestone).
      if (Number(wager.cashed_out_amount) > 0) {
        throw new ConflictError('Não é possível cancelar: essa aposta já teve um cashout realizado.');
      }

      // CANCEL-03: fórmula defensiva — dado o bloqueio acima, remainingStake
      // sempre é igual a wager.amount na prática, mas mantemos a mesma
      // fórmula usada em resolveMarket/deleteMarket como proteção caso o
      // bloqueio seja relaxado numa milestone futura.
      const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);
      const { fee, net } = money.applyFeePercent(remainingStake, env.CANCEL_FEE_PERCENT);

      await wagerRepository.updateStatus(wagerId, 'refunded', client); // reutiliza status existente -> UI já exibe "Cancelada"

      // ORDEM DE LOCK: carteira TERCEIRA.
      const wallet = await walletRepository.findByUserIdForUpdate(userId, client);
      const balanceBefore = wallet.balance;
      const updated = await walletRepository.adjustBalance(wallet.id, net, client);
      await walletRepository.recordTransaction({
        walletId: wallet.id,
        type: 'refund',
        amount: net,
        balanceBefore,
        balanceAfter: updated.balance,
        relatedEntity: 'wager',
        relatedId: wager.id,
        description: `Cancelamento da aposta #${wager.id} (taxa de ${env.CANCEL_FEE_PERCENT}% = R$${fee.toFixed(2)}, reembolso líquido R$${net.toFixed(2)} sobre R$${remainingStake.toFixed(2)})`,
      }, client);

      return { marketId: market.id, question: market.question, grossAmount: remainingStake, feeAmount: fee, netAmount: net };
    });

    // Emitido só depois do commit (D-01): um rollback nunca deve deixar um
    // evento "fantasma" sem linha correspondente no banco.
    domainEvents.emit('wager.cancelled', {
      wagerId,
      userId,
      marketId: result.marketId,
      question: result.question,
      amount: result.netAmount, // preserva a semântica já existente de evt.amount lida por notificationService.js
      grossAmount: result.grossAmount,
      feeAmount: result.feeAmount,
    });

    logger.info(`Usuário ${userId} cancelou a aposta #${wagerId} (taxa: R$${result.feeAmount.toFixed(2)})`);
    return { ok: true, refunded: result.netAmount, fee: result.feeAmount };
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
