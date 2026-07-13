(function () {
  const user = requireLogin();
  if (!user) return;

  if (user.is_admin) document.getElementById('adminLink').style.display = '';
  document.getElementById('whoami').textContent = `@${user.username}${user.is_admin ? ' · admin' : ''}`;

  async function refreshCredits() {
    try {
      const me = await Api.get('/users/me');
      document.getElementById('creditsAmount').textContent = fmtCredits(me.credits);
    } catch (_) {}
  }
  refreshCredits();

  const form = document.getElementById('pwForm');
  const msgBox = document.getElementById('msgBox');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgBox.innerHTML = '';

    const current_password = document.getElementById('currentPassword').value;
    const new_password = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;

    if (new_password !== confirm) {
      msgBox.innerHTML = `<div class="error-msg">As senhas novas não conferem.</div>`;
      return;
    }

    try {
      // Sempre troca a senha do PRÓPRIO usuário (req.user.id no backend) - não existe
      // como mandar um id de outra pessoa aqui, a rota nem aceita esse parâmetro.
      await Api.put('/users/me/password', { current_password, new_password });
      msgBox.innerHTML = `<div class="ok-msg">Senha atualizada com sucesso!</div>`;
      form.reset();
    } catch (err) {
      msgBox.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  });
})();
