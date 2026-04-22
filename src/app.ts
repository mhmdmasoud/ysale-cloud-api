import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { AppError } from './utils/errors.js'
import { registerHealthRoutes } from './routes/health.routes.js'
import { registerAuthRoutes } from './routes/auth.routes.js'
import { registerAdminRoutes } from './routes/admin.routes.js'
import { registerMigrationRoutes } from './routes/migration.routes.js'

export const buildApp = async () => {
  const app = Fastify({
    logger: true,
  })

  await app.register(cors, { origin: true, credentials: true })
  await app.register(helmet)

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        message: error.issues[0]?.message || 'Invalid request',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      })
      return
    }
    if (error instanceof AppError) {
      if (error.statusCode === 401 && error.errorCode === 'UNAUTHORIZED' && error.message === 'Authorization token is required') {
        reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authorization token is required',
        })
        return
      }
      reply.status(error.statusCode).send({
        success: false,
        errorCode: error.errorCode,
        message: error.message,
      })
      return
    }
    const message = error instanceof Error ? error.message : 'Internal server error'
    reply.status(500).send({
      success: false,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message,
    })
  })

  await registerHealthRoutes(app)
  await registerAuthRoutes(app)
  await registerAdminRoutes(app)
  await registerMigrationRoutes(app)

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      errorCode: 'ROUTE_NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
    })
  })

  return app
}
