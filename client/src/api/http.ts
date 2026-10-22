import type { ApiErrorCode, ApiErrorDetail, ApiErrorResponse } from '@lc-projecthub/shared'

/** Any failure to get a usable answer from the API. `status` is 0 when the server could not be reached. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: ApiErrorCode
  /** Field-level problems from a 400 response, when the server supplied them. */
  readonly details: ApiErrorDetail[]

  constructor(message: string, status: number, code?: ApiErrorCode, details: ApiErrorDetail[] = []) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.details = details
  }
}

const baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? ''

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  const error = (value as ApiErrorResponse | null)?.error
  return typeof error?.message === 'string' && typeof error?.code === 'string'
}

async function requestJson<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      signal,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('The server could not be reached. Check your connection and try again.', 0)
  }

  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    parsed = undefined
  }

  if (!response.ok) {
    if (isApiErrorResponse(parsed)) {
      const { message, code, details } = parsed.error
      throw new ApiRequestError(message, response.status, code, Array.isArray(details) ? details : [])
    }
    const message =
      response.status >= 500
        ? 'The server is currently unavailable. Please try again shortly.'
        : 'The server returned an unexpected response.'
    throw new ApiRequestError(message, response.status)
  }
  return parsed as T
}

export function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>('GET', path, undefined, signal)
}

export function sendJson<T>(method: 'POST' | 'PUT', path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(method, path, body, signal)
}
