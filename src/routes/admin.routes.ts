import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { loginSystemAdmin } from '../services/admin.service.js'
import { createTenant, getTenantDashboard, listTenants, updateTenant } from '../services/tenants.service.js'
import { adminMiddleware } from '../middlewares/admin.middleware.js'
import {
  createTenantUser,
  deleteTenantUser,
  getTenantByCodeForAdmin,
  listTenantUsers,
  resetTenantUserPassword,
  setTenantUserStatus,
  updateTenantUser,
} from '../services/tenantUsers.service.js'

const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const tenantCodeParamsSchema = z.object({
  tenantCode: z.string().min(1),
})

const tenantUserParamsSchema = z.object({
  tenantCode: z.string().min(1),
  userId: z.string().uuid(),
})

const createTenantUserSchema = z.object({
  username: z.string().min(1),
  fullName: z.string().optional().default(''),
  password: z.string().min(6),
  role: z.enum(['admin', 'manager', 'cashier', 'accountant', 'viewer']),
  isActive: z.boolean().optional().default(true),
  permissions: z.record(z.string(), z.unknown()).optional().default({}),
})

const updateTenantUserSchema = z.object({
  username: z.string().min(1).optional(),
  fullName: z.string().optional(),
  role: z.enum(['admin', 'manager', 'cashier', 'accountant', 'viewer']).optional(),
  isActive: z.boolean().optional(),
  permissions: z.record(z.string(), z.unknown()).optional(),
})

const resetPasswordSchema = z.object({
  password: z.string().min(6),
})

const statusSchema = z.object({
  isActive: z.boolean(),
})

const tenantMutationSchema = z.object({
  tenantCode: z.string().min(1),
  companyName: z.string().min(1),
  ownerName: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  adminUsername: z.string().min(1).optional(),
  adminPassword: z.string().min(6).optional(),
  adminFullName: z.string().optional(),
  operationMode: z.string().optional(),
  allowedDevices: z.number().int().min(1).optional(),
  trialDays: z.number().int().min(1).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  status: z.string().optional(),
  subscriptionStatus: z.string().optional(),
  tenantDatabaseUrl: z.string().optional(),
  serverUrl: z.string().optional(),
  serverPort: z.number().int().min(1).max(65535).optional(),
  serverHost: z.string().optional(),
  databasePath: z.string().optional(),
  useTailscale: z.boolean().optional(),
  autoStartServer: z.boolean().optional(),
  autoStartOnWindows: z.boolean().optional(),
})

const createTenantSchema = tenantMutationSchema.superRefine((value, ctx) => {
  const hasAdminUsername = Boolean(String(value.adminUsername || '').trim())
  const hasAdminPassword = Boolean(String(value.adminPassword || '').trim())
  if (hasAdminUsername !== hasAdminPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'adminUsername and adminPassword must be provided together',
      path: hasAdminUsername ? ['adminPassword'] : ['adminUsername'],
    })
  }
})

const updateTenantSchema = tenantMutationSchema.partial()

export const registerAdminRoutes = async (app: FastifyInstance) => {
  const loginPaths = [
    '/admin/login',
    '/api/admin/login',
    '/api/v1/admin/login',
    '/developer/auth/login',
    '/api/developer/auth/login',
    '/api/v1/developer/auth/login',
  ]
  const mePaths = [
    '/admin/me',
    '/api/admin/me',
    '/api/v1/admin/me',
    '/developer/auth/me',
    '/api/developer/auth/me',
    '/api/v1/developer/auth/me',
  ]
  const dashboardPaths = ['/admin/dashboard', '/api/admin/dashboard', '/api/v1/admin/dashboard']
  const tenantsPaths = ['/admin/tenants', '/api/admin/tenants', '/api/v1/admin/tenants']
  const tenantByCodePaths = ['/admin/tenants/:tenantCode', '/api/admin/tenants/:tenantCode', '/api/v1/admin/tenants/:tenantCode']
  const tenantUsersPaths = ['/admin/tenants/:tenantCode/users', '/api/admin/tenants/:tenantCode/users', '/api/v1/admin/tenants/:tenantCode/users']
  const tenantUserPaths = ['/admin/tenants/:tenantCode/users/:userId', '/api/admin/tenants/:tenantCode/users/:userId', '/api/v1/admin/tenants/:tenantCode/users/:userId']
  const tenantUserPasswordPaths = ['/admin/tenants/:tenantCode/users/:userId/password', '/api/admin/tenants/:tenantCode/users/:userId/password', '/api/v1/admin/tenants/:tenantCode/users/:userId/password']
  const tenantUserStatusPaths = ['/admin/tenants/:tenantCode/users/:userId/status', '/api/admin/tenants/:tenantCode/users/:userId/status', '/api/v1/admin/tenants/:tenantCode/users/:userId/status']

  for (const routePath of loginPaths) {
    app.post(routePath, async (request) => {
      const body = adminLoginSchema.parse(request.body)
      return loginSystemAdmin(body.username, body.password)
    })
  }

  for (const routePath of mePaths) {
    app.get(routePath, { preHandler: adminMiddleware }, async (request) => ({
      success: true,
      admin: {
        id: request.admin!.adminId,
        username: request.admin!.username,
      },
    }))
  }

  for (const routePath of dashboardPaths) {
    app.get(routePath, { preHandler: adminMiddleware }, async () => getTenantDashboard())
  }

  for (const routePath of tenantsPaths) {
    app.get(routePath, { preHandler: adminMiddleware }, async () => listTenants())
    app.post(routePath, { preHandler: adminMiddleware }, async (request) => {
      const body = createTenantSchema.parse(request.body)
      return createTenant(body)
    })
  }

  for (const routePath of tenantByCodePaths) {
    app.get(routePath, { preHandler: adminMiddleware }, async (request) => {
      const params = tenantCodeParamsSchema.parse(request.params)
      return getTenantByCodeForAdmin(params.tenantCode, { includeSecrets: true })
    })
    app.patch(routePath, { preHandler: adminMiddleware }, async (request) => {
      const params = tenantCodeParamsSchema.parse(request.params)
      const tenant = await getTenantByCodeForAdmin(params.tenantCode, { includeSecrets: false })
      const body = updateTenantSchema.parse(request.body)
      return updateTenant(tenant.id, body)
    })
  }

  for (const routePath of tenantUsersPaths) {
    app.get(routePath, { preHandler: adminMiddleware }, async (request) => {
      const params = tenantCodeParamsSchema.parse(request.params)
      return {
        success: true,
        users: await listTenantUsers(params.tenantCode),
      }
    })
    app.post(routePath, { preHandler: adminMiddleware }, async (request) => {
      const params = tenantCodeParamsSchema.parse(request.params)
      const body = createTenantUserSchema.parse(request.body)
      return createTenantUser(params.tenantCode, body)
    })
  }

  for (const routePath of tenantUserPaths) {
    app.patch(routePath, { preHandler: adminMiddleware }, async (request) => {
      const params = tenantUserParamsSchema.parse(request.params)
      const body = updateTenantUserSchema.parse(request.body)
      return updateTenantUser(params.tenantCode, params.userId, body)
    })
    app.delete(routePath, { preHandler: adminMiddleware }, async (request) => {
      const params = tenantUserParamsSchema.parse(request.params)
      return deleteTenantUser(params.tenantCode, params.userId)
    })
  }

  for (const routePath of tenantUserPasswordPaths) {
    app.patch(routePath, { preHandler: adminMiddleware }, async (request) => {
      const params = tenantUserParamsSchema.parse(request.params)
      const body = resetPasswordSchema.parse(request.body)
      return resetTenantUserPassword(params.tenantCode, params.userId, body.password)
    })
  }

  for (const routePath of tenantUserStatusPaths) {
    app.patch(routePath, { preHandler: adminMiddleware }, async (request) => {
      const params = tenantUserParamsSchema.parse(request.params)
      const body = statusSchema.parse(request.body)
      return setTenantUserStatus(params.tenantCode, params.userId, body.isActive)
    })
  }
}
