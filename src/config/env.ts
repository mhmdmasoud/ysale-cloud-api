import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4545),
  NODE_ENV: z.string().default('development'),
  CONTROL_DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(24),
  SYSTEM_ADMIN_USERNAME: z.string().min(1).default('admin'),
  SYSTEM_ADMIN_PASSWORD: z.string().min(8).default('change_me_please'),
})

export type Env = z.infer<typeof envSchema>

export const missingControlDatabaseMessage =
  'CONTROL_DATABASE_URL is missing. Copy .env.example to .env and add your database connection string.'

let cachedEnv: Env | null = null

export const loadEnv = (): Env => {
  if (cachedEnv) return cachedEnv
  const raw = {
    PORT: process.env.PORT ?? 4545,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    CONTROL_DATABASE_URL: process.env.CONTROL_DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    SYSTEM_ADMIN_USERNAME: process.env.SYSTEM_ADMIN_USERNAME ?? 'admin',
    SYSTEM_ADMIN_PASSWORD: process.env.SYSTEM_ADMIN_PASSWORD ?? 'change_me_please',
  }

  if (!raw.CONTROL_DATABASE_URL || raw.CONTROL_DATABASE_URL === 'PUT_YOUR_SUPABASE_DATABASE_URL_HERE') {
    throw new Error(missingControlDatabaseMessage)
  }

  const parsed = envSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`Invalid environment variable ${issue?.path?.join('.') || ''}: ${issue?.message || 'invalid value'}`)
  }
  cachedEnv = parsed.data
  return cachedEnv
}
