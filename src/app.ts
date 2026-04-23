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

  app.setErrorHandler((error, request, reply) => {
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
      const logMethod = error.statusCode >= 500 ? request.log.error.bind(request.log) : request.log.warn.bind(request.log)
      logMethod(
        {
          err: error,
          errorCode: error.errorCode,
          statusCode: error.statusCode,
          method: request.method,
          url: request.url,
        },
        'request failed with application error',
      )
      reply.status(error.statusCode).send({
        success: false,
        errorCode: error.errorCode,
        message: error.message,
      })
      return
    }
    const fastifyStatusCode = Number((error as { statusCode?: unknown })?.statusCode || 0)
    const fastifyErrorCode = String((error as { code?: unknown })?.code || 'BAD_REQUEST')
    if (fastifyStatusCode >= 400 && fastifyStatusCode < 500) {
      request.log.warn(
        {
          err: error,
          errorCode: fastifyErrorCode,
          statusCode: fastifyStatusCode,
          method: request.method,
          url: request.url,
        },
        'request failed before reaching route handler',
      )
      reply.status(fastifyStatusCode).send({
        success: false,
        errorCode: fastifyErrorCode,
        message: error instanceof Error ? error.message : 'Bad request',
      })
      return
    }
    const message = error instanceof Error ? error.message : 'Internal server error'
    request.log.error(
      {
        err: error,
        errorCode: 'INTERNAL_SERVER_ERROR',
        method: request.method,
        url: request.url,
      },
      'unhandled request error',
    )
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

  return app
}
