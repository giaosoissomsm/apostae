/**
 * Gerenciador de timeout de sessão por inatividade.
 *
 * Fonte única de verdade: GET /api/sessions/current, que reflete o TTL real
 * da sessão no Redis (env.SESSION_TIMEOUT no backend). Nada aqui deve
 * hardcodar a duração do timeout — se precisar mudar o tempo de inatividade,
 * mude apenas SESSION_TIMEOUT no .env do servidor.
 */
(() => {
  // Só ativa em páginas logadas
  if (!Api.getToken()) return;
  if (location.pathname === '/login' || location.pathname === '/password-expires') return;

  const POLL_INTERVAL_MS = 15 * 1000; // confere o TTL real no backend a cada 15s
  const KEEP_ALIVE_MIN_INTERVAL_MS = 20 * 1000; // não chama keep-alive mais que isso
  let warningShown = false;
  let lastKeepAliveAt = 0;

  function showInactivityWarning(expiresInSeconds) {
    if (warningShown) return;
    warningShown = true;

    const minutes = Math.max(1, Math.round(expiresInSeconds / 60));
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
        ⏱️ Você está inativo. Sua sessão vai expirar em <strong>${minutes} minuto${minutes > 1 ? 's' : ''}</strong>.
      </div>
      <button id="inactivityKeepAliveBtn"
              style="background:white; color:#ff5c7a; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-weight:500;">
        Manter ativa
      </button>
    `;
    document.body.appendChild(warning);

    document.getElementById('inactivityKeepAliveBtn').addEventListener('click', () => {
      keepAlive(true);
      dismissWarning();
    });
  }

  function dismissWarning() {
    warningShown = false;
    const warning = document.getElementById('inactivityWarning');
    if (warning) warning.remove();
  }

  // Renova a sessão no backend (respeita um intervalo mínimo entre chamadas
  // para não bombardear o servidor a cada clique/tecla).
  function keepAlive(force = false) {
    if (!Api.getToken()) return;
    const now = Date.now();
    if (!force && now - lastKeepAliveAt < KEEP_ALIVE_MIN_INTERVAL_MS) return;
    lastKeepAliveAt = now;
    Api.post('/sessions/keep-alive').catch(() => {
      // Se falhar, o próximo poll de /sessions/current ou qualquer
      // outra chamada autenticada vai detectar a expiração real.
    });
  }

  // Qualquer interação válida do usuário renova o tempo de inatividade.
  const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'submit'];
  activityEvents.forEach((event) => {
    document.addEventListener(event, () => keepAlive(false), { passive: true });
  });

  // Consulta o estado real da sessão no backend. Essa é a única autoridade
  // sobre expiração — se o backend disser que expirou, desloga; se disser
  // que está prestes a expirar, avisa.
  async function checkSession() {
    if (!Api.getToken()) return;
    try {
      const session = await Api.get('/sessions/current');
      if (session.expiresInSeconds <= 0) {
        logout();
        return;
      }
      if (session.isAboutToExpire) {
        showInactivityWarning(session.expiresInSeconds);
      } else {
        dismissWarning();
      }
    } catch (_) {
      // Api.request já trata 401 (limpa sessão e redireciona ao login).
      // Outros erros (rede, 5xx) são ignorados: não deslogar por instabilidade.
    }
  }

  checkSession();
  setInterval(checkSession, POLL_INTERVAL_MS);
})();
