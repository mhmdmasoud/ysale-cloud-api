import pg from 'pg'

const tenantPools = new Map<string, pg.Pool>()

export const getTenantPool = (tenantId: string, databaseUrl: string) => {
  const cached = tenantPools.get(tenantId)
  if (cached) return cached
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('supabase.com') ? { rejectUnauthorized: false } : undefined,
    max: 5,
  })
  tenantPools.set(tenantId, pool)
  return pool
}

export const closeTenantPools = async () => {
  await Promise.all(Array.from(tenantPools.values()).map((pool) => pool.end()))
  tenantPools.clear()
}
