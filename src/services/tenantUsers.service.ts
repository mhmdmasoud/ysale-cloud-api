import { controlDb } from '../db/controlDb.js'
import { badRequest, conflict, notFound } from '../utils/errors.js'
import { hashPassword } from '../utils/password.js'

const USER_ROLES = new Set(['admin', 'manager', 'cashier', 'accountant', 'viewer'])

const normalizeTenantCode = (value: string) => String(value || '').trim().toUpperCase()
const normalizeUsername = (value: string) => String(value || '').trim().toLowerCase()
const normalizeRole = (value: string) => {
  const role = String(value || 'viewer').trim().toLowerCase()
  if (!USER_ROLES.has(role)) {
    throw badRequest('VALIDATION_ERROR', 'Invalid user role')
  }
  return role
}

const parsePermissions = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

const mapUser = (row: Record<string, any>) => ({
  id: row.id,
  tenantId: row.tenant_id,
  tenantCode: row.tenant_code,
  username: row.username,
  fullName: row.full_name || '',
  role: row.role,
  permissions: row.permissions || {},
  isActive: Boolean(row.is_active),
  status: row.is_active ? 'active' : 'disabled',
  lastLoginAt: row.last_login_at || null,
  createdAt: row.created_at,
})

export const getTenantByCodeForAdmin = async (tenantCodeInput: string, { includeSecrets = false } = {}) => {
  const tenantCode = normalizeTenantCode(tenantCodeInput)
  if (!tenantCode) throw badRequest('VALIDATION_ERROR', 'tenantCode is required')
  const result = await controlDb.query(
    `
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
        t.last_connection_at,
        t.created_at,
        t.updated_at,
        s.status AS subscription_status,
        s.starts_at,
        s.expires_at,
        td.database_url
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
      WHERE t.tenant_code = $1
      LIMIT 1
    `,
    [tenantCode],
  )
  const row = result.rows[0]
  if (!row) throw notFound('TENANT_NOT_FOUND', 'Tenant not found')
  return {
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
    lastConnectionAt: row.last_connection_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    subscription: {
      status: row.subscription_status || '',
      startsAt: row.starts_at || null,
      expiresAt: row.expires_at || null,
    },
    tenantDatabaseUrl: includeSecrets ? row.database_url || '' : row.database_url ? 'configured' : '',
  }
}

const getTenantId = async (tenantCode: string) => {
  const tenant = await getTenantByCodeForAdmin(tenantCode, { includeSecrets: false })
  return tenant.id
}

export const listTenantUsers = async (tenantCodeInput: string) => {
  const tenantCode = normalizeTenantCode(tenantCodeInput)
  const tenantId = await getTenantId(tenantCode)
  const result = await controlDb.query(
    `
      SELECT
        u.id,
        u.tenant_id,
        t.tenant_code,
        u.username,
        u.full_name,
        u.role,
        u.permissions,
        u.is_active,
        u.created_at,
        MAX(d.last_login_at) AS last_login_at
      FROM users u
      JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN devices d ON d.tenant_id = u.tenant_id AND d.user_id = u.id
      WHERE u.tenant_id = $1
      GROUP BY u.id, t.tenant_code
      ORDER BY LOWER(u.username) ASC
    `,
    [tenantId],
  )
  return result.rows.map(mapUser)
}

export const createTenantUser = async (tenantCodeInput: string, input: Record<string, unknown>) => {
  const tenantCode = normalizeTenantCode(tenantCodeInput)
  const tenantId = await getTenantId(tenantCode)
  const username = normalizeUsername(String(input.username || ''))
  const password = String(input.password || '')
  const fullName = String(input.fullName || '').trim()
  const role = normalizeRole(String(input.role || 'viewer'))
  if (!username || password.length < 6) {
    throw badRequest('VALIDATION_ERROR', 'username and password with at least 6 characters are required')
  }
  const existing = await controlDb.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND LOWER(username) = LOWER($2) LIMIT 1`,
    [tenantId, username],
  )
  if (existing.rows[0]) {
    throw conflict('USER_ALREADY_EXISTS', 'A user with this username already exists in this tenant')
  }
  const passwordHash = await hashPassword(password)
  const result = await controlDb.query(
    `
      INSERT INTO users (tenant_id, username, password_hash, full_name, role, permissions, is_active)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      RETURNING id, tenant_id, $8::text AS tenant_code, username, full_name, role, permissions, is_active, created_at, NULL::timestamp AS last_login_at
    `,
    [
      tenantId,
      username,
      passwordHash,
      fullName || null,
      role,
      JSON.stringify(parsePermissions(input.permissions)),
      input.isActive === false ? false : true,
      tenantCode,
    ],
  )
  return { success: true, user: mapUser(result.rows[0]) }
}

export const updateTenantUser = async (tenantCodeInput: string, userId: string, input: Record<string, unknown>) => {
  const tenantId = await getTenantId(tenantCodeInput)
  const updates: string[] = []
  const values: unknown[] = [tenantId, userId]
  const add = (sql: string, value: unknown) => {
    values.push(value)
    updates.push(`${sql} = $${values.length}`)
  }
  if (input.username !== undefined) add('username', normalizeUsername(String(input.username || '')))
  if (input.fullName !== undefined) add('full_name', String(input.fullName || '').trim() || null)
  if (input.role !== undefined) add('role', normalizeRole(String(input.role || 'viewer')))
  if (input.permissions !== undefined) add('permissions', JSON.stringify(parsePermissions(input.permissions)))
  if (input.isActive !== undefined) add('is_active', input.isActive === true)
  if (!updates.length) throw badRequest('VALIDATION_ERROR', 'No user fields to update')
  const result = await controlDb.query(
    `
      UPDATE users u
      SET ${updates.join(', ')}
      FROM tenants t
      WHERE u.tenant_id = $1 AND u.id = $2 AND t.id = u.tenant_id
      RETURNING u.id, u.tenant_id, t.tenant_code, u.username, u.full_name, u.role, u.permissions, u.is_active, u.created_at,
        (SELECT MAX(d.last_login_at) FROM devices d WHERE d.tenant_id = u.tenant_id AND d.user_id = u.id) AS last_login_at
    `,
    values,
  )
  if (!result.rows[0]) throw notFound('USER_NOT_FOUND', 'User not found')
  return { success: true, user: mapUser(result.rows[0]) }
}

export const resetTenantUserPassword = async (tenantCodeInput: string, userId: string, password: string) => {
  const tenantId = await getTenantId(tenantCodeInput)
  if (String(password || '').length < 6) {
    throw badRequest('VALIDATION_ERROR', 'Password must be at least 6 characters')
  }
  const passwordHash = await hashPassword(password)
  const result = await controlDb.query(
    `
      UPDATE users u
      SET password_hash = $3
      FROM tenants t
      WHERE u.tenant_id = $1 AND u.id = $2 AND t.id = u.tenant_id
      RETURNING u.id, u.tenant_id, t.tenant_code, u.username, u.full_name, u.role, u.permissions, u.is_active, u.created_at,
        (SELECT MAX(d.last_login_at) FROM devices d WHERE d.tenant_id = u.tenant_id AND d.user_id = u.id) AS last_login_at
    `,
    [tenantId, userId, passwordHash],
  )
  if (!result.rows[0]) throw notFound('USER_NOT_FOUND', 'User not found')
  return { success: true, user: mapUser(result.rows[0]) }
}

export const setTenantUserStatus = async (tenantCodeInput: string, userId: string, isActive: boolean) =>
  updateTenantUser(tenantCodeInput, userId, { isActive })

export const deleteTenantUser = async (tenantCodeInput: string, userId: string) => {
  const tenantId = await getTenantId(tenantCodeInput)
  const current = await controlDb.query(
    `SELECT id, role FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, userId],
  )
  if (!current.rows[0]) throw notFound('USER_NOT_FOUND', 'User not found')
  if (String(current.rows[0].role || '').toLowerCase() === 'admin') {
    const admins = await controlDb.query(
      `SELECT COUNT(*)::INT AS count FROM users WHERE tenant_id = $1 AND role = 'admin' AND is_active = TRUE AND id <> $2`,
      [tenantId, userId],
    )
    if (Number(admins.rows[0]?.count || 0) < 1) {
      throw badRequest('LAST_ADMIN_USER', 'Cannot delete the last active admin user for this tenant')
    }
  }
  await controlDb.query(`DELETE FROM users WHERE tenant_id = $1 AND id = $2`, [tenantId, userId])
  return { success: true }
}
