import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  TASK_STATUSES,
  TECHNICIAN_ID_PATTERN,
  UNASSIGNED_FILTER,
  type ApiErrorDetail,
  type TaskStatus,
} from '@lc-projecthub/shared'
import type { TaskSearchCriteria } from '../domain/taskRepository.js'
import { ValidationError } from '../errors.js'
import { MAX_PAGE, readInteger, readSearch, readText, rejectUnknownParameters } from './queryParsing.js'

const KNOWN_PARAMETERS = ['q', 'status', 'assignee', 'page', 'pageSize']

function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value)
}

/** Turns raw query-string values into trusted search criteria for one project, or throws listing every problem. */
export function parseTaskQuery(projectId: string, query: Record<string, unknown>): TaskSearchCriteria {
  const errors: ApiErrorDetail[] = []

  rejectUnknownParameters(query, KNOWN_PARAMETERS, errors)
  const search = readSearch(query, errors)

  const statusText = readText(query, 'status', errors)
  let status: TaskStatus | undefined
  if (statusText !== undefined) {
    if (isTaskStatus(statusText)) status = statusText
    else errors.push({ field: 'status', message: `Must be one of: ${TASK_STATUSES.join(', ')}.` })
  }

  const assignee = readText(query, 'assignee', errors)
  if (assignee !== undefined && assignee !== UNASSIGNED_FILTER && !TECHNICIAN_ID_PATTERN.test(assignee)) {
    errors.push({
      field: 'assignee',
      message: `Must be a technician reference such as TECH-001, or "${UNASSIGNED_FILTER}".`,
    })
  }

  const page = readInteger(query, 'page', { min: 1, max: MAX_PAGE, fallback: 1 }, errors)
  const pageSize = readInteger(query, 'pageSize', { min: 1, max: MAX_PAGE_SIZE, fallback: DEFAULT_PAGE_SIZE }, errors)

  if (errors.length > 0) throw new ValidationError(errors)
  return { projectId, search, status, assignee, page, pageSize }
}
