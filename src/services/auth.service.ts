import type { FastifyBaseLogger } from 'fastify'
import { controlDb } from '../db/controlDb.js'
import { badRequest, forbidden, internalServerError, notFound, unauthorized, type AppError } from '../utils/errors.js'
import { loadEnv } from '../config/env.js'
import { signTenantToken } from '../utils/jwt.js'
import { verifyPassword } from '../utils/password.js'
import { assertTenantDeviceAllowed, upsertDeviceLogin } from './devices.service.js'

type AuthLogger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>

type LoginDiagnostics = {
  tenantCode: string
  username: string
  controlDatabaseUrlPresent: boolean
  databaseConnectionOk: boolean
  tenantsTableExists: boolean
  usersTableExists: boolean
  tenantUsersTableExists: boolean
  tenantFound: boolean
  userFound: boolean
  passwordHashPresent: boolean
  bcryptCompareSucceeded: boolean
}

const isAppError = (error: unknown): error is AppError => error instanceof Error && 'statusCode' in error && 'errorCode' in error

const writeLog = (logger: AuthLogger | Console, level: 'info' | 'warn' | 'error', payload: Record<string, unknown>, message: string) => {
  const target = logger as Record<string, (...args: unknown[]) => void>
  if (logger === console) {
    target[level](message, payload)
    return
  }
  target[level](payload, message)
}

const classifyAuthFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '')
  const pgCode = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  const relationMatch = message.match(/relation "([^"]+)"/i)
  const relationName = relationMatch?.[1] || ''
  if (pgCode === '42P01') {
    return relationName ? `${relationName} table missing` : 'required table missing'
  }
  if (/CONTROL_DATABASE_URL|PUT_YOUR_SUPABASE_DATABASE_URL_HERE/i.test(message)) {
    return 'database connection failed'
  }
  if (
    pgCode.startsWith('08')
    || pgCode === '3D000'
    || pgCode === '28P01'
    || /ECONNREFUSED|ENOTFOUND|getaddrinfo|database connection|password authentication failed|auth failed|no pg_hba.conf/i.test(message)
  ) {
    return 'database connection failed'
  }
  if (/jwt_secret|Invalid environment variable JWT_SECRET|secretOrPrivateKey/i.test(message)) {
    return 'jwt secret missing'
  }
  if (/bcrypt/i.test(message) || /Illegal arguments/i.test(message)) {
    return 'bcrypt error'
  }
  return ''
}

const hasControlDatabaseUrl = () => {
  const raw = String(process.env.CONTROL_DATABASE_URL || '').trim()
  return Boolean(raw && raw !== 'PUT_YOUR_SUPABASE_DATABASE_URL_HERE')
}

const assertLoginInfrastructure = async (logger: AuthLogger | Console, diagnostics: LoginDiagnostics) => {
  diagnostics.controlDatabaseUrlPresent = hasControlDatabaseUrl()
  writeLog(
    logger,
    diagnostics.controlDatabaseUrlPresent ? 'info' : 'error',
    {
      tenantCode: diagnostics.tenantCode,
      username: diagnostics.username,
      controlDatabaseUrlPresent: diagnostics.controlDatabaseUrlPresent,
    },
    'tenant login infrastructure: CONTROL_DATABASE_URL presence check',
  )
  if (!diagnostics.controlDatabaseUrlPresent) {
    throw internalServerError('AUTH_INFRASTRUCTURE_ERROR', 'database connection failed')
  }

  loadEnv()

  await controlDb.query('SELECT 1')
  diagnostics.databaseConnectionOk = true

  const tableResult = await controlDb.query<{
    tenants_exists: boolean
    users_exists: boolean
    tenant_users_exists: boolean
  }>(
    `
      SELECT
        to_regclass('public.tenants') IS NOT NULL AS tenants_exists,
        to_regclass('public.users') IS NOT NULL AS users_exists,
        to_regclass('public.tenant_users') IS NOT NULL AS tenant_users_exists
    `,
  )
  const tableState = tableResult.rows[0]
  diagnostics.tenantsTableExists = Boolean(tableState?.tenants_exists)
  diagnostics.usersTableExists = Boolean(tableState?.users_exists)
  diagnostics.tenantUsersTableExists = Boolean(tableState?.tenant_users_exists)

  writeLog(
    logger,
    'info',
    {
      tenantCode: diagnostics.tenantCode,
      username: diagnostics.username,
      databaseConnectionOk: diagnostics.databaseConnectionOk,
      tenantsTableExists: diagnostics.tenantsTableExists,
      usersTableExists: diagnostics.usersTableExists,
      tenantUsersTableExists: diagnostics.tenantUsersTableExists,
    },
    'tenant login infrastructure: database and table checks',
  )

  if (!diagnostics.tenantsTableExists) {
    throw internalServerError('AUTH_INFRASTRUCTURE_ERROR', 'tenants table missing')
  }
  if (!diagnostics.usersTableExists) {
    throw internalServerError('AUTH_INFRASTRUCTURE_ERROR', 'users table missing')
  }
}

export const loginTenantUser = async (payload: {
  tenantCode: string
  username: string
  password: string
  deviceId: string
  deviceName?: string
  windowsUsername?: string
  machineFingerprint?: string
  ipAddress?: string
  logger?: AuthLogger
}) => {
  const tenantCode = payload.tenantCode.trim().toUpperCase()
  const username = payload.username.trim().toLowerCase()
  const logger = payload.logger || console
  const diagnostics: LoginDiagnostics = {
    tenantCode,
    username,
    controlDatabaseUrlPresent: false,
    databaseConnectionOk: false,
    tenantsTableExists: false,
    usersTableExists: false,
    tenantUsersTableExists: false,
    tenantFound: false,
    userFound: false,
    passwordHashPresent: false,
    bcryptCompareSucceeded: false,
  }

  try {
    if (!tenantCode || !username || !payload.password || !payload.deviceId.trim()) {
      throw badRequest('VALIDATION_ERROR', 'Missing login fields')
    }

    await assertLoginInfrastructure(logger, diagnostics)

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
    diagnostics.tenantFound = Boolean(tenant)
    if (!tenant) {
      writeLog(logger, 'warn', { ...diagnostics }, 'tenant login failed: tenant not found')
      throw notFound('TENANT_NOT_FOUND', 'Tenant not found')
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
    diagnostics.userFound = Boolean(user)
    diagnostics.passwordHashPresent = Boolean(user?.password_hash)
    if (!user) {
      writeLog(logger, 'warn', { ...diagnostics }, 'tenant login failed: user not found')
      throw unauthorized('USER_NOT_FOUND', 'User not found')
    }
    if (!user.is_active) {
      throw unauthorized('USER_NOT_ACTIVE', 'User is not active')
    }
    if (!user.password_hash) {
      throw internalServerError('USER_PASSWORD_HASH_MISSING', 'User password hash is missing')
    }

    const ok = await verifyPassword(payload.password, user.password_hash)
    diagnostics.bcryptCompareSucceeded = ok
    if (!ok) {
      writeLog(logger, 'warn', { ...diagnostics }, 'tenant login failed: invalid password')
      throw unauthorized('INVALID_TENANT_LOGIN', 'Invalid username or password')
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
    writeLog(logger, 'info', { ...diagnostics }, 'tenant login succeeded')
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
  } catch (error) {
    const infrastructureReason = classifyAuthFailure(error)
    writeLog(
      logger,
      'error',
      {
        ...diagnostics,
        infrastructureReason: infrastructureReason || undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
      },
      'tenant login failed',
    )
    if (isAppError(error)) {
      throw error
    }
    if (infrastructureReason) {
      throw internalServerError('AUTH_INFRASTRUCTURE_ERROR', infrastructureReason)
    }
    throw internalServerError('AUTH_LOGIN_FAILED', 'Internal server error')
  }
}
