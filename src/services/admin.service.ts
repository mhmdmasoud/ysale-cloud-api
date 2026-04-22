import { controlDb } from '../db/controlDb.js'
import { unauthorized } from '../utils/errors.js'
import { signAdminToken } from '../utils/jwt.js'
import { verifyPassword } from '../utils/password.js'

export const loginSystemAdmin = async (username: string, password: string) => {
  const result = await controlDb.query<{
    id: string
    username: string
    password_hash: string
    is_active: boolean
  }>(
    `
      SELECT id, username, password_hash, is_active
      FROM system_admins
      WHERE username = $1
      LIMIT 1
    `,
    [username],
  )
  const admin = result.rows[0]
  if (!admin || !admin.is_active) {
    throw unauthorized('INVALID_ADMIN_LOGIN', 'Invalid username or password')
  }
  const ok = await verifyPassword(password, admin.password_hash)
  if (!ok) {
    throw unauthorized('INVALID_ADMIN_LOGIN', 'Invalid username or password')
  }
  const token = signAdminToken({
    tokenType: 'system-admin',
    adminId: admin.id,
    username: admin.username,
  })
  return {
    success: true,
    token,
    admin: {
      id: admin.id,
      username: admin.username,
    },
  }
}
