import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  TASK_DUE_FILTERS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TECHNICIAN_ID_PATTERN,
  UNASSIGNED_FILTER,
  isIsoDate,
  toIsoDate,
  type ApiErrorDetail,
  type TaskDueFilter,
  type TaskPriority,
  type TaskStatus,
} from '@lc-projecthub/shared'
import type { AllTasksCriteria } from '../domain/taskRepository.js'
import { ValidationError } from '../errors.js'
import { MAX_PAGE, isValidReference, readInteger, readSearch, readText, rejectUnknownParameters } from './queryParsing.js'

const KNOWN_PARAMETERS = ['q', 'project', 'status', 'priority', 'assignee', 'due', 'today', 'page', 'pageSize']

/** Reads an optional parameter that must be one of `allowed`; anything else is reported against `field`. */
function readChoice<T extends string>(
  query: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  errors: ApiErrorDetail[],
): T | undefined {
  const text = readText(query, field, errors)
  if (text === undefined) return undefined
  const match = allowed.find((option) => option === text)
  if (match === undefined) errors.push({ field, message: `Must be one of: ${allowed.join(', ')}.` })
  return match
}

/**
 * Turns raw query-string values into trusted criteria for GET /api/tasks, or throws listing every problem.
 * `now` is only used when the caller does not say which day it is (`today`).
 */
export function parseAllTasksQuery(query: Record<string, unknown>, now: Date = new Date()): AllTasksCriteria {
  const errors: ApiErrorDetail[] = []

  rejectUnknownParameters(query, KNOWN_PARAMETERS, errors)
  const search = readSearch(query, errors)

  const projectId = readText(query, 'project', errors)
  if (projectId !== undefined && !isValidReference(projectId)) {
    errors.push({ field: 'project', message: 'Must be a project reference such as PRJ-101.' })
  }

  const status: TaskStatus | undefined = readChoice(query, 'status', TASK_STATUSES, errors)
  const priority: TaskPriority | undefined = readChoice(query, 'priority', TASK_PRIORITIES, errors)

  const assignee = readText(query, 'assignee', errors)
  if (assignee !== undefined && assignee !== UNASSIGNED_FILTER && !TECHNICIAN_ID_PATTERN.test(assignee)) {
    errors.push({
      field: 'assignee',
      message: `Must be a technician reference such as TECH-001, or "${UNASSIGNED_FILTER}".`,
    })
  }

  const due: TaskDueFilter | undefined = readChoice(query, 'due', TASK_DUE_FILTERS, errors)

  let today = toIsoDate(now)
  const todayText = readText(query, 'today', errors)
  if (todayText !== undefined) {
    if (isIsoDate(todayText)) today = todayText
    else errors.push({ field: 'today', message: 'Must be a real calendar date written as YYYY-MM-DD.' })
  }

  const page = readInteger(query, 'page', { min: 1, max: MAX_PAGE, fallback: 1 }, errors)
  const pageSize = readInteger(query, 'pageSize', { min: 1, max: MAX_PAGE_SIZE, fallback: DEFAULT_PAGE_SIZE }, errors)

  if (errors.length > 0) throw new ValidationError(errors)
  return { projectId, search, status, priority, assignee, due, today, page, pageSize }
}
