(function () {
  const user = requireLogin();
  if (!user) return;

  if (user.is_admin) document.getElementById('adminLink').style.display = '';

  const selections = {}; // marketId -> 'yes' | 'no'
  let marketFilter = 'open'; // aberto, fechado, resolvido
  let marketsCache = [];

  // ---------- Tabs ----------
  const tabs = document.querySelectorAll('.tab-link');
  tabs.forEach((t) => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      document.querySelectorAll('main > section').forEach((s) => (s.style.display = 'none'));
      document.getElementById(`tab-${t.dataset.tab}`).style.display = '';
      if (t.dataset.tab === 'mine') loadMyWagers();
      if (t.dataset.tab === 'ranking') loadRanking();
    });
  });

  // ---------- Filtros de mercado ----------
  document.querySelectorAll('.market-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.market-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      marketFilter = btn.dataset.filter;
      renderMarkets();
    });
  });

  async function refreshCredits() {
    try {
      const me = await Api.get('/users/me');
      document.getElementById('creditsAmount').textContent = fmtCredits(me.credits);
      const stored = Api.getUser();
      Api.setSession(Api.getToken(), { ...stored, credits: me.credits });
    } catch (_) {}
  }

  function statusLabel(status) {
    if (status === 'open') return 'Aberto';
    if (status === 'closed') return 'Fechado';
    return 'Resolvido';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Calcula tempo restante até closes_at e formata como "3h 45m"
  function timeUntilClose(closesAt) {
    if (!closesAt) return '∞';
    const d = new Date(closesAt.replace(' ', 'T') + 'Z');
    const now = new Date();
    const ms = d - now;
    if (ms <= 0) return 'Expirado';
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function ticketTemplate(market) {
    const sel = selections[market.id];
    const isOpen = market.status === 'open';

    let resultHtml = '';
    if (market.status === 'resolved') {
      const label = market.outcome === 'yes' ? 'SIM' : 'NÃO';
      resultHtml = `<div class="ticket-result">Resultado final: <strong>${label}</strong></div>`;
    }

    let timerHtml = '';
    if (isOpen && market.closes_at) {
      timerHtml = `<div style="text-align:center; font-family:var(--font-mono); font-size:12px; color:var(--nao); margin-top:8px; padding-top:8px; border-top:1px solid var(--line);">⏱️ ${timeUntilClose(market.closes_at)}</div>`;
    }

    return `
      <div class="ticket" data-id="${market.id}">
        <div class="ticket-top">
          <span class="ticket-status ${market.status}">${statusLabel(market.status)}</span>
          <h3 class="ticket-question">${escapeHtml(market.question)}</h3>
          ${market.description ? `<p class="ticket-desc">${escapeHtml(market.description)}</p>` : ''}
        </div>
        <div class="ticket-perforation"></div>
        <div class="ticket-bottom">
          <div class="odds-row">
            <button class="odd-btn sim ${sel === 'yes' ? 'selected' : ''}" data-choice="yes" ${!isOpen ? 'disabled' : ''}>
              <span class="label">Sim</span>
              <span class="value">${market.odds_yes.toFixed(2)}x</span>
            </button>
            <button class="odd-btn nao ${sel === 'no' ? 'selected' : ''}" data-choice="no" ${!isOpen ? 'disabled' : ''}>
              <span class="label">Não</span>
              <span class="value">${market.odds_no.toFixed(2)}x</span>
            </button>
          </div>
          ${isOpen ? `
          <div class="wager-form">
            <input type="number" min="1" step="1" placeholder="Fichas" class="wager-amount" ${!sel ? 'disabled' : ''} />
            <button class="btn-primary wager-submit" ${!sel ? 'disabled' : ''}>Apostar</button>
          </div>` : ''}
          ${timerHtml}
        </div>
        ${resultHtml}
      </div>`;
  }

  async function loadMarkets() {
    marketsCache = await Api.get('/markets');
    renderMarkets();
  }

  function renderMarkets() {
    const filtered = marketsCache.filter((m) => m.status === marketFilter);
    const grid = document.getElementById('marketsGrid');

    if (filtered.length === 0) {
      const msgs = {
        open: 'Nenhum mercado aberto agora.',
        closed: 'Nenhum mercado fechado.',
        resolved: 'Nenhum mercado resolvido ainda.',
      };
      grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><div class="big">${msgs[marketFilter]}</div></div>`;
      return;
    }

    grid.innerHTML = filtered.map(ticketTemplate).join('');

    grid.querySelectorAll('.odd-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const ticket = btn.closest('.ticket');
        const marketId = Number(ticket.dataset.id);
        selections[marketId] = btn.dataset.choice;
        renderMarkets();
      });
    });

    grid.querySelectorAll('.wager-submit').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ticket = btn.closest('.ticket');
        const marketId = Number(ticket.dataset.id);
        const amountInput = ticket.querySelector('.wager-amount');
        const amount = Number(amountInput.value);
        const choice = selections[marketId];

        if (!choice) return showToast('Escolhe Sim ou Não primeiro.', 'error');
        if (!amount || amount <= 0) return showToast('Coloca um valor válido.', 'error');

        btn.disabled = true;
        try {
          await Api.post('/wagers', { market_id: marketId, choice, amount });
          showToast('Aposta registrada!', 'success');
          delete selections[marketId];
          await refreshCredits();
          await loadMarkets();
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  }

  async function loadMyWagers() {
    const wagers = await Api.get('/users/me/wagers');
    const body = document.getElementById('myWagersBody');
    if (wagers.length === 0) {
      body.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted); text-align:center; padding:30px;">Você ainda não apostou em nada.</td></tr>`;
      return;
    }
    body.innerHTML = wagers.map((w) => `
      <tr>
        <td>${escapeHtml(w.question)}</td>
        <td>${w.choice === 'yes' ? 'Sim' : 'Não'}</td>
        <td class="mono">${fmtCredits(w.amount)}</td>
        <td class="mono">${w.odds_at_time.toFixed(2)}x</td>
        <td class="mono">${fmtCredits(w.potential_payout)}</td>
        <td>${wagerStatusLabel(w.status)}</td>
        <td>${w.status === 'pending' && w.market_status === 'open' ? `<button class="btn-ghost" data-cancel="${w.id}">Cancelar</button>` : ''}</td>
      </tr>
    `).join('');

    body.querySelectorAll('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await Api.del(`/wagers/${btn.dataset.cancel}`);
          showToast('Aposta cancelada, créditos devolvidos.', 'success');
          await refreshCredits();
          await loadMyWagers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  function wagerStatusLabel(status) {
    return { pending: 'Em aberto', won: 'Ganhou 🎉', lost: 'Perdeu', refunded: 'Cancelada' }[status] || status;
  }

  async function loadRanking() {
    const rows = await Api.get('/leaderboard');
    document.getElementById('rankingBody').innerHTML = rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(r.username)}</td>
        <td class="mono">${fmtCredits(r.credits)}</td>
        <td><button class="btn-ghost" data-show-wagers="${r.username}" style="padding:4px 8px; font-size:12px;">Ver apostas</button></td>
      </tr>
    `).join('');

    document.querySelectorAll('[data-show-wagers]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showUserWagers(btn.dataset.showWagers);
      });
    });
  }

  async function showUserWagers(username) {
    try {
      const wagers = await Api.get(`/wagers/user/${username}`);
      const modal = document.getElementById('userWagersModal');
      const title = document.getElementById('modalTitle');
      const container = document.getElementById('userWagersContainer');

      title.textContent = `Apostas de @${username}`;

      if (wagers.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted);">Nenhuma aposta registrada.</p>';
      } else {
        const stats = {
          total: 0,
          won: 0,
          lost: 0,
          ganhos: 0,
          perdas: 0,
        };

        wagers.forEach((w) => {
          stats.total++;
          if (w.status === 'won') {
            stats.won++;
            stats.ganhos += w.potential_payout - w.amount;
          }
          if (w.status === 'lost') {
            stats.lost++;
            stats.perdas += w.amount;
          }
        });

        const statsHtml = `
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--line);">
            <div style="text-align:center;">
              <div style="font-size:20px; font-weight:bold; color:var(--sim);">${stats.won}W</div>
              <div style="font-size:12px; color:var(--text-muted);">Vitórias</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:20px; font-weight:bold; color:var(--nao);">${stats.lost}L</div>
              <div style="font-size:12px; color:var(--text-muted);">Derrotas</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:20px; font-weight:bold; color:var(--gold);">${fmtCredits(stats.ganhos - stats.perdas)}</div>
              <div style="font-size:12px; color:var(--text-muted);">Saldo</div>
            </div>
          </div>
        `;

        const wagersHtml = `
          <div style="font-size:13px;">
            ${wagers.map((w) => {
              const resultClass = w.status === 'won' ? 'sim' : w.status === 'lost' ? 'nao' : '';
              const resultLabel = w.status === 'won' ? '✓ Ganhou' : w.status === 'lost' ? '✗ Perdeu' : w.status === 'pending' ? 'Pendente' : 'Reembolso';
              return `
              <div style="padding:10px; margin-bottom:8px; background:var(--surface-2); border-radius:8px; border-left:3px solid ${w.status === 'won' ? 'var(--sim)' : w.status === 'lost' ? 'var(--nao)' : 'var(--text-muted)'};">
                <div style="font-weight:500; margin-bottom:4px;">${escapeHtml(w.question)}</div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:12px; color:var(--text-muted);">
                  <div>Apostou: <span style="color:var(--text);">${w.choice === 'yes' ? 'Sim' : 'Não'} (${fmtCredits(w.amount)})</span></div>
                  <div>Odd: <span style="color:var(--text);">${w.odds_at_time.toFixed(2)}x</span></div>
                  <div>Retorno: <span style="color:var(--sim);">${fmtCredits(w.potential_payout)}</span></div>
                  <div style="text-align:right; ${w.status === 'won' ? 'color:var(--sim);' : w.status === 'lost' ? 'color:var(--nao);' : ''}">${resultLabel}</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        `;

        container.innerHTML = statsHtml + wagersHtml;
      }

      modal.style.display = 'block';
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  window.closeUserWagersModal = function () {
    document.getElementById('userWagersModal').style.display = 'none';
  };

  refreshCredits();
  loadMarkets();

  // Recarrega os timers a cada 30s
  setInterval(() => {
    if (document.getElementById('tab-markets').style.display !== 'none') {
      renderMarkets();
    }
  }, 30000);
})();
