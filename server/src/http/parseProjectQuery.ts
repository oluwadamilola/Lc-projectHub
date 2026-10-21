import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  PROJECT_STATUSES,
  type ApiErrorDetail,
  type ProjectStatus,
} from '@lc-projecthub/shared'
import type { ProjectSearchCriteria } from '../domain/projectRepository.js'
import { ValidationError } from '../errors.js'

const MAX_PAGE = 100_000
const KNOWN_PARAMETERS = ['q', 'status', 'page', 'pageSize']
const PROJECT_ID_PATTERN = /^[A-Za-z0-9-]{1,32}$/

function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value)
}

/** Reads an optional parameter that must appear at most once as plain text. Empty counts as absent. */
function readText(query: Record<string, unknown>, field: string, errors: ApiErrorDetail[]): string | undefined {
  const raw = query[field]
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') {
    errors.push({ field, message: 'Provide a single text value.' })
    return undefined
  }
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

function readInteger(
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

/** Turns raw query-string values into trusted search criteria, or throws a ValidationError listing every problem. */
export function parseProjectQuery(query: Record<string, unknown>): ProjectSearchCriteria {
  const errors: ApiErrorDetail[] = []

  // A misspelt filter (for example "statuss") must fail loudly instead of silently returning unfiltered data.
  for (const name of Object.keys(query)) {
    if (!KNOWN_PARAMETERS.includes(name)) {
      errors.push({ field: name, message: `Unknown parameter. Supported: ${KNOWN_PARAMETERS.join(', ')}.` })
    }
  }

  const search = readText(query, 'q', errors)
  if (search !== undefined && search.length > MAX_SEARCH_LENGTH) {
    errors.push({ field: 'q', message: `Must be at most ${MAX_SEARCH_LENGTH} characters.` })
  }

  const statusText = readText(query, 'status', errors)
  let status: ProjectStatus | undefined
  if (statusText !== undefined) {
    if (isProjectStatus(statusText)) {
      status = statusText
    } else {
      errors.push({ field: 'status', message: `Must be one of: ${PROJECT_STATUSES.join(', ')}.` })
    }
  }

  const page = readInteger(query, 'page', { min: 1, max: MAX_PAGE, fallback: 1 }, errors)
  const pageSize = readInteger(
    query,
    'pageSize',
    { min: 1, max: MAX_PAGE_SIZE, fallback: DEFAULT_PAGE_SIZE },
    errors,
  )

  if (errors.length > 0) throw new ValidationError(errors)
  return { search, status, page, pageSize }
}

export function parseProjectId(id: string): string {
  if (!PROJECT_ID_PATTERN.test(id)) {
    throw new ValidationError([{ field: 'id', message: 'Must be 1 to 32 letters, numbers or hyphens.' }])
  }
  return id
}
