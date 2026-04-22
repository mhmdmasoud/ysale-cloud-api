import { controlDb } from '../db/controlDb.js'
import { badRequest, conflict, notFound } from '../utils/errors.js'
import { maskDatabaseUrl } from '../utils/crypto.js'
import { hashPassword } from '../utils/password.js'
import { countActiveTenantDevices, listTenantDevices } from './devices.service.js'

export type TenantOperationMode = 'local' | 'online-server' | 'online-client' | 'online'

export type CreateTenantInput = {
  tenantCode: string
  companyName: string
  ownerName?: string
  phone?: string
  address?: string
  notes?: string
  adminUsername?: string
  adminPassword?: string
  adminFullName?: string
  operationMode?: string
  allowedDevices?: number
  trialDays?: number | null
  startsAt?: string | null
  expiresAt?: string | null
  status?: string
  subscriptionStatus?: string
  tenantDatabaseUrl?: string
  serverUrl?: string
  serverPort?: number
  serverHost?: string
  databasePath?: string
  useTailscale?: boolean
  autoStartServer?: boolean
  autoStartOnWindows?: boolean
}

export type UpdateTenantInput = Partial<CreateTenantInput>

const normalizeTenantCode = (value: string) => value.trim().toUpperCase()

const normalizeOperationMode = (value: string | undefined): TenantOperationMode => {
  const raw = String(value || 'online').trim().toLowerCase()
  if (raw === 'local') return 'local'
  if (raw === 'online-server' || raw === 'server') return 'online-server'
  if (raw === 'online-client' || raw === 'client') return 'online-client'
  return 'online'
}

const normalizeTenantStatus = (value: string | undefined) => {
  const raw = String(value || 'active').trim().toLowerCase()
  if (['active', 'trial', 'expired', 'suspended'].includes(raw)) return raw
  return 'active'
}

const normalizeSubscriptionStatus = (value: string | undefined) => {
  const raw = String(value || 'active').trim().toLowerCase()
  if (['active', 'trial', 'expired', 'suspended'].includes(raw)) return raw
  return 'active'
}

const resolveAllowedDevices = (value: number | undefined) => {
  const parsed = Number(value || 1)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.round(parsed))
}

const resolveServerPort = (value: number | undefined) => {
  const parsed = Number(value || 47821)
  if (!Number.isFinite(parsed)) return 47821
  return Math.max(1, Math.min(65535, Math.round(parsed)))
}

const resolveExpiryDate = (input: { expiresAt?: string | null; trialDays?: number | null; startsAt?: string | null }) => {
  if (input.expiresAt) return input.expiresAt
  const trialDays = Number(input.trialDays || 0)
  if (!Number.isFinite(trialDays) || trialDays <= 0) return null
  const base = input.startsAt ? new Date(input.startsAt) : new Date()
  base.setDate(base.getDate() + Math.round(trialDays))
  return base.toISOString()
}

const mapTenantRow = (row: Record<string, any>, includeSecrets: boolean) => ({
  id: row.id,
  tenantCode: row.tenant_code,
  companyName: row.company_name,
  ownerName: row.owner_name || '',
  phone: row.phone || '',
  address: row.address || '',
  notes: row.notes || '',
  status: row.status,
  operationMode: row.operation_mode || 'online',
  allowedDevices: Number(row.allowed_devices || 1),
  registeredDevices: Number(row.registered_devices || 0),
  activeDevices: Number(row.active_devices || 0),
  lastConnectionAt: row.last_connection_at,
  serverUrl: row.server_url || '',
  serverPort: Number(row.server_port || 47821),
  serverHost: row.server_host || '0.0.0.0',
  databasePath: row.database_path || '',
  useTailscale: Boolean(row.use_tailscale),
  autoStartServer: Boolean(row.auto_start_server),
  autoStartOnWindows: Boolean(row.auto_start_on_windows),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  subscription: {
    status: row.subscription_status || '',
    startsAt: row.starts_at || null,
    expiresAt: row.expires_at || null,
  },
  tenantDatabaseUrl: includeSecrets ? row.database_url || '' : row.database_url ? maskDatabaseUrl(row.database_url) : '',
})

const baseTenantSelect = `
  SELECT
    t.id,
    t.tenant_code,
    t.company_name,
    t.owner_name,
    t.phone,
    t.address,
    t.notes,
    t.status,
    t.operation_mode,
    t.allowed_devices,
    t.server_url,
    t.server_port,
    t.server_host,
    t.database_path,
    t.use_tailscale,
    t.auto_start_server,
    t.auto_start_on_windows,
    t.last_connection_at,
    t.created_at,
    t.updated_at,
    s.starts_at,
    s.expires_at,
    s.status AS subscription_status,
    td.database_url,
    COALESCE(dc.registered_devices, 0) AS registered_devices,
    COALESCE(dc.active_devices, 0) AS active_devices
  FROM tenants t
  LEFT JOIN LATERAL (
    SELECT status, starts_at, expires_at
    FROM subscriptions
    WHERE tenant_id = t.id
    ORDER BY created_at DESC
    LIMIT 1
  ) s ON TRUE
  LEFT JOIN LATERAL (
    SELECT database_url
    FROM tenant_databases
    WHERE tenant_id = t.id AND is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1
  ) td ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::INT AS registered_devices,
      COUNT(*) FILTER (WHERE is_active = TRUE)::INT AS active_devices
    FROM devices
    WHERE tenant_id = t.id
  ) dc ON TRUE
`

export const createTenant = async (input: CreateTenantInput) => {
  const tenantCode = normalizeTenantCode(input.tenantCode)
  const companyName = String(input.companyName || '').trim()
  const adminUsername = String(input.adminUsername || '').trim().toLowerCase()
  const adminPassword = String(input.adminPassword || '')
  const hasAdminUsername = Boolean(adminUsername)
  const hasAdminPassword = Boolean(adminPassword)
  if (hasAdminUsername !== hasAdminPassword) {
    throw badRequest('VALIDATION_ERROR', 'adminUsername and adminPassword must be provided together')
  }
  if (!tenantCode || !companyName) {
    throw badRequest('VALIDATION_ERROR', 'Missing required tenant fields')
  }
  const operationMode = normalizeOperationMode(input.operationMode)
  const allowedDevices = resolveAllowedDevices(input.allowedDevices)
  const tenantStatus = normalizeTenantStatus(input.status)
  const subscriptionStatus = normalizeSubscriptionStatus(input.subscriptionStatus || input.status)
  const resolvedExpiresAt = resolveExpiryDate(input)
  const client = await controlDb.connect()
  try {
    await client.query('BEGIN')
    const tenantResult = await client.query<{ id: string }>(
      `
        INSERT INTO tenants (
          tenant_code, company_name, owner_name, phone, address, notes, status, operation_mode, allowed_devices,
          server_url, server_port, server_host, database_path, use_tailscale, auto_start_server, auto_start_on_windows
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING id
      `,
      [
        tenantCode,
        companyName,
        String(input.ownerName || '').trim() || null,
        String(input.phone || '').trim() || null,
        String(input.address || '').trim() || null,
        String(input.notes || '').trim() || null,
        tenantStatus,
        operationMode,
        allowedDevices,
        String(input.serverUrl || '').trim() || null,
        resolveServerPort(input.serverPort),
        String(input.serverHost || '0.0.0.0').trim(),
        String(input.databasePath || '').trim() || null,
        input.useTailscale === true,
        input.autoStartServer === true,
        input.autoStartOnWindows === true,
      ],
    )
    const tenantId = tenantResult.rows[0].id
    if (String(input.tenantDatabaseUrl || '').trim()) {
      await client.query(
        `
          INSERT INTO tenant_databases (tenant_id, database_url)
          VALUES ($1, $2)
        `,
        [tenantId, String(input.tenantDatabaseUrl || '').trim()],
      )
    }
    if (hasAdminUsername && hasAdminPassword) {
      const passwordHash = await hashPassword(adminPassword)
      await client.query(
        `
          INSERT INTO users (tenant_id, username, password_hash, full_name, role, permissions)
          VALUES ($1, $2, $3, $4, 'admin', '{}'::JSONB)
        `,
        [tenantId, adminUsername, passwordHash, String(input.adminFullName || 'Tenant Admin').trim()],
      )
    }
    await client.query(
      `
        INSERT INTO subscriptions (tenant_id, status, starts_at, expires_at)
        VALUES ($1, $2, COALESCE($3::timestamp, NOW()), $4)
      `,
      [tenantId, subscriptionStatus, input.startsAt || null, resolvedExpiresAt],
    )
    await client.query('COMMIT')
    return getTenantById(tenantId, { includeSecrets: true })
  } catch (error) {
    await client.query('ROLLBACK')
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      throw conflict('TENANT_ALREADY_EXISTS', 'Tenant code already exists')
    }
    throw error
  } finally {
    client.release()
  }
}

export const listTenants = async ({ includeSecrets = false } = {}) => {
  const result = await controlDb.query(`${baseTenantSelect} ORDER BY t.created_at DESC`)
  return result.rows.map((row) => mapTenantRow(row, includeSecrets))
}

export const getTenantById = async (tenantId: string, { includeSecrets = false } = {}) => {
  const result = await controlDb.query(`${baseTenantSelect} WHERE t.id = $1 LIMIT 1`, [tenantId])
  const row = result.rows[0]
  if (!row) {
    throw notFound('TENANT_NOT_FOUND', 'Tenant not found')
  }
  return mapTenantRow(row, includeSecrets)
}

export const getTenantDashboard = async () => {
  const rows = await listTenants()
  const now = Date.now()
  const nearWindowMs = 1000 * 60 * 60 * 24 * 14
  return {
    total: rows.length,
    active: rows.filter((row) => row.status === 'active').length,
    trial: rows.filter((row) => row.status === 'trial').length,
    suspended: rows.filter((row) => row.status === 'suspended').length,
    expiredOrExpiringSoon: rows.filter((row) => {
      const raw = row.subscription.expiresAt
      if (!raw) return false
      const expires = new Date(raw).getTime()
      return Number.isFinite(expires) && expires <= now + nearWindowMs
    }).length,
  }
}

export const updateTenant = async (tenantId: string, input: UpdateTenantInput) => {
  const current = await getTenantById(tenantId, { includeSecrets: true })
  await controlDb.query(
    `
      UPDATE tenants
      SET
        company_name = $2,
        owner_name = $3,
        phone = $4,
        address = $5,
        notes = $6,
        status = $7,
        operation_mode = $8,
        allowed_devices = $9,
        server_url = $10,
        server_port = $11,
        server_host = $12,
        database_path = $13,
        use_tailscale = $14,
        auto_start_server = $15,
        auto_start_on_windows = $16,
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      tenantId,
      String(input.companyName ?? current.companyName).trim(),
      String(input.ownerName ?? current.ownerName).trim() || null,
      String(input.phone ?? current.phone).trim() || null,
      String(input.address ?? current.address).trim() || null,
      String(input.notes ?? current.notes).trim() || null,
      normalizeTenantStatus(input.status ?? current.status),
      normalizeOperationMode(input.operationMode ?? current.operationMode),
      resolveAllowedDevices(input.allowedDevices ?? current.allowedDevices),
      String(input.serverUrl ?? current.serverUrl).trim() || null,
      resolveServerPort(input.serverPort ?? current.serverPort),
      String(input.serverHost ?? current.serverHost).trim() || '0.0.0.0',
      String(input.databasePath ?? current.databasePath).trim() || null,
      input.useTailscale === undefined ? current.useTailscale : input.useTailscale === true,
      input.autoStartServer === undefined ? current.autoStartServer : input.autoStartServer === true,
      input.autoStartOnWindows === undefined ? current.autoStartOnWindows : input.autoStartOnWindows === true,
    ],
  )
  if (input.tenantDatabaseUrl !== undefined) {
    const nextUrl = String(input.tenantDatabaseUrl || '').trim()
    if (nextUrl) {
      await controlDb.query(`UPDATE tenant_databases SET is_active = FALSE WHERE tenant_id = $1`, [tenantId])
      await controlDb.query(
        `INSERT INTO tenant_databases (tenant_id, database_url, is_active) VALUES ($1, $2, TRUE)`,
        [tenantId, nextUrl],
      )
    }
  }
  return getTenantById(tenantId, { includeSecrets: true })
}

export const updateTenantStatus = async (tenantId: string, status: string) => {
  const result = await controlDb.query(
    `
      UPDATE tenants
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [tenantId, normalizeTenantStatus(status)],
  )
  return { success: result.rowCount === 1 }
}

export const updateTenantSubscription = async (tenantId: string, expiresAt: string | null) => {
  await controlDb.query(
    `
      INSERT INTO subscriptions (tenant_id, status, expires_at)
      VALUES ($1, 'active', $2)
    `,
    [tenantId, expiresAt || null],
  )
  return { success: true }
}

export const updateTenantLicense = async (tenantId: string, input: {
  status?: string
  subscriptionStatus?: string
  allowedDevices?: number
  expiresAt?: string | null
  startsAt?: string | null
  operationMode?: string
}) => {
  const current = await getTenantById(tenantId, { includeSecrets: true })
  await controlDb.query(
    `
      UPDATE tenants
      SET
        status = $2,
        allowed_devices = $3,
        operation_mode = $4,
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      tenantId,
      normalizeTenantStatus(input.status ?? current.status),
      resolveAllowedDevices(input.allowedDevices ?? current.allowedDevices),
      normalizeOperationMode(input.operationMode ?? current.operationMode),
    ],
  )
  await controlDb.query(
    `
      INSERT INTO subscriptions (tenant_id, status, starts_at, expires_at)
      VALUES ($1, $2, COALESCE($3::timestamp, NOW()), $4)
    `,
    [
      tenantId,
      normalizeSubscriptionStatus(input.subscriptionStatus ?? current.subscription.status),
      input.startsAt || current.subscription.startsAt || null,
      input.expiresAt === undefined ? current.subscription.expiresAt : input.expiresAt,
    ],
  )
  return getTenantById(tenantId, { includeSecrets: true })
}

export const createOrResetTenantAdminUser = async (tenantId: string, input: {
  username: string
  password: string
  fullName?: string
}) => {
  const username = String(input.username || '').trim().toLowerCase()
  const password = String(input.password || '')
  if (!username || password.length < 6) {
    throw badRequest('VALIDATION_ERROR', 'Admin username/password is invalid')
  }
  const passwordHash = await hashPassword(password)
  const result = await controlDb.query(
    `
      INSERT INTO users (tenant_id, username, password_hash, full_name, role, permissions, is_active)
      VALUES ($1, $2, $3, $4, 'admin', '{}'::JSONB, TRUE)
      ON CONFLICT (tenant_id, username)
      DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        full_name = EXCLUDED.full_name,
        role = 'admin',
        is_active = TRUE
      RETURNING id, username, full_name, role, is_active, created_at
    `,
    [tenantId, username, passwordHash, String(input.fullName || 'Tenant Admin').trim()],
  )
  return {
    success: true,
    user: {
      id: result.rows[0].id,
      username: result.rows[0].username,
      fullName: result.rows[0].full_name,
      role: result.rows[0].role,
      isActive: result.rows[0].is_active,
      createdAt: result.rows[0].created_at,
    },
  }
}

export const getTenantDevices = async (tenantId: string) => {
  return listTenantDevices(tenantId)
}

export const getTenantLicenseStatus = async (tenantId: string, deviceId: string) => {
  const tenant = await getTenantById(tenantId, { includeSecrets: false })
  const devices = await listTenantDevices(tenantId)
  const currentDevice = devices.find((entry) => entry.deviceId === deviceId) || null
  return {
    success: true,
    tenantId,
    tenantCode: tenant.tenantCode,
    companyName: tenant.companyName,
    status: tenant.status,
    operationMode: tenant.operationMode,
    allowedDevices: tenant.allowedDevices,
    registeredDevices: tenant.registeredDevices,
    activeDevices: await countActiveTenantDevices(tenantId),
    expiresAt: tenant.subscription.expiresAt,
    device: currentDevice,
  }
}
