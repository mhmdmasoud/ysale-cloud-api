export type DatabaseConnectionDiagnostics = {
  source: string
  configured: boolean
  validPostgresUrl: boolean
  protocol: string
  host: string
  port: string
  database: string
  username: string
  parseError?: string
}

const redactUsername = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.length <= 2 ? '**' : `${raw.slice(0, 2)}***`
}

export const describeDatabaseUrl = (
  databaseUrl: string | null | undefined,
  source: string,
): DatabaseConnectionDiagnostics => {
  const raw = String(databaseUrl || '').trim()
  if (!raw) {
    return {
      source,
      configured: false,
      validPostgresUrl: false,
      protocol: '',
      host: '',
      port: '',
      database: '',
      username: '',
    }
  }

  try {
    const parsed = new URL(raw)
    const protocol = parsed.protocol.replace(/:$/, '')
    return {
      source,
      configured: true,
      validPostgresUrl: protocol === 'postgres' || protocol === 'postgresql',
      protocol,
      host: parsed.hostname,
      port: parsed.port,
      database: decodeURIComponent(parsed.pathname.replace(/^\/+/, '')),
      username: redactUsername(decodeURIComponent(parsed.username || '')),
    }
  } catch (error) {
    const hostLike = raw.split(/[/?#:@]/, 1)[0] || raw
    return {
      source,
      configured: true,
      validPostgresUrl: false,
      protocol: '',
      host: hostLike,
      port: '',
      database: '',
      username: '',
      parseError: error instanceof Error ? error.message : String(error),
    }
  }
}

export const isUsablePostgresUrl = (databaseUrl: string | null | undefined) =>
  describeDatabaseUrl(databaseUrl, 'validation').validPostgresUrl
