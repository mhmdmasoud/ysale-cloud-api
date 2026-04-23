import type { FastifyBaseLogger } from 'fastify'
import { controlDb } from '../db/controlDb.js'
import { internalServerError, unauthorized, type AppError } from '../utils/errors.js'
import { loadEnv } from '../config/env.js'
import { signAdminToken } from '../utils/jwt.js'
import { verifyPassword } from '../utils/password.js'

type AdminLogger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>

const isAppError = (error: unknown): error is AppError => error instanceof Error && 'statusCode' in error && 'errorCode' in error

const classifyAdminFailure = (error: unknown) => {
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

const writeLog = (logger: AdminLogger | Console, level: 'info' | 'warn' | 'error', payload: Record<string, unknown>, message: string) => {
  const target = logger as Record<string, (...args: unknown[]) => void>
  if (logger === console) {
    target[level](message, payload)
    return
  }
  target[level](payload, message)
}

export const loginSystemAdmin = async (username: string, password: string, logger: AdminLogger | Console = console) => {
  const normalizedUsername = String(username || '').trim()
  const diagnostics = {
    username: normalizedUsername,
    adminFound: false,
    passwordHashPresent: false,
    bcryptCompareSucceeded: false,
  }

  try {
    loadEnv()
    const result = await controlDb.query<{
      id: string
      username: string
      password_hash: string
      is_active: boolean
    }>(
      `
        SELECT id, username, password_hash, is_active
        FROM system_admins
        WHERE username = $1
        LIMIT 1
      `,
      [normalizedUsername],
    )
    const admin = result.rows[0]
    diagnostics.adminFound = Boolean(admin)
    diagnostics.passwordHashPresent = Boolean(admin?.password_hash)
    if (!admin || !admin.is_active) {
      writeLog(logger, 'warn', diagnostics, 'system admin login failed: admin not found or inactive')
      throw unauthorized('INVALID_ADMIN_LOGIN', 'Invalid username or password')
    }
    const ok = await verifyPassword(password, admin.password_hash)
    diagnostics.bcryptCompareSucceeded = ok
    if (!ok) {
      writeLog(logger, 'warn', diagnostics, 'system admin login failed: invalid password')
      throw unauthorized('INVALID_ADMIN_LOGIN', 'Invalid username or password')
    }
    const token = signAdminToken({
      tokenType: 'system-admin',
      adminId: admin.id,
      username: admin.username,
    })
    writeLog(logger, 'info', diagnostics, 'system admin login succeeded')
    return {
      success: true,
      token,
      admin: {
        id: admin.id,
        username: admin.username,
      },
    }
  } catch (error) {
    const infrastructureReason = classifyAdminFailure(error)
    writeLog(
      logger,
      'error',
      {
        ...diagnostics,
        infrastructureReason: infrastructureReason || undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
      },
      'system admin login failed',
    )
    if (isAppError(error)) {
      throw error
    }
    if (infrastructureReason) {
      throw internalServerError('AUTH_INFRASTRUCTURE_ERROR', infrastructureReason)
    }
    throw internalServerError('ADMIN_AUTH_FAILED', 'Internal server error')
  }
}
