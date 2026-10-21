import type { ApiErrorCode, ApiErrorResponse } from '@lc-projecthub/shared'

/** Any failure to get a usable answer from the API. `status` is 0 when the server could not be reached. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: ApiErrorCode

  constructor(message: string, status: number, code?: ApiErrorCode) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

const baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? ''

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  const error = (value as ApiErrorResponse | null)?.error
  return typeof error?.message === 'string' && typeof error?.code === 'string'
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, { signal, headers: { Accept: 'application/json' } })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('The server could not be reached. Check your connection and try again.', 0)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  if (!response.ok) {
    if (isApiErrorResponse(body)) throw new ApiRequestError(body.error.message, response.status, body.error.code)
    const message =
      response.status >= 500
        ? 'The server is currently unavailable. Please try again shortly.'
        : 'The server returned an unexpected response.'
    throw new ApiRequestError(message, response.status)
  }
  return body as T
}
