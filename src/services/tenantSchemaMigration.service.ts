import type pg from 'pg'

export const prepareTenantMigrationSchema = async (pool: pg.Pool) => {
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ysale_migration_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      migration_id UUID NOT NULL,
      entity_type TEXT NOT NULL,
      source_table TEXT,
      legacy_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(migration_id, entity_type, source_table, legacy_id)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ysale_migration_meta (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      migration_id UUID NOT NULL UNIQUE,
      tenant_code TEXT NOT NULL,
      source_db_fingerprint TEXT,
      counts_after JSONB DEFAULT '{}'::JSONB,
      totals_after JSONB DEFAULT '{}'::JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ysale_migration_records_migration_entity
    ON ysale_migration_records(migration_id, entity_type)
  `)
}
