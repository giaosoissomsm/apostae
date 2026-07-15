const { transaction, query } = require('../config/database');
const marketRepository = require('../repositories/marketRepository');
const marketOptionRepository = require('../repositories/marketOptionRepository');
const wagerRepository = require('../repositories/wagerRepository');
const walletRepository = require('../repositories/walletRepository');
const domainEvents = require('../events/domainEvents');
const { ValidationError, NotFoundError, ConflictError } = require('../utils/errors');
const logger = require('../utils/logger');
const money = require('../utils/money');

function isValidOdds(n) {
  return Number.isFinite(n) && n >= 1.01 && n <= 1000;
}

const MARKET_TYPES = ['binary', 'over_under', 'multiple_choice'];
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 20; // Limite servidor (MARKET-05) - independente de qualquer cap no HTML.

// Valida e normaliza o array de opções de um mercado multiple_choice.
// Nunca confia em nada vindo do cliente além do que é checado aqui - conta,
// rótulo, odds e duplicidade são todos revalidados no servidor (MARKET-04),
// mesmo que o formulário admin já aplique os mesmos limites como UX.
function validateOptionsInput(rawOptions) {
  if (!Array.isArray(rawOptions) || rawOptions.length < MIN_OPTIONS || rawOptions.length > MAX_OPTIONS) {
    throw new ValidationError(`Múltipla escolha precisa ter entre ${MIN_OPTIONS} e ${MAX_OPTIONS} opções.`);
  }

  const seenLabels = new Set();
  return rawOptions.map((opt, i) => {
    const label = opt && typeof opt.label === 'string' ? opt.label.trim() : '';
    const odds = Number(opt && opt.odds);

    if (!label) {
      throw new ValidationError('Toda opção precisa de um rótulo não vazio.');
    }
    if (!isValidOdds(odds)) {
      throw new ValidationError('Odds inválidas. Use valores entre 1.01 e 1000.');
    }

    const key = label.toLowerCase();
    if (seenLabels.has(key)) {
      throw new ValidationError('Rótulos de opção duplicados não são permitidos.');
    }
    seenLabels.add(key);

    return { label, odds, sortOrder: i };
  });
}

// Aceita 'YYYY-MM-DD HH:MM:SS' ou ISO com 'T'/'Z' e normaliza pra timestamp UTC
function normalizeDateTime(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseSchedule(body) {
  const { closes_at, reveal_at, scheduled_outcome } = body || {};

  const closesAt = closes_at ? normalizeDateTime(closes_at) : null;
  const revealAt = reveal_at ? normalizeDateTime(reveal_at) : null;
  let scheduledOutcome = null;

  if (closes_at && !closesAt) throw new ValidationError('Data de fechamento inválida.');
  if (reveal_at && !revealAt) throw new ValidationError('Data de revelação inválida.');

  if (scheduled_outcome !== undefined && scheduled_outcome !== null && scheduled_outcome !== '') {
    if (scheduled_outcome !== 'yes' && scheduled_outcome !== 'no') {
      throw new ValidationError("Resultado pré-definido precisa ser 'yes' ou 'no'.");
    }
    scheduledOutcome = scheduled_outcome;
  }

  if (scheduledOutcome && !revealAt) {
    throw new ValidationError('Pra pré-definir um resultado, informe também o horário de revelação.');
  }
  if (closesAt && revealAt && closesAt > revealAt) {
    throw new ValidationError('O horário de revelação precisa ser depois do horário de fechamento.');
  }

  return { closesAt, revealAt, scheduledOutcome };
}

// Nunca expõe o resultado pré-definido pra quem não é admin - vazaria a resposta antes da hora.
function sanitizeMarket(market, isAdmin) {
  if (isAdmin) return market;
  const { scheduled_outcome, ...rest } = market;
  return rest;
}

class MarketService {
  async listMarkets(isAdmin) {
    const markets = await marketRepository.findAll();
    return markets.map((m) => sanitizeMarket(m, isAdmin));
  }

  // Cria um mercado dos 3 tipos suportados. Ramifica em market_type (default
  // 'binary' quando ausente - preserva o contrato implícito de hoje pra
  // qualquer chamador que não envie o campo, MARKET-03). O ramo binary
  // mantém as checagens de question/odds exatamente como antes, sem
  // transaction (um único INSERT já é atômico). Os ramos over_under/
  // multiple_choice gravam o mercado + suas opções numa única transaction
  // (marketRepository.create + marketOptionRepository.createMany), então
  // nunca sobra um mercado sem opções nem opções órfãs em caso de erro.
  async createMarket(body, adminId) {
    const rawType = (body || {}).market_type;
    const marketType = rawType === undefined || rawType === null || rawType === '' ? 'binary' : rawType;

    if (!MARKET_TYPES.includes(marketType)) {
      throw new ValidationError('Tipo de mercado inválido.');
    }

    const { question, description } = body || {};
    if (typeof question !== 'string' || question.trim().length < 4) {
      throw new ValidationError('A pergunta precisa ter ao menos 4 caracteres.');
    }

    const { closesAt, revealAt, scheduledOutcome } = parseSchedule(body);
    // Pitfall 6 (03-RESEARCH.md): novos tipos são resolvidos manualmente
    // pelo admin, nunca via reveal agendado - scheduled_outcome nunca é
    // aceito/gravado fora do ramo binary, mesmo que o body o inclua.
    const finalScheduledOutcome = marketType === 'binary' ? scheduledOutcome : null;

    if (marketType === 'binary') {
      const { odds_yes, odds_no } = body || {};
      if (!isValidOdds(Number(odds_yes)) || !isValidOdds(Number(odds_no))) {
        throw new ValidationError('Odds inválidas. Use valores entre 1.01 e 1000.');
      }

      const market = await marketRepository.create({
        question: question.trim(),
        description: (description || '').toString().trim(),
        oddsYes: Number(odds_yes),
        oddsNo: Number(odds_no),
        marketType: 'binary',
        threshold: null,
        closesAt,
        revealAt,
        scheduledOutcome: finalScheduledOutcome,
        createdBy: adminId,
      });

      logger.info(`Admin ${adminId} criou o mercado #${market.id}`);
      return market;
    }

    let thresholdNum = null;
    let options;

    if (marketType === 'over_under') {
      const { threshold, odds_over, odds_under } = body || {};
      thresholdNum = Number(threshold);
      if (!Number.isFinite(thresholdNum) || thresholdNum <= 0) {
        throw new ValidationError('Limite (threshold) inválido. Informe um número maior que zero.');
      }
      if (!isValidOdds(Number(odds_over)) || !isValidOdds(Number(odds_under))) {
        throw new ValidationError('Odds inválidas. Use valores entre 1.01 e 1000.');
      }

      // Rótulos são derivados server-side do threshold validado, nunca
      // aceitos como texto livre do admin (decisão travada em STATE.md) -
      // só as odds são admin-informadas, como em todo outro tipo de mercado.
      options = [
        { label: `Over ${thresholdNum}`, odds: Number(odds_over), sortOrder: 0 },
        { label: `Under ${thresholdNum}`, odds: Number(odds_under), sortOrder: 1 },
      ];
    } else {
      // multiple_choice
      options = validateOptionsInput((body || {}).options);
    }

    const market = await transaction(async (client) => {
      const createdMarket = await marketRepository.create(
        {
          question: question.trim(),
          description: (description || '').toString().trim(),
          oddsYes: null,
          oddsNo: null,
          marketType,
          threshold: thresholdNum,
          closesAt,
          revealAt,
          scheduledOutcome: finalScheduledOutcome,
          createdBy: adminId,
        },
        client
      );

      const createdOptions = await marketOptionRepository.createMany(createdMarket.id, options, client);
      return { ...createdMarket, options: createdOptions };
    });

    logger.info(`Admin ${adminId} criou o mercado #${market.id} (${marketType}, ${options.length} opções)`);
    return market;
  }

  // Fecha um mercado pra novas apostas (não paga nada ainda). Idempotente.
  async closeMarket(marketId) {
    const market = await marketRepository.findById(marketId);
    if (!market) throw new NotFoundError('Mercado não encontrado.');
    if (market.status !== 'open') return market;

    const closed = await marketRepository.updateStatus(marketId, 'closed');

    // Recipients capturados aqui (pós-escrita), nunca re-consultados depois
    // do emit (Pitfall 4). closeMarket não usa transaction() — a leitura de
    // destinatários acontece depois do UPDATE já ter sido feito.
    const recipientsResult = await query(
      "SELECT DISTINCT user_id FROM wagers WHERE market_id = $1 AND status = 'pending';",
      [marketId]
    );
    const recipients = recipientsResult.rows.map((row) => row.user_id);

    domainEvents.emit('market.closed', { marketId, question: market.question, recipients });

    return closed;
  }

  // Resolve um mercado com o resultado dado, pagando quem apostou certo. Idempotente: erro se já resolvido.
  async resolveMarket(marketId, outcome) {
    if (outcome !== 'yes' && outcome !== 'no') {
      throw new ValidationError("O resultado precisa ser 'yes' ou 'no'.");
    }

    const { resolved, question, wagerOutcomes } = await transaction(async (client) => {
      const marketResult = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [marketId]);
      const market = marketResult.rows[0];
      if (!market) throw new NotFoundError('Mercado não encontrado.');
      if (market.status === 'resolved') throw new ConflictError('Esse mercado já foi resolvido.');

      const resolvedMarket = await marketRepository.resolve(marketId, outcome, client);
      const pendingWagers = await wagerRepository.findPendingByMarket(marketId, client);

      // Coleta os resultados por aposta aqui dentro (dados já lidos na
      // transação) pra emitir depois do commit, sem re-consultar (Pitfall 4).
      const outcomes = [];

      for (const wager of pendingWagers) {
        if (wager.choice === outcome) {
          await wagerRepository.updateStatus(wager.id, 'won', client);

          // Paga apenas a fração restante (pós-cashout) da aposta, nunca o
          // potential_payout integral incondicionalmente — um cashout parcial
          // prévio já devolveu parte do valor ao usuário, então pagar o valor
          // cheio aqui seria um pagamento duplicado sobre a mesma stake
          // (RESEARCH.md Pitfall 2). Quando cashed_out_amount = 0 (padrão),
          // remainingFraction é exatamente 1 e o valor pago é idêntico ao
          // potential_payout original (garantia de regressão).
          const remainingFraction = (Number(wager.amount) - Number(wager.cashed_out_amount)) / Number(wager.amount);
          const remainingPayout = money.multiply(wager.potential_payout, remainingFraction);

          const wallet = await walletRepository.findByUserIdForUpdate(wager.user_id, client);
          const balanceBefore = wallet.balance;
          const updated = await walletRepository.adjustBalance(wallet.id, remainingPayout, client);
          await walletRepository.recordTransaction({
            walletId: wallet.id,
            type: 'credit',
            amount: remainingPayout,
            balanceBefore,
            balanceAfter: updated.balance,
            relatedEntity: 'market_resolved',
            relatedId: market.id,
            description: `Pagamento da aposta #${wager.id} (mercado #${market.id})`,
          }, client);

          outcomes.push({
            wagerId: wager.id,
            userId: wager.user_id,
            won: true,
            amount: Number(wager.amount),
            payout: remainingPayout,
          });
        } else {
          await wagerRepository.updateStatus(wager.id, 'lost', client);
          outcomes.push({ wagerId: wager.id, userId: wager.user_id, won: false, amount: Number(wager.amount) });
        }
      }

      logger.info(`Mercado #${marketId} resolvido como "${outcome}" (${pendingWagers.length} apostas processadas)`);
      return { resolved: resolvedMarket, question: market.question, wagerOutcomes: outcomes };
    });

    // Emitido só depois do commit (D-01): um rollback nunca deve deixar um
    // evento "fantasma" sem linha correspondente no banco.
    const recipients = [...new Set(wagerOutcomes.map((w) => w.userId))];
    domainEvents.emit('market.resolved', { marketId, question, outcome, recipients });

    for (const w of wagerOutcomes) {
      if (w.won) {
        domainEvents.emit('wager.won', {
          wagerId: w.wagerId,
          userId: w.userId,
          marketId,
          question,
          amount: w.amount,
          payout: w.payout,
        });
      } else {
        domainEvents.emit('wager.lost', {
          wagerId: w.wagerId,
          userId: w.userId,
          marketId,
          question,
          amount: w.amount,
        });
      }
    }

    // resolveMarket() continua devolvendo só a linha do mercado pro
    // controller (res.json(market)) — wagerOutcomes/question não vazam.
    return resolved;
  }

  // Deleta um mercado permanentemente, devolvendo créditos de apostas pendentes.
  async deleteMarket(marketId) {
    const { question, refunds } = await transaction(async (client) => {
      const marketResult = await client.query('SELECT * FROM markets WHERE id = $1 FOR UPDATE;', [marketId]);
      const market = marketResult.rows[0];
      if (!market) throw new NotFoundError('Mercado não encontrado.');
      if (market.status === 'resolved') {
        throw new ConflictError('Não é possível deletar um mercado já resolvido.');
      }

      const pendingWagers = await wagerRepository.findPendingByMarket(marketId, client);
      // Coletado aqui (dados já lidos na transação) pra emitir depois do
      // commit, sem re-consultar (Pitfall 4).
      const refundList = [];
      for (const wager of pendingWagers) {
        // Reembolsa só a fração AINDA presa na aposta (amount - cashed_out_amount)
        // — mesma classe de bug de RESEARCH.md Pitfall 2 (já corrigida em
        // resolveMarket, ver 02-REVIEW.md CR-03): um cashout parcial prévio já
        // devolveu parte do valor ao usuário, então reembolsar o wager.amount
        // integral aqui seria um pagamento duplicado sobre a mesma stake.
        // Quando cashed_out_amount = 0 (padrão), remainingStake é idêntico ao
        // wager.amount original (garantia de regressão).
        const remainingStake = Number(wager.amount) - Number(wager.cashed_out_amount);

        const wallet = await walletRepository.findByUserIdForUpdate(wager.user_id, client);
        const balanceBefore = wallet.balance;
        const updated = await walletRepository.adjustBalance(wallet.id, remainingStake, client);
        await walletRepository.recordTransaction({
          walletId: wallet.id,
          type: 'refund',
          amount: remainingStake,
          balanceBefore,
          balanceAfter: updated.balance,
          relatedEntity: 'market_deleted',
          relatedId: market.id,
          description: `Reembolso da aposta #${wager.id} (mercado #${market.id} deletado)`,
        }, client);

        refundList.push({ userId: wager.user_id, wagerId: wager.id, amount: remainingStake });
      }

      // Só remove as apostas pendentes recém-reembolsadas — nunca linhas
      // históricas won/lost/refunded/voided (trilha de auditoria; CR-01).
      await client.query("DELETE FROM wagers WHERE market_id = $1 AND status = 'pending';", [marketId]);
      await marketRepository.delete(marketId, client);

      logger.info(`Mercado #${marketId} deletado (${pendingWagers.length} apostas pendentes reembolsadas)`);
      return { question: market.question, refunds: refundList };
    });

    // Emitido só depois do commit (D-01).
    domainEvents.emit('market.deleted', { marketId, question, refunds });

    return { ok: true, message: 'Mercado deletado.' };
  }
}

module.exports = new MarketService();
