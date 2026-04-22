import jwt from 'jsonwebtoken'
import { loadEnv } from '../config/env.js'

export type AdminJwtPayload = {
  tokenType: 'system-admin'
  adminId: string
  username: string
}

export type TenantJwtPayload = {
  tokenType: 'tenant-user'
  tenantId: string
  tenantCode: string
  userId: string
  username: string
  role: string
  permissions: Record<string, unknown>
  deviceId: string
}

export const signAdminToken = (payload: AdminJwtPayload) =>
  jwt.sign(payload, loadEnv().JWT_SECRET, { expiresIn: '8h' })

export const signTenantToken = (payload: TenantJwtPayload) =>
  jwt.sign(payload, loadEnv().JWT_SECRET, { expiresIn: '12h' })

export const verifyToken = <T>(token: string) => jwt.verify(token, loadEnv().JWT_SECRET) as T
