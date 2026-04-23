import pg from 'pg'
import { describeDatabaseUrl } from './connectionDiagnostics.js'

const tenantPools = new Map<string, pg.Pool>()

export const getTenantPool = (tenantId: string, databaseUrl: string) => {
  const cacheKey = `${tenantId}:${databaseUrl}`
  const cached = tenantPools.get(cacheKey)
  if (cached) return cached
  console.info('[db] opening tenant database connection', {
    tenantId,
    ...describeDatabaseUrl(databaseUrl, 'tenant-database-url'),
  })
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('supabase.com') ? { rejectUnauthorized: false } : undefined,
    max: 5,
  })
  tenantPools.set(cacheKey, pool)
  return pool
}

export const closeTenantPools = async () => {
  await Promise.all(Array.from(tenantPools.values()).map((pool) => pool.end()))
  tenantPools.clear()
}
