import pg from 'pg'
import { loadEnv } from '../config/env.js'
import { describeDatabaseUrl } from './connectionDiagnostics.js'

let pool: pg.Pool | null = null

const getPool = () => {
  if (pool) return pool
  const env = loadEnv()
  console.info('[db] opening control database connection', describeDatabaseUrl(env.CONTROL_DATABASE_URL, 'CONTROL_DATABASE_URL'))
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
