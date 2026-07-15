#!/usr/bin/env node

/**
 * ApostaE - Plataforma de Apostas
 * Production-Ready Backend
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const env = require('./src/config/env');
const { pool, query } = require('./src/config/database');
const redis = require('./src/config/redis');
const { errorHandler } = require('./src/middleware/errorHandler');
const logger = require('./src/utils/logger');

// Rotas
const authRoutes = require('./src/routes/auth');
const usersRoutes = require('./src/routes/users');
const marketsRoutes = require('./src/routes/markets');
const wagersRoutes = require('./src/routes/wagers');
const leaderboardRoutes = require('./src/routes/leaderboard');
const sessionsRoutes = require('./src/routes/sessions');
const notificationsRoutes = require('./src/routes/notifications');

// Script de migrações
const { runPendingMigrations } = require('./scripts/migrate');
const { startScheduler } = require('./src/scheduler');

// Express app
const app = express();

// Confia em X-Forwarded-For apenas quando a conexão direta vem do proxy
// reverso interno (rede 172.16.0.0/12) — req.ip resolve pro IP real do
// cliente nesse caso, e pro IP de origem cru em qualquer outro caso.
app.set('trust proxy', '172.16.0.0/12');

// ============================================================================
// MIDDLEWARES GLOBAIS
// ============================================================================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Logging de requisições (dev)
if (env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.debug(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });
}

// ============================================================================
// ROTAS DE SAÚDE
// ============================================================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.get('health-check');
    res.json({
      ok: true,
      uptime: process.uptime(),
      database: 'connected',
      redis: 'connected',
    });
  } catch (err) {
    logger.error('Health check falhou', err.message);
    res.status(503).json({
      ok: false,
      error: 'Sistema não está disponível',
    });
  }
});

// ============================================================================
// ROTAS DA API
// ============================================================================

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/markets', marketsRoutes);
app.use('/api/wagers', wagersRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/notifications', notificationsRoutes);

// ============================================================================
// FRONTEND ESTÁTICO
// ============================================================================

// Mapa de páginas legadas (.html) para suas URLs limpas equivalentes.
const LEGACY_TO_CLEAN = {
  '/index.html': '/',
  '/login.html': '/login',
  '/admin.html': '/admin',
  '/profile.html': '/profile',
  '/password-expires.html': '/password-expires',
};

// Redireciona permanentemente (301) qualquer URL legada terminada em .html
// para sua versão limpa equivalente, preservando a query string verbatim.
// Precisa ficar ANTES do express.static, senão o arquivo estático é servido
// com 200 e o redirect nunca dispara. Fragmentos (#...) são só do navegador
// e nunca chegam ao servidor, então não precisam de tratamento aqui.
app.get(/\.html$/i, (req, res, next) => {
  const target = LEGACY_TO_CLEAN[req.path];
  if (!target) return next();
  const qs = req.originalUrl.slice(req.path.length);
  res.redirect(301, target + qs);
});

// { index: false } pra express.static nunca servir o index.html sozinho em
// '/' — a rota explícita abaixo é a única dona de '/'.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Mapa de URLs limpas para os arquivos estáticos que elas servem.
const CLEAN_TO_FILE = {
  '/': 'index.html',
  '/login': 'login.html',
  '/cadastro': 'login.html', // cadastro é um toggle na própria página de login, sem arquivo próprio
  '/admin': 'admin.html',
  '/profile': 'profile.html',
  '/password-expires': 'password-expires.html',
};

for (const [route, file] of Object.entries(CLEAN_TO_FILE)) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
}

// ============================================================================
// TRATAMENTO DE ERROS
// ============================================================================

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Error handler centralizado (deve ser o último middleware)
app.use(errorHandler);

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

async function bootstrap() {
  try {
    logger.info('🚀 Iniciando ApostaE...');

    // Valida variáveis críticas
    if (!env.JWT_SECRET || env.JWT_SECRET.includes('change-in-production')) {
      throw new Error('JWT_SECRET não configurado corretamente');
    }

    // Conecta ao PostgreSQL
    logger.info('📊 Conectando ao PostgreSQL...');
    const testQuery = await pool.query('SELECT NOW()');
    logger.info(`✓ PostgreSQL conectado (${testQuery.rows[0].now})`);

    // Conecta ao Redis
    logger.info('🔴 Conectando ao Redis...');
    await redis.connect();
    logger.info('✓ Redis conectado');

    // Executa migrações
    logger.info('🔄 Executando migrações...');
    await runPendingMigrations();

    // Inicializa dados padrão (roles, permissões)
    logger.info('⚙️ Inicializando dados padrão...');
    await initializeDefaults();

    // Registra os listeners de notificações ANTES do agendador/qualquer
    // mutação de aposta/mercado, pra nenhuma emissão de evento de domínio
    // ocorrer sem um listener já anexado.
    require('./src/services/notificationService').register();

    // Agendador de mercados (fecha/revela automaticamente por closes_at/reveal_at)
    startScheduler();

    // Inicia servidor HTTP
    const server = app.listen(env.PORT, () => {
      logger.info(`✅ ApostaE rodando em http://localhost:${env.PORT}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
      logger.info(`Database: ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => shutdown(server));
    process.on('SIGINT', () => shutdown(server));
  } catch (err) {
    logger.error('Falha ao iniciar aplicação', err.message);
    process.exit(1);
  }
}

/**
 * Inicializa dados padrão no banco
 */
async function initializeDefaults() {
  try {
    // Verifica se roles já existem
    const roleResult = await query('SELECT COUNT(*) as count FROM roles;');

    if (parseInt(roleResult.rows[0].count, 10) === 0) {
      logger.info('  Criando roles padrão...');
      
      // Insere roles
      await query(
        `INSERT INTO roles (name, description) VALUES
         ($1, $2), ($3, $4)
         ON CONFLICT (name) DO NOTHING;`,
        ['user', 'Usuário comum', 'admin', 'Administrador']
      );

      // Insere permissões padrão
      const permissions = [
        'create_market',
        'edit_market',
        'resolve_market',
        'manage_users',
        'view_audit_logs',
        'change_password',
      ];

      for (const perm of permissions) {
        await query(
          `INSERT INTO permissions (name) VALUES ($1)
           ON CONFLICT (name) DO NOTHING;`,
          [perm]
        );
      }

      // Admin role tem todas as permissões
      const permsResult = await query('SELECT id FROM permissions;');
      const adminRole = await query('SELECT id FROM roles WHERE name = $1;', ['admin']);

      for (const perm of permsResult.rows) {
        await query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING;`,
          [adminRole.rows[0].id, perm.id]
        );
      }

      // User role tem permissões limitadas
      const userRole = await query('SELECT id FROM roles WHERE name = $1;', ['user']);
      const changePwPerm = await query('SELECT id FROM permissions WHERE name = $1;', ['change_password']);

      await query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING;`,
        [userRole.rows[0].id, changePwPerm.rows[0].id]
      );

      logger.info('  ✓ Dados padrão criados');
    }

    // Verifica se admin user já existe
    const adminResult = await query('SELECT id FROM users WHERE username = $1;', ['admin']);
    
    if (adminResult.rows.length === 0) {
      logger.info('  Criando usuário admin...');
      
      const bcrypt = require('bcryptjs');
      const passwordHash = bcrypt.hashSync('admin123', 10);
      
      // Cria usuário admin (role_id 2)
      const userResult = await query(
        `INSERT INTO users (username, email, password_hash, role_id, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id;`,
        ['admin', 'admin@apostae.local', passwordHash, 2, true]
      );

      const adminId = userResult.rows[0].id;

      // Cria carteira do admin
      await query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, $2);',
        [adminId, 1000]
      );

      logger.info('  ✓ Usuário admin criado');
      logger.info('     Username: admin');
      logger.info('     Senha: admin123');
      logger.info('     ⚠️  MUDE A SENHA NA PRIMEIRA OPORTUNIDADE!');
    }
  } catch (err) {
    logger.warn('Erro ao inicializar dados padrão', err.message);
  }
}

/**
 * Shutdown gracioso
 */
async function shutdown(server) {
  logger.info('⏹️  Encerrando aplicação...');

  // Fecha servidor HTTP
  server.close(async () => {
    logger.info('HTTP server encerrado');

    // Fecha pool do PostgreSQL
    try {
      await pool.end();
      logger.info('PostgreSQL desconectado');
    } catch (err) {
      logger.error('Erro ao desconectar PostgreSQL', err.message);
    }

    // Fecha Redis
    try {
      await redis.client.quit();
      logger.info('Redis desconectado');
    } catch (err) {
      logger.error('Erro ao desconectar Redis', err.message);
    }

    logger.info('✓ Aplicação encerrada com sucesso');
    process.exit(0);
  });

  // Force shutdown após 10s
  setTimeout(() => {
    logger.error('Força shutdown - timeout excedido');
    process.exit(1);
  }, 10000);
}

// Inicia aplicação
bootstrap();

module.exports = app;
