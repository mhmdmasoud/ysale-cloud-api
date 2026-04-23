import { controlDb } from '../db/controlDb.js'
import { forbidden, notFound } from '../utils/errors.js'

type DeviceUpsertInput = {
  tenantId: string
  userId?: string | null
  deviceId: string
  deviceName?: string
  windowsUsername?: string
  machineFingerprint?: string
  ipAddress?: string
}

const mapDeviceRow = (row: Record<string, any>) => ({
  id: row.id,
  userId: row.user_id,
  deviceId: row.device_id,
  deviceName: row.device_name,
  windowsUsername: row.windows_username,
  machineFingerprint: row.machine_fingerprint,
  lastIp: row.last_ip,
  isActive: row.is_active,
  status: row.is_active ? 'active' : 'disabled',
  lastLoginAt: row.last_login_at,
  lastSeenAt: row.last_seen_at,
  createdAt: row.created_at,
})

export const getTenantDeviceByDeviceId = async (tenantId: string, deviceId: string) => {
  const result = await controlDb.query<{
    id: string
    user_id: string | null
    device_id: string
    device_name: string | null
    windows_username: string | null
    machine_fingerprint: string | null
    last_ip: string | null
    is_active: boolean
    last_login_at: string | null
    last_seen_at: string | null
    created_at: string
  }>(
    `
      SELECT id, user_id, device_id, device_name, windows_username, machine_fingerprint, last_ip,
             is_active, last_login_at, last_seen_at, created_at
      FROM devices
      WHERE tenant_id = $1 AND device_id = $2
      LIMIT 1
    `,
    [tenantId, deviceId],
  )
  return result.rows[0] || null
}

export const countActiveTenantDevices = async (tenantId: string) => {
  const result = await controlDb.query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count FROM devices WHERE tenant_id = $1 AND is_active = TRUE`,
    [tenantId],
  )
  return Number(result.rows[0]?.count || 0)
}

export const assertTenantDeviceAllowed = async (params: {
  tenantId: string
  deviceId: string
  allowedDevices: number
}) => {
  const existing = await getTenantDeviceByDeviceId(params.tenantId, params.deviceId)
  if (existing && !existing.is_active) {
    throw forbidden('DEVICE_DISABLED', 'This device is disabled for the current tenant')
  }
  if (existing) {
    return existing
  }
  const activeDevices = await countActiveTenantDevices(params.tenantId)
  if (activeDevices >= Math.max(1, Number(params.allowedDevices || 1))) {
    throw forbidden('DEVICE_LIMIT_REACHED', 'تم الوصول للحد الأقصى للأجهزة المسموح بها لهذا الترخيص.')
  }
  return null
}

export const registerTenantDevice = async (params: DeviceUpsertInput) => {
  const result = await controlDb.query<{
    id: string
    user_id: string | null
    device_id: string
    device_name: string | null
    windows_username: string | null
    machine_fingerprint: string | null
    last_ip: string | null
    is_active: boolean
    last_login_at: string | null
    last_seen_at: string | null
    created_at: string
  }>(
    `
      INSERT INTO devices (
        tenant_id, user_id, device_id, device_name, windows_username, machine_fingerprint, last_ip, last_login_at, last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (tenant_id, device_id)
      DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, devices.user_id),
        device_name = COALESCE(NULLIF(EXCLUDED.device_name, ''), devices.device_name),
        windows_username = COALESCE(NULLIF(EXCLUDED.windows_username, ''), devices.windows_username),
        machine_fingerprint = COALESCE(NULLIF(EXCLUDED.machine_fingerprint, ''), devices.machine_fingerprint),
        last_ip = COALESCE(NULLIF(EXCLUDED.last_ip, ''), devices.last_ip),
        last_login_at = NOW(),
        last_seen_at = NOW()
      RETURNING id, user_id, device_id, device_name, windows_username, machine_fingerprint, last_ip,
                is_active, last_login_at, last_seen_at, created_at
    `,
    [
      params.tenantId,
      params.userId || null,
      params.deviceId,
      params.deviceName || null,
      params.windowsUsername || null,
      params.machineFingerprint || null,
      params.ipAddress || null,
    ],
  )
  return result.rows[0]
}

export const upsertDeviceLogin = async (params: DeviceUpsertInput) => {
  await registerTenantDevice(params)
}

export const allowTenantDevice = async (params: DeviceUpsertInput) => {
  const result = await controlDb.query<{
    id: string
    user_id: string | null
    device_id: string
    device_name: string | null
    windows_username: string | null
    machine_fingerprint: string | null
    last_ip: string | null
    is_active: boolean
    last_login_at: string | null
    last_seen_at: string | null
    created_at: string
  }>(
    `
      INSERT INTO devices (
        tenant_id, user_id, device_id, device_name, windows_username, machine_fingerprint, last_ip, is_active, last_login_at, last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW())
      ON CONFLICT (tenant_id, device_id)
      DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, devices.user_id),
        device_name = COALESCE(NULLIF(EXCLUDED.device_name, ''), devices.device_name),
        windows_username = COALESCE(NULLIF(EXCLUDED.windows_username, ''), devices.windows_username),
        machine_fingerprint = COALESCE(NULLIF(EXCLUDED.machine_fingerprint, ''), devices.machine_fingerprint),
        last_ip = COALESCE(NULLIF(EXCLUDED.last_ip, ''), devices.last_ip),
        is_active = TRUE,
        last_login_at = NOW(),
        last_seen_at = NOW()
      RETURNING id, user_id, device_id, device_name, windows_username, machine_fingerprint, last_ip,
                is_active, last_login_at, last_seen_at, created_at
    `,
    [
      params.tenantId,
      params.userId || null,
      params.deviceId,
      params.deviceName || null,
      params.windowsUsername || null,
      params.machineFingerprint || null,
      params.ipAddress || null,
    ],
  )
  return mapDeviceRow(result.rows[0])
}

export const listTenantDevices = async (tenantId: string) => {
  const result = await controlDb.query(
    `
      SELECT id, user_id, device_id, device_name, windows_username, machine_fingerprint, last_ip,
             is_active, last_login_at, last_seen_at, created_at
      FROM devices
      WHERE tenant_id = $1
      ORDER BY last_seen_at DESC NULLS LAST, created_at DESC
    `,
    [tenantId],
  )
  return result.rows.map(mapDeviceRow)
}

export const updateTenantDeviceStatus = async (tenantId: string, deviceKey: string, isActive: boolean) => {
  const result = await controlDb.query(
    `
      UPDATE devices
      SET is_active = $3, last_seen_at = NOW()
      WHERE tenant_id = $1 AND (id::text = $2 OR device_id = $2)
      RETURNING id
    `,
    [tenantId, deviceKey, isActive],
  )
  if (!result.rowCount) {
    throw notFound('DEVICE_NOT_FOUND', 'Device not found')
  }
  return { success: true }
}

export const deleteTenantDevice = async (tenantId: string, deviceKey: string) => {
  const result = await controlDb.query(
    `DELETE FROM devices WHERE tenant_id = $1 AND (id::text = $2 OR device_id = $2) RETURNING id`,
    [tenantId, deviceKey],
  )
  if (!result.rowCount) {
    throw notFound('DEVICE_NOT_FOUND', 'Device not found')
  }
  return { success: true }
}
