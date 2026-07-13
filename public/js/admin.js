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

  // Converte 'YYYY-MM-DD HH:MM:SS' (UTC, como vem do backend) pra um Date válido.
  function parseServerDate(value) {
    if (!value) return null;
    return new Date(value.replace(' ', 'T') + 'Z');
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
  document.getElementById('newMarketForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      question: document.getElementById('mQuestion').value.trim(),
      description: document.getElementById('mDescription').value.trim(),
      odds_yes: Number(document.getElementById('mOddsYes').value),
      odds_no: Number(document.getElementById('mOddsNo').value),
      closes_at: localToIso(document.getElementById('mClosesAt').value),
      reveal_at: localToIso(document.getElementById('mRevealAt').value),
      scheduled_outcome: document.getElementById('mScheduledOutcome').value || null,
    };
    try {
      await Api.post('/markets', body);
      showToast('Mercado criado!', 'success');
      e.target.reset();
      document.getElementById('mOddsYes').value = '2.00';
      document.getElementById('mOddsNo').value = '1.80';
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

  async function loadMarkets() {
    const markets = await Api.get('/markets');
    const body = document.getElementById('marketsBody');

    if (markets.length === 0) {
      body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:24px;">Nenhum mercado criado ainda.</td></tr>`;
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
        <td class="mono">${m.odds_yes.toFixed(2)}x / ${m.odds_no.toFixed(2)}x</td>
        <td>${statusLabel(m.status)}</td>
        <td style="font-size:12px; color:var(--text-muted);">${agenda}</td>
        <td>${m.outcome ? (m.outcome === 'yes' ? 'Sim' : 'Não') : '—'}</td>
        <td>
          <div class="inline-form">
            ${m.status === 'open' ? `<button class="btn-ghost" data-close="${m.id}">Fechar</button>` : ''}
            ${m.status !== 'resolved' ? `
              <button class="btn-ghost" data-resolve="${m.id}" data-outcome="yes">Resolver: Sim</button>
              <button class="btn-ghost" data-resolve="${m.id}" data-outcome="no">Resolver: Não</button>
            ` : ''}
            <button class="btn-ghost" data-delete-market="${m.id}" style="color: var(--nao); border-color: var(--nao-dim);">Deletar</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await Api.post(`/markets/${btn.dataset.close}/close`);
          showToast('Mercado fechado.', 'success');
          loadMarkets();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-resolve]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const label = btn.dataset.outcome === 'yes' ? 'SIM' : 'NÃO';
        if (!confirm(`Confirma resolver esse mercado como ${label}? Isso paga quem acertou.`)) return;
        try {
          await Api.post(`/markets/${btn.dataset.resolve}/resolve`, { outcome: btn.dataset.outcome });
          showToast('Mercado resolvido e créditos pagos!', 'success');
          loadMarkets();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-delete-market]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Deletar esse mercado PERMANENTEMENTE? Isso também delete todas as apostas e devolve os créditos.')) return;
        try {
          await Api.del(`/markets/${btn.dataset.deleteMarket}`);
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
      password: document.getElementById('uPassword').value,
      credits: Number(document.getElementById('uCredits').value) || 1000,
      is_admin: document.getElementById('uIsAdmin').checked,
    };
    try {
      await Api.post('/users', body);
      showToast('Usuário criado!', 'success');
      e.target.reset();
      document.getElementById('uCredits').value = 100;
      loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  async function loadUsers() {
    const users = await Api.get('/users');
    const body = document.getElementById('usersBody');
    body.innerHTML = users.map((u) => {
      const isSelf = u.id === user.id;
      return `
      <tr>
        <td>${escapeHtml(u.username)}${isSelf ? ' <span style="color:var(--text-muted); font-size:11px;">(você)</span>' : ''}</td>
        <td class="mono">${fmtCredits(u.credits)}</td>
        <td><span class="tag ${u.is_admin ? 'admin' : ''}">${u.is_admin ? 'Admin' : 'Usuário'}</span></td>
        <td><span class="tag" style="${u.is_active ? '' : 'color: var(--nao); border-color: var(--nao-dim);'}">${u.is_active ? 'Ativo' : 'Desativado'}</span></td>
        <td>
          <div class="inline-form">
            <input type="number" class="credit-input" data-id="${u.id}" placeholder="novo saldo" style="width:110px;" />
            <button class="btn-ghost" data-setcredits="${u.id}">Ajustar</button>
            ${!isSelf ? `
              <button class="btn-ghost" data-viewwagers="${u.id}" style="font-size:12px;">Ver apostas</button>
              <button class="btn-ghost" data-changepassword="${u.id}" style="font-size:12px;">Mudar senha</button>
              <button class="btn-ghost" data-forcepasswordchange="${u.id}" style="font-size:12px;">${u.password_expires_next_login ? 'Desfazer força' : 'Forçar mudança'}</button>
              <button class="btn-ghost" data-toggleadmin="${u.id}" data-current="${u.is_admin ? 1 : 0}">${u.is_admin ? 'Remover admin' : 'Tornar admin'}</button>
              <button class="btn-ghost" data-togglestatus="${u.id}" data-current="${u.is_active ? 1 : 0}">${u.is_active ? 'Desativar' : 'Ativar'}</button>
              <button class="btn-ghost" data-delete="${u.id}" style="color: var(--nao); border-color: var(--nao-dim);">Excluir</button>
            ` : '<span style="color:var(--text-muted); font-size:12px;">—</span>'}
          </div>
        </td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-setcredits]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.setcredits;
        const input = body.querySelector(`.credit-input[data-id="${id}"]`);
        const credits = Number(input.value);
        if (!Number.isFinite(credits) || credits < 0) return showToast('Valor inválido.', 'error');
        try {
          await Api.put(`/users/${id}/credits`, { credits });
          showToast('Créditos atualizados.', 'success');
          loadUsers();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-toggleadmin]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.toggleadmin;
        const makeAdmin = btn.dataset.current === '0';
        try {
          await Api.put(`/users/${id}/admin`, { is_admin: makeAdmin });
          showToast('Permissão atualizada.', 'success');
          loadUsers();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-togglestatus]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.togglestatus;
        const activate = btn.dataset.current === '0';
        if (!activate && !confirm('Desativar essa conta? A pessoa não vai conseguir mais logar até você reativar.')) return;
        try {
          await Api.put(`/users/${id}/status`, { is_active: activate });
          showToast(activate ? 'Usuário reativado.' : 'Usuário desativado.', 'success');
          loadUsers();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('[data-changepassword]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.changepassword;
        const newPassword = prompt('Digite a nova senha pra esse usuário (mín. 6 caracteres):');
        if (!newPassword || newPassword.length < 6) {
          if (newPassword === null) return; // User cancelled
          showToast('Senha precisa ter ao menos 6 caracteres.', 'error');
          return;
        }
        if (!confirm(`Tem certeza? A senha vai ser alterada e o usuário precisará fazer login novamente.`)) return;
        try {
          await Api.put(`/users/${userId}/password`, { password: newPassword });
          showToast('Senha alterada e sessão do usuário invalidada.', 'success');
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    body.querySelectorAll('[data-forcepasswordchange]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.forcepasswordchange;
        const isForcing = btn.textContent.includes('Forçar');
        const msg = isForcing ? 'Força mudança de senha no próximo login?' : 'Remove requisição de mudança de senha?';
        if (!confirm(msg)) return;
        try {
          await Api.put(`/users/${userId}/password-expires`, { enabled: isForcing });
          showToast(isForcing ? 'Usuário será forçado a mudar senha.' : 'Requisição removida.', 'success');
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.viewwagers;
        const username = btn.closest('tr').querySelector('td').textContent;
        try {
          const wagers = await Api.get(`/wagers/user/${username}`);
          showUserWagersAdmin(username, wagers);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    body.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.delete;
        if (!confirm('Excluir essa conta PERMANENTEMENTE? Não dá pra desfazer.')) return;
        try {
          await Api.del(`/users/${id}`);
          showToast('Usuário excluído.', 'success');
          loadUsers();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
  }

  function showUserWagersAdmin(username, wagers) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; overflow-y:auto; padding:20px;';
    modal.innerHTML = `
      <div style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); max-width:700px; margin:40px auto; padding:24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h2 style="margin:0; font-family:var(--font-display); font-size:20px;">Apostas de @${username}</h2>
          <button onclick="this.closest('div').parentElement.remove()" style="background:none; border:none; color:var(--text-muted); font-size:24px; cursor:pointer; padding:0;">×</button>
        </div>
        <div>
          ${wagers.length === 0 ? '<p style="text-align:center; color:var(--text-muted);">Nenhuma aposta.</p>' : `
            <div style="display:grid; gap:8px; max-height:400px; overflow-y:auto;">
              ${wagers.map((w) => `
                <div style="padding:12px; background:var(--surface-2); border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                  <div style="flex:1;">
                    <div style="font-weight:500; margin-bottom:4px;">${escapeHtml(w.question)}</div>
                    <div style="font-size:12px; color:var(--text-muted);">
                      ${w.choice === 'yes' ? 'Sim' : 'Não'} · ${fmtCredits(w.amount)} fichas · ${w.status}
                    </div>
                  </div>
                  <button class="btn-ghost" data-admin-delete-wager="${w.id}" style="color:var(--nao); border-color:var(--nao-dim); padding:4px 8px; font-size:12px;">Deletar</button>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('[data-admin-delete-wager]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Deletar essa aposta?')) return;
        try {
          await Api.post(`/wagers/${btn.dataset.adminDeleteWager}/admin-delete`);
          showToast('Aposta deletada.', 'success');
          modal.remove();
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  // Adicionar espaço pra closures funcionarem
  const _noop = null;

  refreshCredits();
  loadMarkets();
  loadUsers();
})();
