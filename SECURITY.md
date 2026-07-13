# Segurança - Gerenciamento de Senhas e Sessões

## 🔐 Gerenciamento de Senhas por Administrador

### Funcionalidades

#### 1. Alterar Senha de Qualquer Usuário (Admin)
- **Endpoint**: `PUT /api/users/:id/password`
- **Requer**: Autenticação + Privilégio de Admin
- **O que faz**:
  - Admin define nova senha pra qualquer usuário
  - Não exige a senha atual do usuário
  - Invalida TODAS as sessões do usuário (força novo login)
  - Registra em auditoria com IP do admin e timestamp

#### 2. Forçar Alteração de Senha no Próximo Login
- **Endpoint**: `PUT /api/users/:id/password-expires`
- **Requer**: Autenticação + Privilégio de Admin
- **O que faz**:
  - Marca usuário com `password_expires_next_login = 1`
  - Usuário vê página de alteração obrigatória (`/password-expires.html`) no próximo login
  - Usuário fica bloqueado do resto do sistema até mudar
  - Quando muda: flag é removida + todas as outras sessões são invalidadas

#### 3. Alteração Obrigatória (User Side)
- **Endpoint**: `POST /api/auth/change-password-required`
- **O que faz**:
  - Usuário com `password_expires_next_login = 1` é bloqueado de tudo EXCETO essa rota
  - Middleware `requireAuth` detecta a flag e retorna 403 pra qualquer outra rota
  - Após mudança: flag é removida, todas as outras sessões são invalidadas, sessão atual também expira
  - Usuário é forçado a fazer login novamente com nova senha

### Fluxo Administrativo de Mudança de Senha

```
Admin clica "Mudar senha" em usuário
    ↓
Admin insere nova senha
    ↓
Servidor: PUT /api/users/:id/password
    ↓
Backend valida admin + target_id
    ↓
Gera hash bcrypt da nova senha (10 rounds)
    ↓
Invalida TODAS as sessões do usuário
    ↓
Registra auditoria: admin_id, target_user_id, ip_address, timestamp
    ↓
Retorna sucesso
    ↓
Usuário recebe "Você foi desconectado, senha foi alterada"
    ↓
Usuário faz login com nova senha
```

### Fluxo Forçado de Mudança no Login

```
Admin clica "Forçar mudança no próximo login"
    ↓
Servidor: PUT /api/users/:id/password-expires { enabled: true }
    ↓
Flag password_expires_next_login é setada
    ↓
Registra auditoria
    ↓
[Usuário faz login]
    ↓
Middleware `requireAuth` detecta flag
    ↓
Redireciona pra /password-expires.html
    ↓
Usuário vê página de alteração obrigatória
    ↓
Tenta qualquer outra rota → recebe 403 password_expires_next_login
    ↓
Usuário preenche nova senha
    ↓
Servidor: POST /auth/change-password-required
    ↓
Remove flag + invalida outras sessões + expira sessão atual
    ↓
Redireciona pra /login.html
    ↓
Usuário faz login novamente (força validação da nova senha)
```

### Auditoria de Mudanças

Toda alteração de senha feita por admin é registrada em `audit_logs`:

```sql
INSERT INTO audit_logs (action, admin_id, target_user_id, ip_address, details, created_at)
VALUES (
  'admin_change_password',
  123,           -- admin_id
  456,           -- target_user_id
  '192.168.1.1', -- ip_address
  'Administrador alterou a senha do usuário.',
  datetime('now')
);
```

**Nunca registra**: senhas antigas ou novas (NUNCA!), apenas a ação e metadados.

### Controle de Acesso (Validação Backend)

```javascript
// Middleware requireAuth + requireAdmin em TODAS as rotas de admin
router.put('/:id/password', requireAuth, requireAdmin, (req, res) => {
  // 1. Valida token JWT (sessionId)
  // 2. Valida sessionId na tabela sessions (não expirada, não invalidada)
  // 3. Lê is_admin DIRETAMENTE DO BANCO (nunca do token)
  // 4. Se não é admin → 403 Forbidden
  // 5. Prossegue com alteração
});
```

**Não confia em**:
- `is_admin` enviado no body/query/headers
- Qualquer field de role/permission do cliente
- Estado de privilégio do JWT (sempre relê do banco)

---

## ⏱️ Timeout de Sessão por Inatividade

### Conceito

Um usuário logado é automaticamente desconectado após **30 minutos de inatividade**, além de um máximo absoluto de **8 horas por sessão**.

### Arquitetura

#### Camada Backend (Fonte da Verdade)

**Tabela `sessions`**:
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                -- UUID da sessão
  user_id INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT datetime('now'),
  last_activity_at TEXT,              -- Atualizado a cada requisição
  expires_at TEXT NOT NULL,           -- Máximo absoluto (8h)
  invalidated_at TEXT                 -- Quando foi logout/expirado
);
```

**Serviço `sessionService.js`**:
- `createSession(userId, ip, userAgent)` - gera novo sessionId único
- `validateSession(sessionId)` - confere:
  1. Session existe?
  2. Não foi invalidada?
  3. Não expirou por inatividade (30 min)?
  4. Não atingiu timeout absoluto (8h)?
- `updateActivity(sessionId)` - atualiza `last_activity_at` em cada requisição válida
- `invalidateSession(sessionId)` - marca como "desconectado"
- `cleanupExpiredSessions()` - remove sessões expiradas (rodado a cada 1h)

#### Fluxo de Request

```
[1] Frontend faz requisição com Authorization: Bearer <token>
                ↓
[2] Middleware requireAuth
                ↓
    ├─ Extrai sessionId do JWT
    ├─ Chama validateSession(sessionId)
    │  ├─ Confere se session.last_activity_at > agora - 30 min
    │  ├─ Confere se session.expires_at > agora
    │  └─ Retorna null se expirada/invalidada
    │
    └─ Se válida:
       ├─ updateActivity(sessionId) → SET last_activity_at = agora
       └─ Prossegue pra rota
                ↓
[3] Se inválida:
       └─ 401 Unauthorized: "Sessão expirada por inatividade"
```

### Logout Manual

**Endpoint**: `POST /api/auth/logout`

```javascript
// Frontend
await Api.post('/auth/logout');  // Invalida sessão no backend
Api.clearSession();               // Limpa localStorage
location.href = '/login.html';   // Redireciona
```

**Backend**:
```javascript
router.post('/logout', requireAuth, (req, res) => {
  invalidateSession(req.sessionId);
  // session.invalidated_at = agora
  res.json({ ok: true });
});
```

Agora ninguém consegue usar esse sessionId, mesmo que o JWT ainda seja válido.

### Detecção de Inatividade (Frontend)

**Arquivo**: `public/js/session-timeout.js`

- **Monitora eventos**: mousedown, keydown, scroll, touchstart, click
- **A cada atividade**: reseta timer de inatividade
- **Timeout**: 25 min (alerta 5 min antes da sessão real expirar)
- **Alerta visual**: popup aparece, usuário pode clicar "Manter ativa"
- **Se não responder**: logout automático após 30 min
- **Backup via API**: a cada 1 min checa `/sessions/current` pra detectar timeout pelo backend

### Timers e Constantes

```javascript
// backend/services/sessionService.js
SESSION_TIMEOUT_MINUTES = 30;        // Inatividade
SESSION_ABSOLUTE_TIMEOUT_MINUTES = 480;  // 8h máximo

// frontend/js/session-timeout.js
INACTIVITY_WARNING_MS = 25 * 60 * 1000;  // Alerta 5 min antes
// Auto-logout após 30 min (25 min de aviso + 5 min pra responder)
```

### Cenários

#### Cenário 1: Usuário Ativo
```
[10:00] Usuário login
[10:05] Clica botão → updateActivity() → last_activity_at = 10:05
[10:07] Digita mensagem → updateActivity() → last_activity_at = 10:07
...cada atividade reseta o timer...
[10:33] Nenhuma atividade por 26 min
        ↓
        Popup: "Sessão vai expirar em 5 min"
[10:35] Usuário clica "Manter ativa"
        ↓
        POST /sessions/keep-alive → updateActivity()
        ↓
        Sessão renovada, timer reseta
```

#### Cenário 2: Usuário Inativo
```
[10:00] Usuário login
[10:05] Faz uma requisição (último evento)
[10:35] 30 min de inatividade
        ↓
        last_activity_at = 10:05
        agora = 10:35
        (10:35 - 10:05) > 30 min → EXPIRADA
        ↓
[10:36] Usuário clica em algo
        ↓
        Frontend tenta qualquer requisição
        ↓
        Backend: validateSession()
        → "30 min de inatividade" → 401
        ↓
        Frontend redireciona pra /login.html
        ↓
        "Sua sessão expirou. Faça login novamente."
```

#### Cenário 3: Admin Altera Senha
```
[10:00] Admin: PUT /users/789/password
        ↓
        Backend:
        ├─ invalidateAllUserSessions(789)
        │  └─ UPDATE sessions SET invalidated_at = agora
        │     WHERE user_id = 789
        └─ Registra auditoria
        ↓
[10:01] Usuário 789 faz requisição
        ↓
        validateSession():
        └─ "session.invalidated_at IS NOT NULL" → INVÁLIDA
        ↓
        401 "Sessão invalidada"
        ↓
        Frontend logout automático
        ↓
        Redireciona pra /login.html
```

---

## 🛡️ Princípios de Segurança Implementados

### 1. **Nunca Confiar no Frontend**
- ✅ `is_admin` sempre lido do banco, nunca do JWT
- ✅ `password_expires_next_login` sempre lido do banco
- ✅ Validade de sessão sempre checada no backend
- ✅ Nenhum campo de permissão aceito do body/query

### 2. **Senhas Nunca em Texto Puro**
- ✅ Hash bcrypt com 10 rounds (`bcryptjs`)
- ✅ Nunca armazenadas em logs
- ✅ Nunca retornadas em responses
- ✅ Comparação com `bcrypt.compareSync()`

### 3. **Invalidação Imediata**
- ✅ Admin altera senha → todas as sessões do user invalidadas NA HORA
- ✅ User altera senha → outras sessões invalidadas, current session expira logo depois
- ✅ User é desativado → bloqueado na próxima requisição

### 4. **Backend é Fonte da Verdade**
- ✅ Timeout de sessão validado no backend SEMPRE
- ✅ JavaScript do navegador é apenas hint (não é autoridade)
- ✅ Mesmo que localStorage tiver token, backend confere validade
- ✅ Não é possível "burlar" timeout mudando relógio do PC

### 5. **Auditoria Completa**
- ✅ Toda mudança de senha registrada
- ✅ Admin, alvo, IP, timestamp
- ✅ Nunca registra senhas antigas ou novas
- ✅ Queryable por usuário ou admin

### 6. **Proteção contra IDOR/Escalação**
- ✅ Admin não consegue alterar sua própria senha via rota de admin (use /users/me/password)
- ✅ Admin não consegue se desativar
- ✅ Admin não consegue se rebaixar
- ✅ Sempre valida `targetId !== req.user.id` nos endpoints perigosos

---

## 🔄 Fluxo Completo: Gerenciador de Senhas

### Página Admin

```html
<!-- Seção: Gerenciamento de Senhas -->
[Buscar usuário: ________]  [Alterar]
                ↓
├─ Clica "Ver apostas" → Modal com histórico
├─ Clica "Mudar senha" → Prompt pra nova senha
├─ Clica "Forçar mudança" → Flag ativada
├─ Clica "Ativar/Desativar" → Status alterado
├─ Clica "Remover admin" → Rebaixa privilégio
└─ Clica "Excluir" → Deleta permanentemente
```

### Logs de Auditoria

```
GET /api/audit-logs?limit=100&offset=0

[
  {
    "id": 42,
    "action": "admin_change_password",
    "admin_id": 1,
    "target_user_id": 3,
    "ip_address": "192.168.1.50",
    "details": "Administrador alterou a senha do usuário.",
    "created_at": "2026-07-13 14:23:45"
  },
  {
    "id": 41,
    "action": "admin_force_password_change",
    "admin_id": 1,
    "target_user_id": 5,
    "ip_address": "192.168.1.50",
    "details": "Forçou mudança de senha no próximo login.",
    "created_at": "2026-07-13 14:15:20"
  }
]
```

---

## 📋 Checklist de Segurança

- [x] Apenas admin consegue alterar senha de outro
- [x] Backend valida SEMPRE
- [x] Senhas armazenadas com hash bcrypt
- [x] Senhas nunca em logs
- [x] Sessão validada em cada request
- [x] Timeout de inatividade funciona
- [x] Frontend detecta timeout (hint, não autoridade)
- [x] Backend é fonte da verdade
- [x] Logout invalida sessão
- [x] Admin alterando senha invalida todas as sessões do user
- [x] Auditoria registra tudo (sem senhas)
- [x] Proteção contra IDOR
- [x] Proteção contra escalação de privilégio
- [x] Rate limiting básico (sem implementação de limiter externo, mas estrutura pronta)

---

## ⚙️ Configuração

### Variáveis de Ambiente

```env
JWT_SECRET=<segredo-longo-aleatorio>
PORT=3000
```

### Constantes (em `services/sessionService.js`)

```javascript
SESSION_TIMEOUT_MINUTES = 30;        // Minutos de inatividade
SESSION_ABSOLUTE_TIMEOUT_MINUTES = 480;  // 8 horas máximo
```

Modifique conforme necessário (ex: 15 min inatividade, 4h máximo).

---

## 🚀 Próximas Melhorias (Sugestões)

- [ ] Rate limiting na alteração de senha (ex: max 3 tentativas a cada 5 min)
- [ ] Notificação por email quando admin altera senha
- [ ] Two-factor authentication (2FA)
- [ ] Histórico de hash de senhas (impedir reutilização de últimas 5 senhas)
- [ ] Alertas em tempo real quando sessão é terminada
- [ ] Dashboard de sessões ativas do usuário (ver onde está logado)
