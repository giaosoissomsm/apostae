// Camada única de comunicação com a API. Sempre manda o token no header
// Authorization - é dali que o backend extrai quem é o usuário logado.
const Api = (() => {
  function getToken() {
    return localStorage.getItem('token');
  }

  function getUser() {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  }

  function setSession(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  async function request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, { ...options, headers });
    let data = null;
    try { data = await res.json(); } catch (_) { /* sem corpo */ }

    if (res.status === 401) {
      clearSession();
      if (!location.pathname.endsWith('login.html') && !location.pathname.endsWith('password-expires.html')) {
        location.href = '/login.html';
      }
      throw new Error((data && data.error) || 'Sessão expirada.');
    }

    if (res.status === 403) {
      if (data && data.error === 'password_expires_next_login') {
        location.href = '/password-expires.html';
        throw new Error(data.message || 'Você precisa alterar sua senha.');
      }
    }

    if (!res.ok) {
      throw new Error((data && data.error) || 'Erro inesperado.');
    }
    return data;
  }

  return {
    getToken, getUser, setSession, clearSession,
    get: (path) => request(path, { method: 'GET' }),
    post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) }),
    put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body || {}) }),
    del: (path) => request(path, { method: 'DELETE' }),
  };
})();

function requireLogin() {
  if (!Api.getToken()) {
    location.href = '/login.html';
    return null;
  }
  return Api.getUser();
}

function requireAdminPage() {
  const user = requireLogin();
  if (user && !user.is_admin) {
    location.href = '/index.html';
    return null;
  }
  return user;
}

function showToast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function logout() {
  // Tenta fazer logout no backend (invalidar sessão)
  fetch('/api/auth/logout', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Api.getToken()}`,
      'Content-Type': 'application/json',
    },
  }).catch(() => {
    // Se der erro, ignora (servidor pode estar down)
  }).finally(() => {
    // De qualquer forma, limpa o frontend e redireciona
    Api.clearSession();
    location.href = '/login.html';
  });
}

function fmtCredits(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
