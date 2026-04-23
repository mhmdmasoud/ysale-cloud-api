import { closeControlDb, controlDb } from './controlDb.js'
import { loadEnv } from '../config/env.js'
import { hashPassword } from '../utils/password.js'

export const migrateControlDb = async () => {
  await controlDb.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
  await controlDb.query(`
    CREATE TABLE IF NOT EXISTS system_admins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await controlDb.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_code TEXT UNIQUE NOT NULL,
      company_name TEXT NOT NULL,
      owner_name TEXT,
      phone TEXT,
      address TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      operation_mode TEXT NOT NULL DEFAULT 'online',
      allowed_devices INTEGER NOT NULL DEFAULT 1,
      server_url TEXT,
      server_port INTEGER NOT NULL DEFAULT 47821,
      server_host TEXT NOT NULL DEFAULT '0.0.0.0',
      database_path TEXT,
      use_tailscale BOOLEAN NOT NULL DEFAULT FALSE,
      auto_start_server BOOLEAN NOT NULL DEFAULT FALSE,
      auto_start_on_windows BOOLEAN NOT NULL DEFAULT FALSE,
      last_connection_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await controlDb.query(`
    CREATE TABLE IF NOT EXISTS tenant_databases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      database_url TEXT NOT NULL,
      database_type TEXT NOT NULL DEFAULT 'postgres',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await controlDb.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT NOT NULL DEFAULT 'admin',
      permissions JSONB DEFAULT '{}'::JSONB,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(tenant_id, username)
    )
  `)
  await controlDb.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      user_id UUID,
      device_id TEXT NOT NULL,
      device_name TEXT,
      windows_username TEXT,
      machine_fingerprint TEXT,
      last_ip TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      last_login_at TIMESTAMP,
      last_seen_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(tenant_id, device_id)
    )
  `)
  await controlDb.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'trial',
      starts_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_name TEXT`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notes TEXT`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS operation_mode TEXT NOT NULL DEFAULT 'online'`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allowed_devices INTEGER NOT NULL DEFAULT 1`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS server_url TEXT`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS server_port INTEGER NOT NULL DEFAULT 47821`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS server_host TEXT NOT NULL DEFAULT '0.0.0.0'`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS database_path TEXT`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS use_tailscale BOOLEAN NOT NULL DEFAULT FALSE`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auto_start_server BOOLEAN NOT NULL DEFAULT FALSE`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auto_start_on_windows BOOLEAN NOT NULL DEFAULT FALSE`)
  await controlDb.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_connection_at TIMESTAMP`)
  await controlDb.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS windows_username TEXT`)
  await controlDb.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS machine_fingerprint TEXT`)
  await controlDb.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_ip TEXT`)
  await controlDb.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP`)
  await controlDb.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      user_id UUID,
      device_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details JSONB,
      ip TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await controlDb.query(`
    CREATE TABLE IF NOT EXISTS migration_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      tenant_code TEXT NOT NULL,
      user_id UUID,
      device_id TEXT,
      source_app_version TEXT,
      source_db_path TEXT,
      source_db_fingerprint TEXT,
      backup_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      counts_before JSONB DEFAULT '{}'::JSONB,
      counts_after JSONB DEFAULT '{}'::JSONB,
      totals_before JSONB DEFAULT '{}'::JSONB,
      totals_after JSONB DEFAULT '{}'::JSONB,
      comparison_result JSONB DEFAULT '{}'::JSONB,
      options JSONB DEFAULT '{}'::JSONB,
      errors JSONB DEFAULT '[]'::JSONB,
      warnings JSONB DEFAULT '[]'::JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await controlDb.query(`
    CREATE TABLE IF NOT EXISTS migration_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      migration_id UUID REFERENCES migration_jobs(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      batch_index INTEGER NOT NULL,
      total_batches INTEGER NOT NULL,
      records_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(migration_id, entity_type, batch_index)
    )
  `)
  await controlDb.query(`
    CREATE TABLE IF NOT EXISTS migration_entity_stats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      migration_id UUID REFERENCES migration_jobs(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      count_before INTEGER DEFAULT 0,
      count_after INTEGER DEFAULT 0,
      status TEXT,
      details JSONB DEFAULT '{}'::JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await controlDb.query(`
    CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status)
  `)
  await controlDb.query(`
    CREATE INDEX IF NOT EXISTS idx_devices_tenant_id ON devices(tenant_id)
  `)
  await controlDb.query(`
    CREATE INDEX IF NOT EXISTS idx_devices_tenant_active ON devices(tenant_id, is_active)
  `)
  await controlDb.query(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON subscriptions(tenant_id)
  `)
  await controlDb.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id)
  `)
  await controlDb.query(`
    CREATE INDEX IF NOT EXISTS idx_migration_jobs_tenant_id ON migration_jobs(tenant_id)
  `)
  await controlDb.query(`
    CREATE INDEX IF NOT EXISTS idx_migration_jobs_fingerprint ON migration_jobs(tenant_id, source_db_fingerprint)
  `)
  await controlDb.query(`
    CREATE INDEX IF NOT EXISTS idx_migration_batches_migration_id ON migration_batches(migration_id)
  `)
}

export const seedSystemAdmin = async () => {
  const env = loadEnv()
  const countResult = await controlDb.query<{ count: string }>('SELECT COUNT(*)::TEXT AS count FROM system_admins')
  const count = Number(countResult.rows[0]?.count || 0)
  if (count > 0) {
    console.log('[seed] system_admins already has at least one admin; skipped')
    return
  }
  const passwordHash = await hashPassword(env.SYSTEM_ADMIN_PASSWORD)
  await controlDb.query(
    `
      INSERT INTO system_admins (username, password_hash, full_name)
      VALUES ($1, $2, $3)
    `,
    [env.SYSTEM_ADMIN_USERNAME, passwordHash, 'System Admin'],
  )
  console.log(`[seed] created system admin: ${env.SYSTEM_ADMIN_USERNAME}`)
}

const resolveDemoTenantExpiry = () => {
  const explicit = String(process.env.DEMO_TENANT_EXPIRES_AT || '').trim()
  if (explicit) return explicit
  const nextYear = new Date()
  nextYear.setFullYear(nextYear.getFullYear() + 1)
  return nextYear.toISOString()
}

export const seedDemoTenant = async () => {
  const tenantCode = String(process.env.DEMO_TENANT_CODE || 'TIME001').trim().toUpperCase()
  const companyName = String(process.env.DEMO_TENANT_COMPANY || 'Time Computer').trim()
  const adminUsername = String(process.env.DEMO_TENANT_ADMIN_USERNAME || 'admin').trim().toLowerCase()
  const adminPassword = String(process.env.DEMO_TENANT_ADMIN_PASSWORD || '123456').trim()
  const adminFullName = String(process.env.DEMO_TENANT_ADMIN_FULL_NAME || 'Tenant Admin').trim()
  const allowedDevices = Math.max(1, Number(process.env.DEMO_TENANT_ALLOWED_DEVICES || 3) || 3)
  const expiresAt = resolveDemoTenantExpiry()
  const passwordHash = await hashPassword(adminPassword)

  const tenantResult = await controlDb.query<{ id: string }>(
    `
      INSERT INTO tenants (
        tenant_code,
        company_name,
        status,
        operation_mode,
        allowed_devices,
        created_at,
        updated_at
      )
      VALUES ($1, $2, 'active', 'online', $3, NOW(), NOW())
      ON CONFLICT (tenant_code)
      DO UPDATE SET
        company_name = EXCLUDED.company_name,
        status = 'active',
        operation_mode = 'online',
        allowed_devices = EXCLUDED.allowed_devices,
        updated_at = NOW()
      RETURNING id
    `,
    [tenantCode, companyName, allowedDevices],
  )
  const tenantId = tenantResult.rows[0]?.id
  await controlDb.query(
    `
      INSERT INTO users (tenant_id, username, password_hash, full_name, role, permissions, is_active)
      VALUES ($1, $2, $3, $4, 'admin', '{}'::JSONB, TRUE)
      ON CONFLICT (tenant_id, username)
      DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        full_name = EXCLUDED.full_name,
        role = 'admin',
        permissions = '{}'::JSONB,
        is_active = TRUE
    `,
    [tenantId, adminUsername, passwordHash, adminFullName],
  )
  await controlDb.query(
    `
      INSERT INTO subscriptions (tenant_id, status, starts_at, expires_at)
      VALUES ($1, 'active', NOW(), $2)
    `,
    [tenantId, expiresAt],
  )

  console.log(`[seed-demo] ensured tenant ${tenantCode} (${companyName})`)
  console.log(`[seed-demo] ensured user ${adminUsername}`)
  console.log(`[seed-demo] login password ${adminPassword}`)
  console.log(`[seed-demo] expiresAt ${expiresAt}`)
}

const command = process.argv[2]
if (command === 'migrate' || command === 'seed' || command === 'seed-demo') {
  try {
    if (command === 'migrate') {
      await migrateControlDb()
      console.log('[migrate] control database is ready')
    } else if (command === 'seed-demo') {
      await migrateControlDb()
      await seedSystemAdmin()
      await seedDemoTenant()
    } else {
      await migrateControlDb()
      await seedSystemAdmin()
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  } finally {
    await closeControlDb()
  }
}
