(function () {
  const user = requireAdminPage();
  if (!user) return;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  // Converte o valor de um <input type="datetime-local"> (hora local do navegador)
  // pra um ISO string UTC, que é o que o backend espera de forma inequívoca -
  // assim não importa em que fuso o servidor está rodando.
  function localToIso(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  // Backend manda timestamps como ISO-8601 (Date -> JSON via Express), ex: "2026-08-01T02:59:00.000Z".
  function parseServerDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function fmtDateTime(value) {
    const d = parseServerDate(value);
    if (!d) return '—';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  async function refreshCredits() {
    const me = await Api.get('/users/me');
    document.getElementById('creditsAmount').textContent = fmtCredits(me.credits);
  }

  // ---------- Mercados ----------
  const MIN_OPTIONS = 2;
  const MAX_OPTIONS = 20; // Convite apenas - o limite real é sempre validado no servidor (MARKET-05).

  const marketTypeSelect = document.getElementById('mMarketType');
  const fieldsetBinary = document.getElementById('fieldsetBinary');
  const fieldsetOverUnder = document.getElementById('fieldsetOverUnder');
  const fieldsetMultipleChoice = document.getElementById('fieldsetMultipleChoice');
  const optionsList = document.getElementById('optionsList');
  const addOptionBtn = document.getElementById('addOptionBtn');

  function createOptionRow() {
    const row = document.createElement('div');
    row.className = 'option-row';
    row.innerHTML = `
      <input type="text" class="option-label" placeholder="Ex: Time A" />
      <input type="number" class="option-odds" placeholder="Odd" step="0.01" min="1.01" />
      <button type="button" class="btn-ghost remove-option" aria-label="Remover opção">×</button>
    `;
    return row;
  }

  function updateOptionRowControls() {
    const rows = optionsList.querySelectorAll('.option-row');
    const atFloor = rows.length <= MIN_OPTIONS;
    rows.forEach((row) => {
      row.querySelector('.remove-option').disabled = atFloor;
    });
    addOptionBtn.disabled = rows.length >= MAX_OPTIONS;
  }

  function seedOptionRows(count) {
    optionsList.innerHTML = '';
    for (let i = 0; i < count; i += 1) optionsList.appendChild(createOptionRow());
    updateOptionRowControls();
  }

  addOptionBtn.addEventListener('click', () => {
    const rows = optionsList.querySelectorAll('.option-row');
    if (rows.length >= MAX_OPTIONS) return;
    optionsList.appendChild(createOptionRow());
    updateOptionRowControls();
  });

  optionsList.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-option');
    if (!btn) return;
    const rows = optionsList.querySelectorAll('.option-row');
    if (rows.length <= MIN_OPTIONS) return;
    btn.closest('.option-row').remove();
    updateOptionRowControls();
  });

  function toggleMarketTypeFieldsets() {
    const type = marketTypeSelect.value;
    fieldsetBinary.style.display = type === 'binary' ? 'contents' : 'none';
    fieldsetOverUnder.style.display = type === 'over_under' ? 'contents' : 'none';
    fieldsetMultipleChoice.style.display = type === 'multiple_choice' ? 'contents' : 'none';
    if (type === 'multiple_choice' && optionsList.children.length === 0) {
      seedOptionRows(MIN_OPTIONS);
    }
  }

  marketTypeSelect.addEventListener('change', toggleMarketTypeFieldsets);
  toggleMarketTypeFieldsets();

  document.getElementById('newMarketForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const marketType = marketTypeSelect.value;
    const question = document.getElementById('mQuestion').value.trim();
    const description = document.getElementById('mDescription').value.trim();
    const closesAt = localToIso(document.getElementById('mClosesAt').value);
    const revealAt = localToIso(document.getElementById('mRevealAt').value);
    const scheduledOutcome = document.getElementById('mScheduledOutcome').value || null;

    let body;

    if (marketType === 'over_under') {
      const threshold = Number(document.getElementById('mThreshold').value);
      const oddsOver = Number(document.getElementById('mOddsOver').value);
      const oddsUnder = Number(document.getElementById('mOddsUnder').value);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        showToast('Informe um limite (threshold) válido maior que zero.', 'error');
        return;
      }
      if (!Number.isFinite(oddsOver) || oddsOver < 1.01 || oddsOver > 1000 ||
          !Number.isFinite(oddsUnder) || oddsUnder < 1.01 || oddsUnder > 1000) {
        showToast('As odds precisam estar entre 1.01 e 1000.', 'error');
        return;
      }
      body = {
        question, description,
        market_type: 'over_under',
        threshold,
        odds_over: oddsOver,
        odds_under: oddsUnder,
        closes_at: closesAt,
        reveal_at: revealAt,
        scheduled_outcome: scheduledOutcome,
      };
    } else if (marketType === 'multiple_choice') {
      const rows = Array.from(optionsList.querySelectorAll('.option-row'));
      if (rows.length < MIN_OPTIONS) {
        showToast('Adicione pelo menos 2 opções.', 'error');
        return;
      }
      if (rows.length > MAX_OPTIONS) {
        showToast('Máximo de 20 opções por mercado.', 'error');
        return;
      }
      const options = [];
      for (const row of rows) {
        const label = row.querySelector('.option-label').value.trim();
        const odds = Number(row.querySelector('.option-odds').value);
        if (!label || !Number.isFinite(odds) || odds < 1.01 || odds > 1000) {
          showToast('Preenche o rótulo e a odd de todas as opções.', 'error');
          return;
        }
        options.push({ label, odds });
      }
      body = {
        question, description,
        market_type: 'multiple_choice',
        options,
        closes_at: closesAt,
        reveal_at: revealAt,
        scheduled_outcome: scheduledOutcome,
      };
    } else {
      body = {
        question, description,
        odds_yes: Number(document.getElementById('mOddsYes').value),
        odds_no: Number(document.getElementById('mOddsNo').value),
        closes_at: closesAt,
        reveal_at: revealAt,
        scheduled_outcome: scheduledOutcome,
      };
    }

    try {
      await Api.post('/markets', body);
      showToast('Mercado criado!', 'success');
      e.target.reset();
      document.getElementById('mOddsYes').value = '2.00';
      document.getElementById('mOddsNo').value = '1.80';
      optionsList.innerHTML = '';
      toggleMarketTypeFieldsets();
      loadMarkets();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  function statusLabel(status) {
    if (status === 'open') return 'Aberto';
    if (status === 'closed') return 'Fechado';
    return 'Resolvido';
  }

  function typeLabel(marketType) {
    if (marketType === 'over_under') return 'Over/Under';
    if (marketType === 'multiple_choice') return 'Múltipla escolha';
    return 'Binário';
  }

  // m.market_type ausente é tratado como binary (compat com linhas antigas) - MARKET-03.
  function oddsCell(m) {
    if (m.market_type === 'over_under') {
      const opts = Array.isArray(m.options) ? m.options : [];
      const over = opts.find((o) => /^over\b/i.test(o.label));
      const under = opts.find((o) => /^under\b/i.test(o.label));
      const oddsOver = over ? Number(over.odds).toFixed(2) : '—';
      const oddsUnder = under ? Number(under.odds).toFixed(2) : '—';
      return `Over ${m.threshold}: ${oddsOver}x / Under ${m.threshold}: ${oddsUnder}x`;
    }
    if (m.market_type === 'multiple_choice') {
      const opts = Array.isArray(m.options) ? m.options : [];
      return opts.map((o) => `${escapeHtml(o.label)} ${Number(o.odds).toFixed(2)}x`).join(', ');
    }
    return `${m.odds_yes.toFixed(2)}x / ${m.odds_no.toFixed(2)}x`;
  }

  function resultLabel(m) {
    if (m.market_type === 'over_under' || m.market_type === 'multiple_choice') {
      if (m.winning_option_id == null) return '—';
      const opts = Array.isArray(m.options) ? m.options : [];
      const winner = opts.find((o) => o.id === m.winning_option_id);
      return winner ? escapeHtml(winner.label) : '—';
    }
    return m.outcome ? (m.outcome === 'yes' ? 'Sim' : 'Não') : '—';
  }

  function actionsCell(m) {
    const closeBtn = m.status === 'open' ? `<button class="btn-ghost" data-close="${m.id}">Fechar</button>` : '';
    const deleteBtn = `<button class="btn-ghost" data-delete-market="${m.id}" style="color: var(--nao); border-color: var(--nao-dim);">Deletar</button>`;

    if (m.market_type === 'over_under' || m.market_type === 'multiple_choice') {
      const opts = Array.isArray(m.options) ? m.options : [];
      const resolveControl = m.status !== 'resolved' ? `
        <select class="resolve-select" data-resolve-select="${m.id}">
          ${opts.map((o) => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('')}
        </select>
        <button class="btn-ghost" data-resolve-multi="${m.id}">Resolver</button>
      ` : '';
      return `${closeBtn}${resolveControl}${deleteBtn}`;
    }

    const resolveBtns = m.status !== 'resolved' ? `
      <button class="btn-ghost" data-resolve="${m.id}" data-outcome="yes">Resolver: Sim</button>
      <button class="btn-ghost" data-resolve="${m.id}" data-outcome="no">Resolver: Não</button>
    ` : '';
    return `${closeBtn}${resolveBtns}${deleteBtn}`;
  }

  async function loadMarkets() {
    const markets = await Api.get('/markets');
    const body = document.getElementById('marketsBody');

    if (markets.length === 0) {
      body.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">Nenhum mercado criado ainda.</td></tr>`;
      return;
    }

    body.innerHTML = markets.map((m) => {
      const agenda = [
        m.closes_at ? `Fecha: ${fmtDateTime(m.closes_at)}` : null,
        m.reveal_at ? `Revela: ${fmtDateTime(m.reveal_at)}` : null,
        m.scheduled_outcome ? `(pré-definido: ${m.scheduled_outcome === 'yes' ? 'Sim' : 'Não'})` : null,
      ].filter(Boolean).join('<br/>') || '—';

      return `
      <tr>
        <td>${escapeHtml(m.question)}</td>
        <td><span class="tag">${typeLabel(m.market_type)}</span></td>
        <td class="mono">${oddsCell(m)}</td>
        <td>${statusLabel(m.status)}</td>
        <td style="font-size:12px; color:var(--text-muted);">${agenda}</td>
        <td>${resultLabel(m)}</td>
        <td>
          <div class="inline-form">
            ${actionsCell(m)}
          </div>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await Api.put(`/markets/${btn.dataset.close}/status`, { status: 'closed' });
          showToast('Mercado fechado.', 'success');
          loadMarkets();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-resolve]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await Api.put(`/markets/${btn.dataset.resolve}/resolve`, { outcome: btn.dataset.outcome });
          showToast('Mercado resolvido.', 'success');
          loadMarkets();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-resolve-multi]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const marketId = btn.dataset.resolveMulti;
        const select = body.querySelector(`[data-resolve-select="${marketId}"]`);
        const winningOptionId = Number(select && select.value);
        if (!select || !Number.isFinite(winningOptionId)) {
          showToast('Selecione uma opção vencedora.', 'error');
          return;
        }
        try {
          await Api.put(`/markets/${marketId}/resolve`, { winning_option_id: winningOptionId });
          showToast('Mercado resolvido.', 'success');
          loadMarkets();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-delete-market]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Tem certeza?')) return;
        try {
          await Api.delete(`/markets/${btn.dataset.deleteMarket}`);
          showToast('Mercado deletado.', 'success');
          loadMarkets();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
  }

  // ---------- Usuários ----------
  document.getElementById('newUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      username: document.getElementById('uUsername').value.trim(),
      email: document.getElementById('uEmail').value.trim() || null,
      password: document.getElementById('uPassword').value,
      is_admin: document.getElementById('uIsAdmin').checked,
    };
    try {
      await Api.post('/users', body);
      showToast('Usuário criado!', 'success');
      e.target.reset();
      loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  async function loadUsers() {
    try {
      console.log('📋 loadUsers() iniciado...');
      console.log('👤 Usuário atual:', user);
      
      const response = await Api.get('/users');
      console.log('✓ Resposta recebida:', response);
      console.log('  Tipo:', Array.isArray(response) ? 'array' : typeof response);
      
      // Backend retorna ARRAY DIRETO: [...]
      // NÃO objeto {users: [...]}
      let users;
      
      if (Array.isArray(response)) {
        console.log('✓ É array direto');
        users = response;
      } else if (response?.users && Array.isArray(response.users)) {
        console.log('✓ É objeto com .users');
        users = response.users;
      } else {
        console.error('❌ Estrutura inválida:', response);
        document.getElementById('usersBody').innerHTML = 
          `<tr><td colspan="6" style="text-align:center; color:var(--nao); padding:24px;">
            ⚠️ Erro: Estrutura inválida
          </td></tr>`;
        return;
      }

      console.log(`✓ ${users.length} usuários carregados`);
      
      if (users.length === 0) {
        document.getElementById('usersBody').innerHTML = 
          `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px;">
            Nenhum usuário encontrado.
          </td></tr>`;
        return;
      }

      const body = document.getElementById('usersBody');
      
      // Renderizar usuários
      body.innerHTML = users.map((u) => {
        const isSelf = u.id === user.id;
        
        // Determinar se é admin
        const isAdmin = u.is_admin === true || u.role_name === 'admin' || u.role_id === 2;
        const roleDisplay = isAdmin ? 'Admin' : 'User';
        
        console.log(`  ${u.username}: admin=${isAdmin}, active=${u.is_active}`);
        
        return `
        <tr>
          <td><strong>${escapeHtml(u.username)}</strong>${isSelf ? ' <span style="color:var(--text-muted); font-size:11px;">(você)</span>' : ''}</td>
          <td>${escapeHtml(u.email || '—')}</td>
          <td><span class="tag ${isAdmin ? 'admin' : ''}">${roleDisplay}</span></td>
          <td><span class="tag" style="${u.is_active ? 'color:var(--sim); border-color:var(--sim-dim);' : 'color:var(--nao); border-color:var(--nao-dim);'}">${u.is_active ? '✓ Ativo' : '✗ Inativo'}</span></td>
          <td>
            <div class="inline-form">
              ${!isSelf ? `
                <button class="btn-ghost" data-changepassword="${u.id}" style="font-size:12px;">Senha</button>
                <button class="btn-ghost" data-forcepasswordchange="${u.id}" style="font-size:12px;">${u.password_expires_next_login ? 'Desfazer' : 'Forçar pwd'}</button>
                <button class="btn-ghost" data-togglerole="${u.id}" data-current="${isAdmin ? 1 : 0}">${isAdmin ? 'Remover admin' : 'Tornar admin'}</button>
                <button class="btn-ghost" data-togglestatus="${u.id}" data-current="${u.is_active ? 1 : 0}">${u.is_active ? 'Desativar' : 'Ativar'}</button>
                <button class="btn-ghost" data-delete="${u.id}" style="color: var(--nao); border-color: var(--nao-dim);">Deletar</button>
              ` : '<span style="color:var(--text-muted); font-size:12px;">—</span>'}
            </div>
          </td>
        </tr>`;
      }).join('');

      console.log('✓ Tabela renderizada');
      
      // Setup event listeners
      setupUserButtonListeners(body, users);
      console.log('✓ Event listeners configurados');
      
    } catch (err) {
      console.error('❌ Erro:', err);
      document.getElementById('usersBody').innerHTML = 
        `<tr><td colspan="6" style="text-align:center; color:var(--nao); padding:24px;">
          ❌ ${escapeHtml(err.message)}
        </td></tr>`;
    }
  }

  function setupUserButtonListeners(body, users) {
    body.querySelectorAll('[data-changepassword]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.changepassword;
        const newPassword = prompt('Digite a nova senha (mín. 6 caracteres):');
        if (!newPassword || newPassword.length < 6) {
          if (newPassword === null) return;
          showToast('Senha precisa ter ao menos 6 caracteres.', 'error');
          return;
        }
        if (!confirm('Tem certeza? Sessão do usuário será invalidada.')) return;
        
        try {
          await Api.put(`/auth/password/admin/${userId}`, { password: newPassword });
          showToast('Senha alterada com sucesso!', 'success');
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    body.querySelectorAll('[data-forcepasswordchange]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.forcepasswordchange;
        const userData = users.find(u => u.id == userId);
        const shouldForce = !userData.password_expires_next_login;
        
        if (shouldForce && !confirm('Forçar esse usuário a mudar senha no próximo login?')) return;
        
        try {
          await Api.put(`/auth/force-password-change/${userId}`, { enabled: shouldForce });
          showToast(shouldForce ? 'Mudança de senha forçada!' : 'Força de mudança removida.', 'success');
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    body.querySelectorAll('[data-togglerole]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.togglerole;
        const currentIsAdmin = btn.dataset.current === '1';
        const newRole = currentIsAdmin ? 'user' : 'admin';
        
        if (!confirm(`${currentIsAdmin ? 'Remover' : 'Tornar'} admin dessa pessoa?`)) return;
        
        try {
          await Api.put(`/users/${userId}/role`, { 
            role_id: newRole === 'admin' ? 2 : 1,
            role_name: newRole 
          });
          showToast('Permissão alterada!', 'success');
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    body.querySelectorAll('[data-togglestatus]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.togglestatus;
        const activate = btn.dataset.current === '0';
        
        if (!activate && !confirm('Desativar essa conta? Pessoa não conseguirá logar.')) return;
        
        try {
          await Api.put(`/users/${userId}/status`, { is_active: activate });
          showToast(activate ? 'Usuário reativado!' : 'Usuário desativado!', 'success');
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    body.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.delete;
        const userData = users.find(u => u.id == userId);
        
        if (!confirm(`⚠️  Tem CERTEZA que quer deletar ${escapeHtml(userData.username)}? Isso é PERMANENTE!`)) return;
        
        try {
          await Api.delete(`/users/${userId}`);
          showToast('Usuário deletado!', 'success');
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  // Carregar dados iniciais
  loadMarkets();
  loadUsers();
})();
