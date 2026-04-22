import { controlDb } from '../db/controlDb.js'
import { getTenantPool } from '../db/tenantDb.js'
import { badRequest, forbidden, notFound } from '../utils/errors.js'
import { getTenantDatabaseUrl } from './tenantDatabase.service.js'
import { compareMigrationResult } from './migrationComparison.service.js'
import { prepareTenantMigrationSchema } from './tenantSchemaMigration.service.js'

type TenantUser = {
  tenantId: string
  tenantCode: string
  userId: string
  username: string
  role: string
  permissions: Record<string, unknown>
  deviceId: string
}

type MigrationRecord = Record<string, unknown>

const assertMigrationAdmin = (user: TenantUser) => {
  if (String(user.role || '').toLowerCase() !== 'admin') {
    throw forbidden('MIGRATION_ADMIN_REQUIRED', 'Only tenant admin users can run migration')
  }
}

export const validateMigrationAccess = async (user: TenantUser) => {
  assertMigrationAdmin(user)
  const result = await controlDb.query<{
    tenant_id: string
    tenant_code: string
    company_name: string
    status: string
    expires_at: string | null
  }>(
    `
      SELECT t.id AS tenant_id, t.tenant_code, t.company_name, t.status, s.expires_at
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT expires_at
        FROM subscriptions
        WHERE tenant_id = t.id
        ORDER BY created_at DESC
        LIMIT 1
      ) s ON TRUE
      WHERE t.id = $1
      LIMIT 1
    `,
    [user.tenantId],
  )
  const tenant = result.rows[0]
  if (!tenant) throw notFound('TENANT_NOT_FOUND', 'Tenant was not found')
  if (tenant.status !== 'active') throw forbidden('TENANT_NOT_ACTIVE', 'Tenant is not active')
  if (tenant.expires_at && new Date(tenant.expires_at).getTime() < Date.now()) {
    throw forbidden('SUBSCRIPTION_EXPIRED', 'Subscription has expired')
  }
  return {
    success: true,
    tenant: {
      id: tenant.tenant_id,
      code: tenant.tenant_code,
      companyName: tenant.company_name,
      status: tenant.status,
      expiresAt: tenant.expires_at,
    },
    permissions: {
      canMigrate: true,
      canOverwriteTenantData: false,
    },
  }
}

export const checkExistingMigration = async (user: TenantUser, sourceDbFingerprint: string) => {
  assertMigrationAdmin(user)
  if (!sourceDbFingerprint) throw badRequest('SOURCE_FINGERPRINT_REQUIRED', 'sourceDbFingerprint is required')
  const result = await controlDb.query(
    `
      SELECT id, status, started_at, finished_at, created_at
      FROM migration_jobs
      WHERE tenant_id = $1 AND source_db_fingerprint = $2 AND status IN ('running', 'success', 'warning')
      ORDER BY created_at DESC
      LIMIT 5
    `,
    [user.tenantId, sourceDbFingerprint],
  )
  return {
    success: true,
    exists: result.rows.length > 0,
    jobs: result.rows,
  }
}

export const initMigration = async (
  user: TenantUser,
  payload: {
    tenantCode?: string
    sourceAppVersion?: string
    sourceDbFingerprint: string
    sourceDbPath?: string
    backupPath?: string
    countsBefore?: Record<string, unknown>
    totalsBefore?: Record<string, unknown>
    options?: Record<string, unknown>
    forceRepeat?: boolean
  },
) => {
  assertMigrationAdmin(user)
  if (!payload.sourceDbFingerprint) throw badRequest('SOURCE_FINGERPRINT_REQUIRED', 'sourceDbFingerprint is required')
  if (!payload.backupPath) throw badRequest('BACKUP_REQUIRED', 'Backup path is required before migration')

  const existing = await checkExistingMigration(user, payload.sourceDbFingerprint)
  if (existing.exists && !payload.forceRepeat) {
    throw forbidden('MIGRATION_ALREADY_EXISTS', 'This SQLite database fingerprint was migrated before for this tenant')
  }

  const result = await controlDb.query<{ id: string }>(
    `
      INSERT INTO migration_jobs (
        tenant_id, tenant_code, user_id, device_id, source_app_version, source_db_path,
        source_db_fingerprint, backup_path, status, started_at, counts_before,
        totals_before, options, warnings
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'running', NOW(), $9::JSONB, $10::JSONB, $11::JSONB, $12::JSONB)
      RETURNING id
    `,
    [
      user.tenantId,
      user.tenantCode,
      user.userId,
      user.deviceId,
      payload.sourceAppVersion || null,
      payload.sourceDbPath || null,
      payload.sourceDbFingerprint,
      payload.backupPath,
      JSON.stringify(payload.countsBefore || {}),
      JSON.stringify(payload.totalsBefore || {}),
      JSON.stringify(payload.options || {}),
      JSON.stringify(existing.exists ? [{ code: 'REPEATED_MIGRATION_CONFIRMED' }] : []),
    ],
  )
  return { success: true, migrationId: result.rows[0].id }
}

export const prepareMigrationTenantDb = async (user: TenantUser) => {
  assertMigrationAdmin(user)
  const databaseUrl = await getTenantDatabaseUrl(user.tenantId)
  const pool = getTenantPool(user.tenantId, databaseUrl)
  await prepareTenantMigrationSchema(pool)
  return { success: true }
}

const getMigrationJob = async (user: TenantUser, migrationId: string) => {
  const result = await controlDb.query<{
    id: string
    tenant_id: string
    tenant_code: string
    status: string
    counts_before: Record<string, unknown>
    totals_before: Record<string, unknown>
    warnings: unknown[]
    errors: unknown[]
    source_db_fingerprint: string | null
  }>(
    `
      SELECT id, tenant_id, tenant_code, status, counts_before, totals_before, warnings, errors, source_db_fingerprint
      FROM migration_jobs
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1
    `,
    [migrationId, user.tenantId],
  )
  const job = result.rows[0]
  if (!job) throw notFound('MIGRATION_NOT_FOUND', 'Migration job was not found')
  return job
}

export const saveMigrationBatch = async (
  user: TenantUser,
  payload: {
    migrationId: string
    entityType: string
    batchIndex: number
    totalBatches: number
    records: MigrationRecord[]
  },
) => {
  assertMigrationAdmin(user)
  if (!payload.migrationId || !payload.entityType) throw badRequest('VALIDATION_ERROR', 'migrationId and entityType are required')
  if (!Array.isArray(payload.records)) throw badRequest('VALIDATION_ERROR', 'records must be an array')
  const job = await getMigrationJob(user, payload.migrationId)
  if (job.status === 'cancelled') throw forbidden('MIGRATION_CANCELLED', 'Migration was cancelled')
  if (!['running', 'pending'].includes(job.status)) throw forbidden('MIGRATION_NOT_RUNNING', 'Migration is not running')

  await prepareMigrationTenantDb(user)
  const databaseUrl = await getTenantDatabaseUrl(user.tenantId)
  const pool = getTenantPool(user.tenantId, databaseUrl)
  const tenantClient = await pool.connect()
  try {
    await controlDb.query(
      `
        INSERT INTO migration_batches (migration_id, entity_type, batch_index, total_batches, records_count, status, started_at)
        VALUES ($1, $2, $3, $4, $5, 'running', NOW())
        ON CONFLICT (migration_id, entity_type, batch_index)
        DO UPDATE SET status = 'running', error = NULL, started_at = NOW(), records_count = EXCLUDED.records_count
      `,
      [payload.migrationId, payload.entityType, payload.batchIndex, payload.totalBatches, payload.records.length],
    )

    await tenantClient.query('BEGIN')
    for (let index = 0; index < payload.records.length; index += 1) {
      const record = payload.records[index] || {}
      const sourceTable = String(record.__ysaleSourceTable || record.__sourceTable || payload.entityType)
      const legacyId = String(record.__ysaleLegacyId || record.id || record.ID || record.Id || `${payload.batchIndex}:${index}`)
      await tenantClient.query(
        `
          INSERT INTO ysale_migration_records (migration_id, entity_type, source_table, legacy_id, payload)
          VALUES ($1, $2, $3, $4, $5::JSONB)
          ON CONFLICT (migration_id, entity_type, source_table, legacy_id)
          DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
        `,
        [payload.migrationId, payload.entityType, sourceTable, legacyId, JSON.stringify(record)],
      )
    }
    await tenantClient.query('COMMIT')
    await controlDb.query(
      `
        UPDATE migration_batches
        SET status = 'success', finished_at = NOW(), error = NULL
        WHERE migration_id = $1 AND entity_type = $2 AND batch_index = $3
      `,
      [payload.migrationId, payload.entityType, payload.batchIndex],
    )
    return { success: true, recordsCount: payload.records.length }
  } catch (error) {
    await tenantClient.query('ROLLBACK').catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    await controlDb.query(
      `
        UPDATE migration_batches
        SET status = 'failed', finished_at = NOW(), error = $4
        WHERE migration_id = $1 AND entity_type = $2 AND batch_index = $3
      `,
      [payload.migrationId, payload.entityType, payload.batchIndex, message],
    )
    await controlDb.query(
      `
        UPDATE migration_jobs
        SET status = 'failed', finished_at = NOW(), errors = errors || $2::JSONB
        WHERE id = $1 AND tenant_id = $3
      `,
      [payload.migrationId, JSON.stringify([{ entityType: payload.entityType, batchIndex: payload.batchIndex, message }]), user.tenantId],
    )
    throw error
  } finally {
    tenantClient.release()
  }
}

export const finalizeMigration = async (
  user: TenantUser,
  payload: { migrationId: string; totalsAfter?: Record<string, unknown> },
) => {
  assertMigrationAdmin(user)
  const job = await getMigrationJob(user, payload.migrationId)
  await prepareMigrationTenantDb(user)
  const databaseUrl = await getTenantDatabaseUrl(user.tenantId)
  const pool = getTenantPool(user.tenantId, databaseUrl)
  const countsResult = await pool.query<{ entity_type: string; count: string }>(
    `
      SELECT entity_type, COUNT(*)::TEXT AS count
      FROM ysale_migration_records
      WHERE migration_id = $1
      GROUP BY entity_type
    `,
    [payload.migrationId],
  )
  const countsAfter = Object.fromEntries(countsResult.rows.map((row) => [row.entity_type, Number(row.count)]))
  const totalsResult = await pool.query<{
    stock_quantity_total: string | null
    cashboxes_balance_total: string | null
    sales_invoices_total: string | null
    purchase_invoices_total: string | null
    paid_total: string | null
    remaining_total: string | null
    ledger_debit_total: string | null
    ledger_credit_total: string | null
  }>(
    `
      SELECT
        SUM(CASE WHEN entity_type = 'stockInitialBalances' THEN COALESCE(NULLIF(payload->>'qtyBase', '')::NUMERIC, NULLIF(payload->>'qty', '')::NUMERIC, 0) ELSE 0 END)::TEXT AS stock_quantity_total,
        SUM(CASE WHEN entity_type = 'cashboxes' THEN COALESCE(NULLIF(payload->>'openingBalanceAmountCents', '')::NUMERIC / 100, NULLIF(payload->>'balanceCents', '')::NUMERIC / 100, NULLIF(payload->>'balance', '')::NUMERIC, 0) ELSE 0 END)::TEXT AS cashboxes_balance_total,
        SUM(CASE WHEN entity_type = 'salesInvoices' THEN COALESCE(NULLIF(payload->>'totalCents', '')::NUMERIC / 100, NULLIF(payload->>'total', '')::NUMERIC, 0) ELSE 0 END)::TEXT AS sales_invoices_total,
        SUM(CASE WHEN entity_type = 'purchaseInvoices' THEN COALESCE(NULLIF(payload->>'totalCents', '')::NUMERIC / 100, NULLIF(payload->>'total', '')::NUMERIC, 0) ELSE 0 END)::TEXT AS purchase_invoices_total,
        SUM(CASE WHEN entity_type IN ('salesInvoices', 'purchaseInvoices', 'salesReturns', 'purchaseReturns') THEN COALESCE(NULLIF(payload->>'paidCents', '')::NUMERIC / 100, NULLIF(payload->>'paid', '')::NUMERIC, 0) ELSE 0 END)::TEXT AS paid_total,
        SUM(CASE WHEN entity_type IN ('salesInvoices', 'purchaseInvoices', 'salesReturns', 'purchaseReturns') THEN COALESCE(NULLIF(payload->>'dueCents', '')::NUMERIC / 100, NULLIF(payload->>'remainingCents', '')::NUMERIC / 100, NULLIF(payload->>'due', '')::NUMERIC, 0) ELSE 0 END)::TEXT AS remaining_total,
        SUM(CASE WHEN entity_type = 'ledgerEntries' THEN COALESCE(NULLIF(payload->>'debitCents', '')::NUMERIC / 100, NULLIF(payload->>'debit', '')::NUMERIC, 0) ELSE 0 END)::TEXT AS ledger_debit_total,
        SUM(CASE WHEN entity_type = 'ledgerEntries' THEN COALESCE(NULLIF(payload->>'creditCents', '')::NUMERIC / 100, NULLIF(payload->>'credit', '')::NUMERIC, 0) ELSE 0 END)::TEXT AS ledger_credit_total
      FROM ysale_migration_records
      WHERE migration_id = $1
    `,
    [payload.migrationId],
  )
  const computedTotals = totalsResult.rows[0] || {}
  const ledgerDebitTotal = Number(computedTotals.ledger_debit_total || 0)
  const ledgerCreditTotal = Number(computedTotals.ledger_credit_total || 0)
  const totalsAfter = {
    customersBalanceTotal: null,
    suppliersBalanceTotal: null,
    stockQuantityTotal: Number(computedTotals.stock_quantity_total || 0),
    stockValueTotal: null,
    cashboxesBalanceTotal: Number(computedTotals.cashboxes_balance_total || 0),
    salesInvoicesTotal: Number(computedTotals.sales_invoices_total || 0),
    purchaseInvoicesTotal: Number(computedTotals.purchase_invoices_total || 0),
    paidTotal: Number(computedTotals.paid_total || 0),
    remainingTotal: Number(computedTotals.remaining_total || 0),
    ledgerDebitTotal,
    ledgerCreditTotal,
    ledgerDifference: Number((ledgerDebitTotal - ledgerCreditTotal).toFixed(2)),
    ...(payload.totalsAfter || {}),
  }
  const comparison = compareMigrationResult({
    countsBefore: (job.counts_before || {}) as Record<string, number | null | undefined>,
    countsAfter,
    totalsBefore: (job.totals_before || {}) as Record<string, number | null | undefined>,
    totalsAfter,
    warnings: job.warnings || [],
    errors: job.errors || [],
  })

  await pool.query(
    `
      INSERT INTO ysale_migration_meta (migration_id, tenant_code, source_db_fingerprint, counts_after, totals_after)
      VALUES ($1, $2, $3, $4::JSONB, $5::JSONB)
      ON CONFLICT (migration_id)
      DO UPDATE SET counts_after = EXCLUDED.counts_after, totals_after = EXCLUDED.totals_after, updated_at = NOW()
    `,
    [payload.migrationId, user.tenantCode, job.source_db_fingerprint, JSON.stringify(countsAfter), JSON.stringify(totalsAfter)],
  )

  await controlDb.query(
    `
      UPDATE migration_jobs
      SET status = $2, finished_at = NOW(), counts_after = $3::JSONB,
          totals_after = $4::JSONB, comparison_result = $5::JSONB,
          warnings = $6::JSONB, errors = $7::JSONB
      WHERE id = $1 AND tenant_id = $8
    `,
    [
      payload.migrationId,
      comparison.status,
      JSON.stringify(countsAfter),
      JSON.stringify(totalsAfter),
      JSON.stringify(comparison),
      JSON.stringify(comparison.warnings || []),
      JSON.stringify(comparison.errors || []),
      user.tenantId,
    ],
  )
  return { success: true, status: comparison.status, countsAfter, totalsAfter, comparisonResult: comparison }
}

export const getMigrationStatus = async (user: TenantUser, migrationId: string) => {
  const job = await getMigrationJob(user, migrationId)
  const batches = await controlDb.query(
    `
      SELECT entity_type, batch_index, total_batches, records_count, status, error, started_at, finished_at
      FROM migration_batches
      WHERE migration_id = $1
      ORDER BY entity_type, batch_index
    `,
    [migrationId],
  )
  return { success: true, job, batches: batches.rows }
}

export const getMigrationReport = async (user: TenantUser, migrationId: string) => {
  const status = await getMigrationStatus(user, migrationId)
  return {
    success: true,
    report: {
      system: 'YSale',
      title: 'تقرير ترحيل البيانات إلى الأونلاين',
      job: status.job,
      batches: status.batches,
    },
  }
}

export const cancelMigration = async (user: TenantUser, migrationId: string) => {
  assertMigrationAdmin(user)
  await getMigrationJob(user, migrationId)
  await controlDb.query(
    `
      UPDATE migration_jobs
      SET status = 'cancelled', finished_at = NOW(),
          warnings = warnings || $2::JSONB
      WHERE id = $1 AND tenant_id = $3 AND status IN ('pending', 'running')
    `,
    [
      migrationId,
      JSON.stringify([
        {
          code: 'MIGRATION_CANCELLED',
          message: 'تم إلغاء الترحيل. قد تكون بعض البيانات رُفعت جزئيًا.',
        },
      ]),
      user.tenantId,
    ],
  )
  return { success: true }
}
