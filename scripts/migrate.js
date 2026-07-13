/**
 * Script de Migração do PostgreSQL
 * Executa todas as migrations pendentes automaticamente
 */

const { query } = require('../src/config/database');
const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../src/migrations');

/**
 * Cria tabela de histórico de migrações se não existir
 */
async function createMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_id VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Retorna migrações já executadas
 */
async function getExecutedMigrations() {
  const result = await query('SELECT migration_id FROM schema_migrations ORDER BY id;');
  return new Set(result.rows.map(row => row.migration_id));
}

/**
 * Carrega todas as migrations
 */
function loadMigrations() {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  return files.map(file => {
    const migration = require(path.join(migrationsDir, file));
    return migration;
  });
}

/**
 * Executa uma migration completa
 */
async function executeMigration(migration) {
  console.log(`\n▶ Executando: ${migration.id}`);

  for (let i = 0; i < migration.up.length; i++) {
    const sql = migration.up[i];
    try {
      await query(sql);
      console.log(`  ✓ Query ${i + 1}/${migration.up.length}`);
    } catch (err) {
      console.error(`  ✗ Erro na query ${i + 1}:`, err.message);
      throw err;
    }
  }

  // Registra migração como executada
  await query(
    'INSERT INTO schema_migrations (migration_id) VALUES ($1);',
    [migration.id]
  );

  console.log(`✓ ${migration.id} executada com sucesso`);
}

/**
 * Executa todas as migrations pendentes
 */
async function runPendingMigrations() {
  try {
    await createMigrationsTable();
    const executed = await getExecutedMigrations();
    const migrations = loadMigrations();

    const pending = migrations.filter(m => !executed.has(m.id));

    if (pending.length === 0) {
      console.log('✓ Nenhuma migração pendente');
      return;
    }

    console.log(`\n📊 Executando ${pending.length} migração(ões)...\n`);

    for (const migration of pending) {
      await executeMigration(migration);
    }

    console.log('\n✓ Todas as migrações executadas com sucesso!');
  } catch (err) {
    console.error('\n✗ Erro ao executar migrações:', err.message);
    process.exit(1);
  }
}

/**
 * Rollback (apenas dev)
 */
async function rollbackLastMigration() {
  try {
    const migrations = loadMigrations();
    const executed = await getExecutedMigrations();

    // Encontra a última migration executada
    const lastMigration = migrations
      .filter(m => executed.has(m.id))
      .pop();

    if (!lastMigration) {
      console.log('Nenhuma migração para fazer rollback');
      return;
    }

    console.log(`\nRolling back: ${lastMigration.id}`);

    for (let i = 0; i < lastMigration.down.length; i++) {
      const sql = lastMigration.down[i];
      try {
        await query(sql);
        console.log(`  ✓ Query ${i + 1}/${lastMigration.down.length}`);
      } catch (err) {
        console.error(`  ✗ Erro na query ${i + 1}:`, err.message);
        throw err;
      }
    }

    await query(
      'DELETE FROM schema_migrations WHERE migration_id = $1;',
      [lastMigration.id]
    );

    console.log(`✓ Rollback de ${lastMigration.id} concluído`);
  } catch (err) {
    console.error('Erro ao fazer rollback:', err.message);
    process.exit(1);
  }
}

// Executa ao chamar direto
if (require.main === module) {
  const command = process.argv[2];
  if (command === 'rollback') {
    rollbackLastMigration().then(() => process.exit(0));
  } else {
    runPendingMigrations().then(() => process.exit(0));
  }
}

module.exports = { runPendingMigrations, rollbackLastMigration };
