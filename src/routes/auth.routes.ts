import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { tenantMiddleware } from '../middlewares/tenant.middleware.js'
import { loginTenantUser } from '../services/auth.service.js'

const tenantLoginSchema = z.object({
  tenantCode: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  deviceId: z.string().min(1),
  deviceName: z.string().optional().default(''),
  windowsUsername: z.string().optional().default(''),
  machineFingerprint: z.string().optional().default(''),
})

export const registerAuthRoutes = async (app: FastifyInstance) => {
  const loginPaths = ['/auth/login', '/api/auth/login', '/api/v1/auth/login']
  const mePaths = ['/auth/me', '/api/auth/me', '/api/v1/auth/me']

  for (const routePath of loginPaths) {
    app.post(routePath, async (request) => {
      try {
        const body = tenantLoginSchema.parse(request.body)
        return await loginTenantUser({
          ...body,
          ipAddress: String(request.ip || ''),
          logger: request.log,
        })
      } catch (error) {
        request.log.error(
          {
            err: error,
            routePath,
            tenantCode: String((request.body as { tenantCode?: unknown } | undefined)?.tenantCode || '').trim().toUpperCase(),
            username: String((request.body as { username?: unknown } | undefined)?.username || '').trim().toLowerCase(),
          },
          'tenant login endpoint failed',
        )
        throw error
      }
    })
  }

  for (const routePath of mePaths) {
    app.get(routePath, { preHandler: tenantMiddleware }, async (request) => ({
      success: true,
      tenant: {
        id: request.tenantUser!.tenantId,
        code: request.tenantUser!.tenantCode,
      },
      user: {
        id: request.tenantUser!.userId,
        username: request.tenantUser!.username,
        role: request.tenantUser!.role,
        permissions: request.tenantUser!.permissions,
      },
      deviceId: request.tenantUser!.deviceId,
    }))
  }
}
