import { buildApp } from './app.js'
import { closeControlDb } from './db/controlDb.js'
import { closeTenantPools } from './db/tenantDb.js'

try {
  const port = Number(process.env.PORT || 4545)
  const app = await buildApp()
  await app.listen({
    host: '0.0.0.0',
    port: Number.isFinite(port) && port > 0 ? port : 4545,
  })
  console.log(`[ysale-cloud-api] listening on port ${Number.isFinite(port) && port > 0 ? port : 4545}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
}

const shutdown = async () => {
  await closeTenantPools().catch(() => {})
  await closeControlDb().catch(() => {})
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
