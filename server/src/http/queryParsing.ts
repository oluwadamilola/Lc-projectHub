import { MAX_SEARCH_LENGTH, type ApiErrorDetail } from '@lc-projecthub/shared'

/*
  Small helpers for reading query-string and path values safely.
  Every function reports problems into `errors` instead of throwing, so a request can list all
  of its mistakes at once.
*/

export const MAX_PAGE = 100_000

/** References such as PRJ-101 or TASK-014: letters, digits and hyphens only. */
const REFERENCE_PATTERN = /^[A-Za-z0-9-]{1,32}$/

export function isValidReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value)
}

/** Reads an optional parameter that must appear at most once as plain text. Empty counts as absent. */
export function readText(query: Record<string, unknown>, field: string, errors: ApiErrorDetail[]): string | undefined {
  const raw = query[field]
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') {
    errors.push({ field, message: 'Provide a single text value.' })
    return undefined
  }
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Search text: optional, trimmed, limited in length. */
export function readSearch(query: Record<string, unknown>, errors: ApiErrorDetail[]): string | undefined {
  const search = readText(query, 'q', errors)
  if (search !== undefined && search.length > MAX_SEARCH_LENGTH) {
    errors.push({ field: 'q', message: `Must be at most ${MAX_SEARCH_LENGTH} characters.` })
  }
  return search
}

export function readInteger(
  query: Record<string, unknown>,
  field: string,
  { min, max, fallback }: { min: number; max: number; fallback: number },
  errors: ApiErrorDetail[],
): number {
  const raw = readText(query, field, errors)
  if (raw === undefined) return fallback
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors.push({ field, message: `Must be a whole number between ${min} and ${max}.` })
    return fallback
  }
  return value
}

/** A misspelt filter (for example "statuss") must fail loudly instead of silently returning unfiltered data. */
export function rejectUnknownParameters(
  query: Record<string, unknown>,
  known: readonly string[],
  errors: ApiErrorDetail[],
): void {
  for (const name of Object.keys(query)) {
    if (!known.includes(name)) {
      errors.push({ field: name, message: `Unknown parameter. Supported: ${known.join(', ')}.` })
    }
  }
}
