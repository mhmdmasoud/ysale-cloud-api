import { controlDb } from '../db/controlDb.js'
import { badRequest, forbidden, unauthorized } from '../utils/errors.js'
import { signTenantToken } from '../utils/jwt.js'
import { verifyPassword } from '../utils/password.js'
import { assertTenantDeviceAllowed, upsertDeviceLogin } from './devices.service.js'

export const loginTenantUser = async (payload: {
  tenantCode: string
  username: string
  password: string
  deviceId: string
  deviceName?: string
  windowsUsername?: string
  machineFingerprint?: string
  ipAddress?: string
}) => {
  const tenantCode = payload.tenantCode.trim().toUpperCase()
  const username = payload.username.trim().toLowerCase()
  if (!tenantCode || !username || !payload.password || !payload.deviceId.trim()) {
    throw badRequest('VALIDATION_ERROR', 'Missing login fields')
  }
  const tenantResult = await controlDb.query<{
    id: string
    tenant_code: string
    company_name: string
    status: string
    operation_mode: string
    allowed_devices: number
    expires_at: string | null
  }>(
    `
      SELECT t.id, t.tenant_code, t.company_name, t.status, t.operation_mode, t.allowed_devices, s.expires_at
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT expires_at
        FROM subscriptions
        WHERE tenant_id = t.id
        ORDER BY created_at DESC
        LIMIT 1
      ) s ON TRUE
      WHERE t.tenant_code = $1
      LIMIT 1
    `,
    [tenantCode],
  )
  const tenant = tenantResult.rows[0]
  if (!tenant) {
    throw unauthorized('INVALID_TENANT_LOGIN', 'Invalid tenant code, username, or password')
  }
  if (!['active', 'trial'].includes(String(tenant.status || '').toLowerCase())) {
    throw forbidden('TENANT_NOT_ACTIVE', 'Tenant is not active')
  }
  if (tenant.expires_at && new Date(tenant.expires_at).getTime() < Date.now()) {
    throw forbidden('SUBSCRIPTION_EXPIRED', 'Subscription has expired')
  }
  const userResult = await controlDb.query<{
    id: string
    username: string
    password_hash: string
    full_name: string | null
    role: string
    permissions: Record<string, unknown>
    is_active: boolean
  }>(
    `
      SELECT id, username, password_hash, full_name, role, permissions, is_active
      FROM users
      WHERE tenant_id = $1 AND username = $2
      LIMIT 1
    `,
    [tenant.id, username],
  )
  const user = userResult.rows[0]
  if (!user || !user.is_active) {
    throw unauthorized('INVALID_TENANT_LOGIN', 'Invalid tenant code, username, or password')
  }
  const ok = await verifyPassword(payload.password, user.password_hash)
  if (!ok) {
    throw unauthorized('INVALID_TENANT_LOGIN', 'Invalid tenant code, username, or password')
  }
  await assertTenantDeviceAllowed({
    tenantId: tenant.id,
    deviceId: payload.deviceId.trim(),
    allowedDevices: Number(tenant.allowed_devices || 1),
  })
  await upsertDeviceLogin({
    tenantId: tenant.id,
    userId: user.id,
    deviceId: payload.deviceId.trim(),
    deviceName: payload.deviceName?.trim() || '',
    windowsUsername: payload.windowsUsername?.trim() || '',
    machineFingerprint: payload.machineFingerprint?.trim() || '',
    ipAddress: payload.ipAddress?.trim() || '',
  })
  await controlDb.query(
    `UPDATE tenants SET last_connection_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [tenant.id],
  )
  const token = signTenantToken({
    tokenType: 'tenant-user',
    tenantId: tenant.id,
    tenantCode: tenant.tenant_code,
    userId: user.id,
    username: user.username,
    role: user.role,
    permissions: user.permissions || {},
    deviceId: payload.deviceId.trim(),
  })
  return {
    success: true,
    token,
    tenant: {
      id: tenant.id,
      code: tenant.tenant_code,
      companyName: tenant.company_name,
      operationMode: tenant.operation_mode,
      allowedDevices: Number(tenant.allowed_devices || 1),
    },
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      permissions: user.permissions || {},
    },
  }
}
