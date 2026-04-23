import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { tenantMiddleware } from '../middlewares/tenant.middleware.js'
import {
  cancelMigration,
  checkExistingMigration,
  finalizeMigration,
  getMigrationReport,
  getMigrationStatus,
  initMigration,
  prepareMigrationTenantDb,
  saveMigrationBatch,
  validateMigrationAccess,
} from '../services/migration.service.js'

const checkExistingSchema = z.object({
  sourceDbFingerprint: z.string().min(1),
})

const initSchema = z.object({
  tenantCode: z.string().optional(),
  sourceAppVersion: z.string().optional(),
  sourceDbFingerprint: z.string().min(1),
  sourceDbPath: z.string().optional(),
  backupPath: z.string().min(1),
  countsBefore: z.record(z.string(), z.unknown()).optional(),
  totalsBefore: z.record(z.string(), z.unknown()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  forceRepeat: z.boolean().optional(),
})

const batchSchema = z.object({
  migrationId: z.string().uuid(),
  entityType: z.string().min(1),
  batchIndex: z.number().int().min(1),
  totalBatches: z.number().int().min(1),
  records: z.array(z.record(z.string(), z.unknown())),
})

const finalizeSchema = z.object({
  migrationId: z.string().uuid(),
  totalsAfter: z.record(z.string(), z.unknown()).optional(),
})

export const registerMigrationRoutes = async (app: FastifyInstance) => {
  const validatePaths = ['/migration/validate', '/api/migration/validate', '/api/v1/migration/validate']
  const previewPaths = ['/migration/preview', '/api/migration/preview', '/api/v1/migration/preview']
  const checkExistingPaths = ['/migration/check-existing', '/api/migration/check-existing', '/api/v1/migration/check-existing']
  const initPaths = ['/migration/init', '/api/migration/init', '/api/v1/migration/init']
  const startPaths = ['/migration/start', '/api/migration/start', '/api/v1/migration/start']
  const preparePaths = ['/migration/prepare-tenant-db', '/api/migration/prepare-tenant-db', '/api/v1/migration/prepare-tenant-db']
  const batchPaths = ['/migration/batch', '/api/migration/batch', '/api/v1/migration/batch']
  const executePaths = ['/migration/execute', '/api/migration/execute', '/api/v1/migration/execute']
  const finalizePaths = ['/migration/finalize', '/api/migration/finalize', '/api/v1/migration/finalize']
  const genericStatusPaths = ['/migration/status', '/api/migration/status', '/api/v1/migration/status']
  const statusPaths = ['/migration/:migrationId/status', '/api/migration/:migrationId/status', '/api/v1/migration/:migrationId/status']
  const reportPaths = ['/migration/:migrationId/report', '/api/migration/:migrationId/report', '/api/v1/migration/:migrationId/report']
  const cancelPaths = ['/migration/:migrationId/cancel', '/api/migration/:migrationId/cancel', '/api/v1/migration/:migrationId/cancel']

  for (const routePath of validatePaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) =>
      validateMigrationAccess(request.tenantUser!),
    )
  }

  for (const routePath of previewPaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) =>
      validateMigrationAccess(request.tenantUser!),
    )
  }

  for (const routePath of checkExistingPaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) => {
      const body = checkExistingSchema.parse(request.body)
      return checkExistingMigration(request.tenantUser!, body.sourceDbFingerprint)
    })
  }

  for (const routePath of initPaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) => {
      const body = initSchema.parse(request.body)
      return initMigration(request.tenantUser!, body)
    })
  }

  for (const routePath of startPaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) => {
      const body = initSchema.parse(request.body)
      return initMigration(request.tenantUser!, body)
    })
  }

  for (const routePath of preparePaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) =>
      prepareMigrationTenantDb(request.tenantUser!),
    )
  }

  for (const routePath of batchPaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) => {
      const body = batchSchema.parse(request.body)
      return saveMigrationBatch(request.tenantUser!, body)
    })
  }

  for (const routePath of executePaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) => {
      const body = batchSchema.parse(request.body)
      return saveMigrationBatch(request.tenantUser!, body)
    })
  }

  for (const routePath of finalizePaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) => {
      const body = finalizeSchema.parse(request.body)
      return finalizeMigration(request.tenantUser!, body)
    })
  }

  for (const routePath of genericStatusPaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) => {
      const body = z.object({ migrationId: z.string().uuid() }).parse(request.body)
      return getMigrationStatus(request.tenantUser!, body.migrationId)
    })
  }

  for (const routePath of statusPaths) {
    app.get(routePath, { preHandler: tenantMiddleware }, async (request) => {
      const params = z.object({ migrationId: z.string().uuid() }).parse(request.params)
      return getMigrationStatus(request.tenantUser!, params.migrationId)
    })
  }

  for (const routePath of reportPaths) {
    app.get(routePath, { preHandler: tenantMiddleware }, async (request) => {
      const params = z.object({ migrationId: z.string().uuid() }).parse(request.params)
      return getMigrationReport(request.tenantUser!, params.migrationId)
    })
  }

  for (const routePath of cancelPaths) {
    app.post(routePath, { preHandler: tenantMiddleware }, async (request) => {
      const params = z.object({ migrationId: z.string().uuid() }).parse(request.params)
      return cancelMigration(request.tenantUser!, params.migrationId)
    })
  }
}
