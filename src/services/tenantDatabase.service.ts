import { controlDb } from '../db/controlDb.js'
import { notFound } from '../utils/errors.js'

export const getTenantDatabaseUrl = async (tenantId: string) => {
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
  if (!row) {
    throw notFound('TENANT_DATABASE_NOT_FOUND', 'Tenant database is not configured')
  }
  return row.database_url
}
