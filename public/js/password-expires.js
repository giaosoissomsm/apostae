(function () {
  // Se não estiver logado ou não tiver flag de expiração, sai
  const user = Api.getUser();
  const token = Api.getToken();
  if (!user || !token || !user.password_expires_next_login) {
    location.href = '/';
    return;
  }

  const form = document.getElementById('pwForm');
  const msgBox = document.getElementById('msgBox');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgBox.innerHTML = '';

    const new_password = document.getElementById('newPassword').value;
    const confirm_password = document.getElementById('confirmPassword').value;

    if (new_password !== confirm_password) {
      msgBox.innerHTML = `<div class="error-msg">As senhas não conferem.</div>`;
      return;
    }

    if (new_password.length < 6) {
      msgBox.innerHTML = `<div class="error-msg">Senha precisa ter ao menos 6 caracteres.</div>`;
      return;
    }

    try {
      const result = await Api.post('/auth/change-password-required', { new_password });
      msgBox.innerHTML = `<div class="ok-msg">Senha alterada com sucesso! Redirecionando...</div>`;
      
      // Limpa sessão local e redireciona pra login
      setTimeout(() => {
        Api.clearSession();
        location.href = '/login';
      }, 1500);
    } catch (err) {
      msgBox.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });
})();
