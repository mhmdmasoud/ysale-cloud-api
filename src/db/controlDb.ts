import pg from 'pg'
import { loadEnv } from '../config/env.js'

let pool: pg.Pool | null = null

const getPool = () => {
  if (pool) return pool
  const env = loadEnv()
  pool = new pg.Pool({
    connectionString: env.CONTROL_DATABASE_URL,
    ssl: env.CONTROL_DATABASE_URL.includes('supabase.com')
      ? { rejectUnauthorized: false }
      : undefined,
    max: 10,
  })
  return pool
}

export const controlDb = {
  query: <T extends pg.QueryResultRow = any>(text: string, params?: unknown[]) =>
    getPool().query<T>(text, params),
  connect: () => getPool().connect(),
}

export const closeControlDb = async () => {
  if (!pool) return
  await pool.end()
  pool = null
}
