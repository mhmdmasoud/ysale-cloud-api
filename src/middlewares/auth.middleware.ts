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
    throw unauthorized('UNAUTHORIZED', 'Authorization token is required')
  }
  const token = authHeader.slice(7).trim()
  if (!token) {
    throw unauthorized('UNAUTHORIZED', 'Authorization token is required')
  }
  return token
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
  if (request.tenantUser) {
    return
  }
  const token = extractBearerToken(request)
  let payload: TenantJwtPayload
  try {
    payload = verifyToken<TenantJwtPayload>(token)
  } catch {
    throw unauthorized('UNAUTHORIZED', 'Authorization token is required')
  }
  if (payload.tokenType !== 'tenant-user') {
    throw unauthorized('UNAUTHORIZED', 'Authorization token is required')
  }
  request.tenantUser = payload
}

export const requireMigrationAuthorization = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = String(request.headers.authorization || '').trim()
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    await reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Authorization token is required',
    })
    return reply
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    await reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Authorization token is required',
    })
    return reply
  }

  try {
    const payload = verifyToken<TenantJwtPayload>(token)
    if (payload.tokenType !== 'tenant-user') {
      await reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Authorization token is required',
      })
      return reply
    }
    request.tenantUser = payload
  } catch {
    await reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Authorization token is required',
    })
    return reply
  }
}
