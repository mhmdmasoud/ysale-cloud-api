import type { FastifyReply, FastifyRequest } from 'fastify'
import { forbidden, unauthorized } from '../utils/errors.js'
import { type AdminJwtPayload, type TenantJwtPayload, verifyToken } from '../utils/jwt.js'

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminJwtPayload
    tenantUser?: TenantJwtPayload
  }
}

const extractBearerToken = (request: FastifyRequest) => {
  const authHeader = String(request.headers.authorization || '')
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    throw unauthorized()
  }
  return authHeader.slice(7).trim()
}

const extractDeveloperToken = (request: FastifyRequest) => {
  const authHeader = String(request.headers.authorization || '')
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim()
  }
  const developerToken = String(request.headers['x-developer-token'] || '').trim()
  if (developerToken) {
    return developerToken
  }
  throw unauthorized('DEVELOPER_TOKEN_REQUIRED', 'Developer token is required')
}

export const requireAdminToken = async (request: FastifyRequest, _reply: FastifyReply) => {
  const token = extractDeveloperToken(request)
  let payload: AdminJwtPayload
  try {
    payload = verifyToken<AdminJwtPayload>(token)
  } catch {
    throw unauthorized('INVALID_DEVELOPER_TOKEN', 'Developer token is invalid or expired')
  }
  if (payload.tokenType !== 'system-admin') {
    throw forbidden('INSUFFICIENT_DEVELOPER_SCOPE', 'Developer token does not have admin access')
  }
  request.admin = payload
}

export const requireTenantToken = async (request: FastifyRequest, _reply: FastifyReply) => {
  const token = extractBearerToken(request)
  let payload: TenantJwtPayload
  try {
    payload = verifyToken<TenantJwtPayload>(token)
  } catch {
    throw unauthorized('INVALID_TENANT_TOKEN', 'Tenant token is invalid or expired')
  }
  if (payload.tokenType !== 'tenant-user') {
    throw forbidden('INSUFFICIENT_TENANT_SCOPE', 'Token does not grant tenant access')
  }
  request.tenantUser = payload
}
