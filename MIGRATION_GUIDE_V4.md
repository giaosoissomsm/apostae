# ApostaE v4.0 - Guia de Migração

## 🔄 O que mudou

### Antes (v3.0)
- SQLite como banco principal
- Sessões em SQLite
- Cache em memória (SQLite)
- Estrutura monolítica

### Agora (v4.0)
- **PostgreSQL** como banco principal
- **Redis** para sessions, cache e rate limiting
- **Arquitetura em camadas** (Controllers, Services, Repositories)
- **Melhor escalabilidade** e performance
- **Production-ready**

---

## 📋 Pré-requisitos

### Instalar PostgreSQL
```bash
# macOS
brew install postgresql@15

# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib

# Windows
# Baixar em https://www.postgresql.org/download/windows/
```

### Instalar Redis
```bash
# macOS
brew install redis

# Ubuntu/Debian
sudo apt-get install redis-server

# Windows (WSL recomendado)
# wsl sudo apt-get install redis-server
```

### Iniciar serviços
```bash
# PostgreSQL
postgres -D /usr/local/var/postgres
# ou no Ubuntu:
sudo systemctl start postgresql

# Redis
redis-server
# ou no Ubuntu:
sudo systemctl start redis-server
```

### Verificar conectividade
```bash
# PostgreSQL
psql -U postgres -h localhost -d postgres -c "SELECT version();"

# Redis
redis-cli ping
# Resposta: PONG
```

---

## 🚀 Passos de Migração

### 1. Parar a aplicação antiga
```bash
# Se estiver rodando
# Ctrl+C no terminal
```

### 2. Backup dos dados (SQLite)
```bash
# Fazer backup do arquivo de banco de dados
cp data/apostas.db data/apostas.db.backup

# Exportar dados (opcional, para auditoria)
sqlite3 data/apostas.db .dump > backup.sql
```

### 3. Atualizar dependências
```bash
cd /home/claude/apostas-app

# Remover dependências antigas
npm uninstall better-sqlite3

# Instalar novas dependências
npm install

# Verificar instalação
npm list | grep -E "pg|redis"
```

### 4. Configurar variáveis de ambiente
```bash
# Copiar template
cp .env.example .env

# Editar com suas credenciais
nano .env
```

Conteúdo mínimo do `.env`:
```env
NODE_ENV=production
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=apostae
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui

REDIS_URL=redis://localhost:6379

JWT_SECRET=gere-uma-chave-segura-aqui
```

### 5. Gerar JWT_SECRET seguro
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copie a saída e coloque no `.env`:
```env
JWT_SECRET=sua_chave_gerada_acima
```

### 6. Criar banco PostgreSQL
```bash
# Conectar ao PostgreSQL como admin
psql -U postgres

# No prompt psql:
CREATE DATABASE apostae;
CREATE USER apostae_user WITH PASSWORD 'senha_segura';
ALTER ROLE apostae_user SET client_encoding TO 'utf8';
ALTER ROLE apostae_user SET default_transaction_isolation TO 'read committed';
GRANT ALL PRIVILEGES ON DATABASE apostae TO apostae_user;

# Sair
\q
```

### 7. Executar migrações
```bash
# Migrar schema do PostgreSQL
npm run migrate

# Saída esperada:
# ✓ 001_initial executada
# ✓ 002_wallet executada
# ✓ Todas as migrações executadas com sucesso!
```

### 8. Migrar dados (se houver usuários antigos)
```bash
# Script de importação (vem com a versão)
npm run seed

# Isso vai:
# - Importar usuários de apostas.db
# - Manter hashes de senha
# - Criar carteiras iniciais
# - Registrar na auditoria
```

### 9. Iniciar aplicação nova
```bash
npm start

# Saída esperada:
# 🚀 Iniciando ApostaE...
# 📊 Conectando ao PostgreSQL...
# ✓ PostgreSQL conectado
# 🔴 Conectando ao Redis...
# ✓ Redis conectado
# 🔄 Executando migrações...
# ✓ Nenhuma migração pendente
# ⚙️ Inicializando dados padrão...
# ✓ Dados padrão criados
# ✅ ApostaE rodando em http://localhost:3000
```

### 10. Testar fluxos principais
```bash
# Abrir em navegador
http://localhost:3000

# Testes:
1. Registrar novo usuário
2. Fazer login
3. Criar mercado (admin)
4. Fazer aposta
5. Ir para /admin (verificar usuários listam corretamente)
6. Buscar usuários (paginação, filtros)
7. Alterar senha
```

---

## 🔒 Segurança Pós-Migração

### 1. Validar banco de dados
```bash
psql -U apostae_user -h localhost -d apostae -c "
  SELECT COUNT(*) as user_count FROM users;
  SELECT COUNT(*) as market_count FROM markets;
  SELECT COUNT(*) as wager_count FROM wagers;
  SELECT COUNT(*) as wallet_count FROM wallets;
"
```

### 2. Verificar integridade de senhas
```bash
# Nenhuma senha deve estar em texto puro
SELECT COUNT(*) FROM users WHERE password_hash LIKE 'não_%'
# Resultado esperado: 0 (zero)
```

### 3. Validar índices
```bash
# Verificar que índices foram criados
SELECT indexname FROM pg_indexes WHERE tablename = 'users';
```

### 4. Monitorar Redis
```bash
redis-cli
> INFO memory
> DBSIZE
```

---

## 📊 Estrutura Nova (PostgreSQL)

```
PostgreSQL
├── users (id, username, email, password_hash, role_id)
├── roles (id, name)
├── permissions (id, name)
├── role_permissions (role_id, permission_id)
├── markets (id, question, odds_yes, odds_no, status, outcome, created_by)
├── wagers (id, user_id, market_id, choice, amount, status)
├── wallets (id, user_id, balance)
├── wallet_transactions (id, wallet_id, type, amount, description)
├── sessions (id, user_id, ip_address, created_at, expires_at)
├── audit_logs (id, action, admin_id, target_user_id, details)
└── settings (id, key, value)

Redis
├── session:* (sessões de usuário)
├── cache:* (dados em cache)
├── ratelimit:* (contadores de rate limit)
└── temp:* (dados temporários)
```

---

## 🐛 Troubleshooting

### "ECONNREFUSED: PostgreSQL não está respondendo"
```bash
# Verificar se está rodando
psql -U postgres -c "SELECT 1;"

# Se não funcionar, iniciar:
# macOS: brew services start postgresql
# Linux: sudo systemctl start postgresql
```

### "Redis connection refused"
```bash
# Verificar se Redis está rodando
redis-cli ping

# Se não funcionar, iniciar:
# macOS: brew services start redis
# Linux: sudo systemctl start redis-server
```

### "Migrações não rodam"
```bash
# Verificar tabela de migrações
psql -U apostae_user -d apostae -c "SELECT * FROM schema_migrations;"

# Fazer rollback de última migração (dev only!)
npm run migrate rollback
```

### "Usuários antigos não aparecem"
```bash
# Verificar importação
psql -U apostae_user -d apostae -c "SELECT COUNT(*) FROM users;"

# Se vazio, executar seed manual:
npm run seed
```

---

## 🎯 Validação Final

Checklist antes de considerar migração concluída:

- [ ] PostgreSQL conectando
- [ ] Redis conectando
- [ ] Migrações executadas (001, 002)
- [ ] Roles e permissões criadas
- [ ] Usuários antigos importados (se houver)
- [ ] Carteiras criadas para todos
- [ ] Senhas em hash
- [ ] Índices existem
- [ ] Login funciona
- [ ] Admin panel funciona
- [ ] Listagem de usuários com paginação
- [ ] Rate limiting ativo
- [ ] Sessões em Redis
- [ ] Logs de auditoria sendo registrados

---

## 📚 Documentação

Veja também:
- `README.md` - Overview da aplicação
- `SECURITY.md` - Especificações de segurança
- `.env.example` - Variáveis de ambiente

---

## ⚠️ Rollback de Emergência

Se algo der muito errado:

```bash
# Parar aplicação
# Ctrl+C

# Restaurar banco antigo
rm data/apostas.db
cp data/apostas.db.backup data/apostas.db

# Voltar para v3.0
git checkout v3.0  # se usar git

# Reinstalar dependências antigas
npm install better-sqlite3

# Reiniciar
npm start
```

---

**Migração concluída com sucesso!** 🎉

Aproveite a nova arquitetura escalável de ApostaE v4.0!
