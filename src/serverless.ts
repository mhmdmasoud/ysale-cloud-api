import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildApp } from './app.js'

let appPromise: ReturnType<typeof buildApp> | null = null

const getApp = async () => {
  if (!appPromise) {
    appPromise = buildApp().then(async (app) => {
      await app.ready()
      return app
    })
  }
  return appPromise
}

export const handleServerlessRequest = async (req: IncomingMessage, res: ServerResponse) => {
  const app = await getApp()
  app.server.emit('request', req, res)
}
