import { defineEventHandler, setResponseStatus, type H3Event } from 'h3'
import { ZodError } from 'zod'

/** Standardized API error codes (PRD §54). */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export class ApiError extends Error {
  readonly statusCode: number
  readonly code: ApiErrorCode

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

export const apiErrors = {
  unauthorized: (message = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have access to this resource') =>
    new ApiError(403, 'FORBIDDEN', message),
  notFound: (message = 'Resource not found') => new ApiError(404, 'NOT_FOUND', message),
  conflict: (message = 'Resource already exists') => new ApiError(409, 'CONFLICT', message),
  rateLimited: (message = 'Too many requests. Please try again later.') =>
    new ApiError(429, 'RATE_LIMITED', message),
  validation: (message = 'Invalid request') => new ApiError(400, 'VALIDATION_ERROR', message),
  internal: () => new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong'),
}

export interface ApiSuccess<T> {
  success: true
  data: T
}

export interface ApiFailure {
  success: false
  error: { code: ApiErrorCode; message: string }
}

/**
 * Wraps an API route: standardized success/error envelope, never leaks stack
 * traces, SQL, paths or secrets (PRD §54, §56).
 */
export function apiHandler<T>(handler: (event: H3Event) => Promise<T> | T) {
  return defineEventHandler(async (event): Promise<ApiSuccess<T> | ApiFailure> => {
    try {
      const data = await handler(event)
      return { success: true, data }
    } catch (err) {
      if (err instanceof ApiError) {
        setResponseStatus(event, err.statusCode)
        return { success: false, error: { code: err.code, message: err.message } }
      }
      if (err instanceof ZodError) {
        setResponseStatus(event, 400)
        // Safe authored validation text only — never internals (PRD §54, §56).
        const first = err.issues[0]
        const message = first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid request'
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        }
      }
      // Client-side HTTP errors raised by h3 itself (e.g. malformed JSON body).
      const status = (err as { statusCode?: unknown } | null)?.statusCode
      if (typeof status === 'number' && status >= 400 && status < 500) {
        setResponseStatus(event, status)
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
        }
      }
      console.error('[api] unhandled error:', err)
      setResponseStatus(event, 500)
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
      }
    }
  })
}
