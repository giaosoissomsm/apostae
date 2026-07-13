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
          await Api.put(`/api/auth/password/admin/${userId}`, { password: newPassword });
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
          await Api.put(`/api/auth/force-password-change/${userId}`, { enabled: shouldForce });
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
