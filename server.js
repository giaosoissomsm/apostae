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
const { generalLimiter } = require('./src/middleware/rateLimiter');
const logger = require('./src/utils/logger');

// Rotas
const authRoutes = require('./src/routes/auth');
const usersRoutes = require('./src/routes/users');

// Script de migrações
const { runPendingMigrations } = require('./scripts/migrate');

// Express app
const app = express();

// ============================================================================
// MIDDLEWARES GLOBAIS
// ============================================================================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Rate limiting geral
app.use(generalLimiter);

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

// ============================================================================
// FRONTEND ESTÁTICO
// ============================================================================

app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html para SPA (client-side routing)
app.get(['/', '/dashboard', '/admin', '/profile'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
    
    if (roleResult.rows[0].count === 0) {
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
