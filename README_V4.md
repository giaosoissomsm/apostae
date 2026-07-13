# ApostaE v4.0 🎟️

**Plataforma de apostas com odds | Production-Ready**

Mercado de apostas Sim/Não entre amigos com gerenciamento de créditos, autenticação segura, interface moderna e escalabilidade corporativa.

---

## ✨ Destaques v4.0

- 🚀 **PostgreSQL + Redis**: Banco de dados robusto + cache/sessions
- 🏗️ **Arquitetura em Camadas**: Controllers, Services, Repositories (clean code)
- 🔒 **Security-First**: Prepared statements, rate limiting, auditoria completa
- 📊 **Admin Dashboard**: Gerenciamento de usuários com paginação, busca, filtros
- 💰 **Wallet System**: Rastreamento de créditos com transações
- ⚡ **Performance**: Índices PostgreSQL, cache Redis, queries otimizadas
- 📱 **Responsive**: Interface mobile-friendly
- 📝 **Bem Documentado**: Guias de migração, segurança, arquitetura

---

## 🚀 Quick Start

### Pré-requisitos
```bash
Node.js 18+
PostgreSQL 12+
Redis 6+
```

### Instalação
```bash
git clone <repo>
cd apostae
npm install
cp .env.example .env
# Editar .env com credenciais
```

### Iniciar
```bash
npm run migrate   # Executa migrations
npm start         # Inicia servidor
```

Acesse: **http://localhost:3000**

---

## 📚 Documentação

| Documento | Conteúdo |
|-----------|----------|
| [MIGRATION_GUIDE_V4.md](./MIGRATION_GUIDE_V4.md) | Passo-a-passo de migração do v3.0 |
| [REFACTOR_V4_SUMMARY.md](./REFACTOR_V4_SUMMARY.md) | Mudanças arquiteturais e estrutura |
| [SECURITY.md](./SECURITY.md) | Especificações de segurança |
| [CHANGELOG.md](./CHANGELOG.md) | Histórico de versões |

---

## 🔐 Segurança

✅ **Autenticação**: JWT + Redis Sessions  
✅ **Autorização**: Roles-based access control (RBAC)  
✅ **Senhas**: Bcrypt 10 rounds  
✅ **Banco**: Prepared statements, constraints, triggers  
✅ **Rate Limiting**: 5 tentativas de login por 15 min  
✅ **Auditoria**: Todas as ações registradas  
✅ **Proteção**: IDOR, SQL Injection, CSRF  

---

## 📊 Arquitetura

```
Frontend (HTML/CSS/JS) → Express.js → Controllers
                              ↓
                          Services (Lógica)
                              ↓
                          Repositories (Data Access)
                              ↓
                    PostgreSQL (Persistência)
                    Redis (Cache/Sessions)
```

---

## 🎯 Funcionalidades Principais

### Usuários
- Registro e login
- Mudança de senha (obrigatória ou voluntária)
- Perfil pessoal
- Histórico de ações

### Admin
- Listagem de usuários (paginação, busca, filtros)
- Alterar status (ativo/inativo)
- Alterar role (admin/user)
- Deletar usuário (soft delete)
- Forçar mudança de senha
- Ver logs de auditoria

### Mercados & Apostas
- Criar mercados com odds customizadas
- Agendamento automático (close/reveal)
- Colocar apostas
- Cancelar apostas (se ainda abertas)
- Resolver mercados automaticamente
- Histórico de apostas

### Carteira
- Saldo de créditos
- Histórico de transações
- Movimentações auditadas
- Integração com apostas

---

## 🛠️ Desenvolvimento

### Estrutura de Pastas
```
src/
├── config/       → Ambiente, DB, Redis
├── controllers/  → Rotas HTTP
├── services/     → Lógica de negócio
├── repositories/ → Acesso ao banco
├── middleware/   → Auth, erros, rate limit
├── migrations/   → Versionamento do BD
├── routes/       → Definição de rotas
└── utils/        → Logger, erros, validators
```

### Scripts Úteis
```bash
npm start          # Inicia servidor
npm run migrate    # Executa migrations
npm run seed       # Importa dados antigos
npm run dev        # Dev com nodemon
```

---

## 📊 Comparação de Versões

| | v3.0 | v4.0 |
|---|------|------|
| Banco | SQLite | PostgreSQL |
| Cache | Memória | Redis |
| Arquitectura | Monolítica | Camadas |
| Usuários | Sem filtros | Paginação + Filtros |
| Performance | Limitada | Escalável |
| Produção | Parcial | Pronta |

---

## 🔄 Migração do v3.0

Veja [MIGRATION_GUIDE_V4.md](./MIGRATION_GUIDE_V4.md) para:
- Backup de dados
- Instalação de dependências
- Configuração do PostgreSQL
- Execução de migrations
- Importação de dados
- Testes de validação

---

## 🐛 Troubleshooting

### PostgreSQL não conecta
```bash
# Verificar se está rodando
psql -U postgres -c "SELECT 1;"

# Iniciar (macOS)
brew services start postgresql

# Iniciar (Linux)
sudo systemctl start postgresql
```

### Redis connection refused
```bash
# Verificar se está rodando
redis-cli ping

# Iniciar (macOS)
brew services start redis

# Iniciar (Linux)
sudo systemctl start redis-server
```

### Migrações falhando
```bash
# Ver logs de erro
npm run migrate 2>&1 | tee migration.log

# Fazer rollback
npm run migrate rollback

# Verificar tabela de migrations
psql -U apostae_user -d apostae -c "SELECT * FROM schema_migrations;"
```

---

## 📝 Licença

Projeto educacional.

---

## 🤝 Contribuições

Pull requests são bem-vindas! Para mudanças grandes, abra uma issue primeiro.

---

## 📧 Suporte

Dúvidas? Abra uma issue ou check a documentação completa.

---

**ApostaE v4.0 - Pronto para escalar! 🚀**
