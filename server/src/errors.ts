import type { ApiErrorCode, ApiErrorDetail } from '@lc-projecthub/shared'

/** An error that is safe to describe to API clients. Anything else becomes a generic 500. */
export class AppError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details?: ApiErrorDetail[]

  constructor(status: number, code: ApiErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message)
    this.name = new.target.name
    this.status = status
    this.code = code
    this.details = details
  }
}

export class ValidationError extends AppError {
  constructor(details: ApiErrorDetail[]) {
    super(400, 'VALIDATION_ERROR', 'The request contains invalid values.', details)
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message)
  }
}
