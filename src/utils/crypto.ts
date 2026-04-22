import crypto from 'node:crypto'

export const createOpaqueId = (prefix: string) =>
  `${prefix}_${crypto.randomBytes(16).toString('hex')}`

export const maskDatabaseUrl = (databaseUrl: string) => {
  try {
    const parsed = new URL(databaseUrl)
    if (parsed.password) parsed.password = '****'
    return parsed.toString()
  } catch {
    return databaseUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@')
  }
}
