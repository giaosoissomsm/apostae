/**
 * Gerenciador de timeout de sessão por inatividade.
 * Detecta inatividade no navegador e alerta o usuário antes da sessão expirar.
 */
(() => {
  // Só ativa em páginas logadas
  if (!Api.getToken()) return;
  if (location.pathname.includes('login.html') || location.pathname.includes('password-expires.html')) return;

  const INACTIVITY_WARNING_MS = 25 * 60 * 1000; // Avisa 5 min antes
  let inactivityTimer = null;
  let warningShown = false;

  function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    warningShown = false;
    
    // Remove warning se estiver visível
    const warning = document.getElementById('inactivityWarning');
    if (warning) warning.remove();

    // Agenda o timeout de inatividade
    inactivityTimer = setTimeout(() => {
      showInactivityWarning();
    }, INACTIVITY_WARNING_MS);
  }

  function showInactivityWarning() {
    if (warningShown) return;
    warningShown = true;

    const warning = document.createElement('div');
    warning.id = 'inactivityWarning';
    warning.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--nao, #ff5c7a);
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-width: 400px;
      text-align: center;
    `;
    warning.innerHTML = `
      <div style="margin-bottom: 12px;">
        ⏱️ Você está inativo. Sua sessão vai expirar em <strong>5 minutos</strong>.
      </div>
      <button onclick="Api.post('/sessions/keep-alive').catch(()=>{}); document.getElementById('inactivityWarning').remove();" 
              style="background:white; color:#ff5c7a; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-weight:500;">
        Manter ativa
      </button>
    `;
    document.body.appendChild(warning);

    // Auto-logout após 5 minutos adicionais
    setTimeout(() => {
      logout();
    }, 5 * 60 * 1000);
  }

  // Eventos de atividade
  const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
  activityEvents.forEach((event) => {
    document.addEventListener(event, resetInactivityTimer, { passive: true });
  });

  // Inicia o timer na primeira visita
  resetInactivityTimer();

  // Check de timeout via API a cada 1 minuto (backup)
  setInterval(async () => {
    if (!Api.getToken()) return;
    try {
      const session = await Api.get('/sessions/current');
      if (session.isAboutToExpire && !warningShown) {
        showInactivityWarning();
      }
    } catch (_) {
      // Erro ao checar sessão = provavelmente expirada
      if (Api.getToken()) {
        logout();
      }
    }
  }, 60 * 1000);
})();
