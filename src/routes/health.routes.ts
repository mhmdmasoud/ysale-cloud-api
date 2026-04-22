import type { FastifyInstance } from 'fastify'

export const registerHealthRoutes = async (app: FastifyInstance) => {
  for (const routePath of ['/health', '/api/health', '/api/v1/health']) {
    app.get(routePath, async () => ({
      ok: true,
      service: 'YSale Online Server',
      status: 'healthy',
    }))
  }
}
