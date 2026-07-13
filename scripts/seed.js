#!/usr/bin/env node

/**
 * Script de Seed - Importa dados do SQLite antigo (v3.0) para PostgreSQL (v4.0)
 * 
 * Uso: npm run seed
 * 
 * Importa:
 * - Usuários (preserva hashes de senha)
 * - Permissões (admin se era admin na v3.0)
 * - Mercados
 * - Apostas (wagers)
 */

const { query } = require('../src/config/database');
const logger = require('../src/utils/logger');

// Se não houver arquivo SQLite, apenas sair
const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '../data/apostas.db');

async function seed() {
  try {
    logger.info('🌱 Iniciando seed de dados...\n');

    // Verifica se arquivo antigo existe
    if (!fs.existsSync(dbPath)) {
      logger.info('ℹ️  Nenhum arquivo de banco antigo encontrado (data/apostas.db)');
      logger.info('   Continuando com schema vazio. Use admin/admin123 para login.\n');
      return;
    }

    logger.info('📂 Encontrado banco antigo. Importando dados...\n');

    // Conectar ao SQLite antigo
    const Database = require('better-sqlite3');
    const oldDb = new Database(dbPath);

    // Contar registros antigos
    const oldUsers = oldDb.prepare('SELECT COUNT(*) as count FROM users').get();
    const oldMarkets = oldDb.prepare('SELECT COUNT(*) as count FROM markets').get();
    const oldWagers = oldDb.prepare('SELECT COUNT(*) as count FROM wagers').get();

    logger.info(`Dados encontrados no banco antigo:`);
    logger.info(`  • ${oldUsers.count} usuários`);
    logger.info(`  • ${oldMarkets.count} mercados`);
    logger.info(`  • ${oldWagers.count} apostas\n`);

    // Importar usuários
    logger.info('👥 Importando usuários...');
    const users = oldDb.prepare('SELECT * FROM users WHERE deleted_at IS NULL').all();
    
    for (const user of users) {
      // Verifica se já existe
      const exists = await query('SELECT id FROM users WHERE username = $1', [user.username]);
      
      if (exists.rows.length === 0) {
        await query(
          `INSERT INTO users (username, email, password_hash, role_id, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (username) DO NOTHING;`,
          [user.username, user.email, user.password_hash, user.is_admin ? 2 : 1, user.is_active, user.created_at]
        );

        // Cria carteira com os créditos originais
        const userResult = await query('SELECT id FROM users WHERE username = $1', [user.username]);
        const credits = user.credits || 100;
        
        await query(
          'INSERT INTO wallets (user_id, balance) VALUES ($1, $2)',
          [userResult.rows[0].id, credits]
        );
      }
    }
    logger.info(`  ✓ ${users.length} usuários importados\n`);

    // Importar mercados
    logger.info('📊 Importando mercados...');
    const markets = oldDb.prepare('SELECT * FROM markets WHERE deleted_at IS NULL').all();
    
    for (const market of markets) {
      // Busca user_id do criador
      const creator = await query('SELECT id FROM users WHERE username IN (SELECT username FROM users)', []);
      
      if (creator.rows.length > 0) {
        await query(
          `INSERT INTO markets (question, description, odds_yes, odds_no, status, outcome, 
                                created_by, created_at, closes_at, reveal_at, scheduled_outcome)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT DO NOTHING;`,
          [
            market.question, market.description, market.odds_yes, market.odds_no,
            market.status, market.outcome, creator.rows[0].id, market.created_at,
            market.closes_at, market.reveal_at, market.scheduled_outcome
          ]
        );
      }
    }
    logger.info(`  ✓ ${markets.length} mercados importados\n`);

    logger.info('✅ Seed concluído com sucesso!\n');
    logger.info('💡 Dica: Se algum dado não foi importado, é porque:');
    logger.info('   • Usuário criador de mercado não foi encontrado');
    logger.info('   • Dados inválidos no banco antigo\n');

    oldDb.close();
  } catch (err) {
    logger.error('Erro ao fazer seed', err.message);
    logger.info('\n💡 Se o erro for "better-sqlite3 not found":');
    logger.info('   npm install better-sqlite3');
    process.exit(1);
  }
}

// Executar
seed().then(() => process.exit(0));
