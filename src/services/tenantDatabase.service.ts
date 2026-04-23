import { controlDb } from '../db/controlDb.js'
import { loadEnv } from '../config/env.js'
import { describeDatabaseUrl, isUsablePostgresUrl, type DatabaseConnectionDiagnostics } from '../db/connectionDiagnostics.js'

type DbLogger = Pick<Console, 'info' | 'warn' | 'error'>

type TenantDatabaseConfig = {
  databaseUrl: string
  source: string
  diagnostics: DatabaseConnectionDiagnostics
  tenantDatabaseDiagnostics: DatabaseConnectionDiagnostics | null
}

const writeDbLog = (
  logger: DbLogger | undefined,
  level: 'info' | 'warn' | 'error',
  payload: Record<string, unknown>,
  message: string,
) => {
  const target = logger || console
  const fn = target[level] || console[level]
  if (target === console) {
    fn.call(target, message, payload)
    return
  }
  fn.call(target, payload, message)
}

export const resolveTenantDatabaseConfig = async (
  tenantId: string,
  { logger = console, context = 'tenant-db' }: { logger?: DbLogger; context?: string } = {},
): Promise<TenantDatabaseConfig> => {
  const result = await controlDb.query<{ database_url: string }>(
    `
      SELECT database_url
      FROM tenant_databases
      WHERE tenant_id = $1 AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId],
  )
  const row = result.rows[0]
  const tenantDatabaseUrl = String(row?.database_url || '').trim()
  const tenantDiagnostics = tenantDatabaseUrl
    ? describeDatabaseUrl(tenantDatabaseUrl, 'tenant_databases.database_url')
    : null

  if (tenantDatabaseUrl && isUsablePostgresUrl(tenantDatabaseUrl)) {
    writeDbLog(
      logger,
      'info',
      { context, tenantId, ...tenantDiagnostics },
      'tenant database config resolved from tenant_databases.database_url',
    )
    return {
      databaseUrl: tenantDatabaseUrl,
      source: 'tenant_databases.database_url',
      diagnostics: tenantDiagnostics!,
      tenantDatabaseDiagnostics: tenantDiagnostics,
    }
  }

  if (tenantDatabaseUrl) {
    writeDbLog(
      logger,
      'warn',
      { context, tenantId, ...tenantDiagnostics },
      'tenant database config is invalid; falling back to CONTROL_DATABASE_URL',
    )
  } else {
    writeDbLog(
      logger,
      'warn',
      { context, tenantId },
      'tenant database config is missing; falling back to CONTROL_DATABASE_URL',
    )
  }

  const env = loadEnv()
  const fallbackDiagnostics = describeDatabaseUrl(env.CONTROL_DATABASE_URL, 'CONTROL_DATABASE_URL')
  writeDbLog(
    logger,
    'info',
    { context, tenantId, ...fallbackDiagnostics },
    'tenant database config resolved from CONTROL_DATABASE_URL fallback',
  )
  return {
    databaseUrl: env.CONTROL_DATABASE_URL,
    source: 'CONTROL_DATABASE_URL',
    diagnostics: fallbackDiagnostics,
    tenantDatabaseDiagnostics: tenantDiagnostics,
  }
}

export const getTenantDatabaseUrl = async (
  tenantId: string,
  options?: { logger?: DbLogger; context?: string },
) => (await resolveTenantDatabaseConfig(tenantId, options)).databaseUrl
