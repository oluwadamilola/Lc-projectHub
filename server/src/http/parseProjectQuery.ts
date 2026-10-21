import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PROJECT_STATUSES,
  type ApiErrorDetail,
  type ProjectStatus,
} from '@lc-projecthub/shared'
import type { ProjectSearchCriteria } from '../domain/projectRepository.js'
import { ValidationError } from '../errors.js'
import {
  MAX_PAGE,
  isValidReference,
  readInteger,
  readSearch,
  readText,
  rejectUnknownParameters,
} from './queryParsing.js'

const KNOWN_PARAMETERS = ['q', 'status', 'page', 'pageSize']

function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value)
}

/** Turns raw query-string values into trusted search criteria, or throws a ValidationError listing every problem. */
export function parseProjectQuery(query: Record<string, unknown>): ProjectSearchCriteria {
  const errors: ApiErrorDetail[] = []

  rejectUnknownParameters(query, KNOWN_PARAMETERS, errors)
  const search = readSearch(query, errors)

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

/** Validates the shape of a reference taken from the address (the route parameter name is used in the message). */
export function parseReference(value: string, field = 'id'): string {
  if (!isValidReference(value)) {
    throw new ValidationError([{ field, message: 'Must be 1 to 32 letters, numbers or hyphens.' }])
  }
  return value
}

export function parseProjectId(id: string): string {
  return parseReference(id, 'id')
}
