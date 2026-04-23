export class AppError extends Error {
  statusCode: number
  errorCode: string

  constructor(statusCode: number, errorCode: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.errorCode = errorCode
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message)
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Unauthorized') =>
  new AppError(401, code, message)
export const forbidden = (code = 'FORBIDDEN', message = 'Forbidden') =>
  new AppError(403, code, message)
export const notFound = (code = 'NOT_FOUND', message = 'Not found') =>
  new AppError(404, code, message)
export const conflict = (code = 'CONFLICT', message = 'Conflict') =>
  new AppError(409, code, message)
export const internalServerError = (code = 'INTERNAL_SERVER_ERROR', message = 'Internal server error') =>
  new AppError(500, code, message)
