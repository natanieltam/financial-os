export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type UseApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  headers?: Record<string, string>
}

/** Thin typed client for our server API. Never touches the database directly. */
export async function useApi<T>(url: string, options: UseApiOptions = {}): Promise<T> {
  const query = options.query
    ? Object.fromEntries(
        Object.entries(options.query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => [k, String(v)]),
      )
    : undefined
  const res = await $fetch<{ data?: T } & Record<string, unknown>>(url, {
    method: options.method ?? 'GET',
    body: options.body as never,
    query: query as never,
    headers: options.headers,
  })
  const payload = res as { data?: T }
  return (payload.data !== undefined ? payload.data : (res as unknown as T))
}

/** Extract a safe error message from an ApiRequestError-like failure. */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Please try again.'
}

/** Nuxt $fetch rejects with FetchError; normalize status/code. */
export function toRequestError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error
  const e = error as { status?: number; statusCode?: number; data?: { code?: string; message?: string } }
  const status = e?.status ?? e?.statusCode ?? 500
  return new ApiRequestError(
    status,
    e?.data?.code ?? 'INTERNAL_ERROR',
    e?.data?.message ?? 'Request failed',
  )
}
