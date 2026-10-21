import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ApiErrorDetail,
  type TaskInput,
  type TaskInputField,
} from './types.js'
import {
  checkChoice,
  checkDate,
  checkText,
  isPlainObject,
  rejectUnknownFields,
  sortByFieldOrder,
} from './validationHelpers.js'

/*
  Validation for creating and editing tasks. Shared by the server (authoritative) and the browser
  (instant feedback), exactly like the project validator.
  Whether the technician really exists is checked by the server, which knows the technician list.
*/

export const TASK_TEXT_LIMITS = { title: 120, description: 1000 } as const

/** Form order. Errors are reported in this order. */
export const TASK_INPUT_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'assigneeId',
  'startDate',
  'dueDate',
] as const satisfies readonly TaskInputField[]

/** Shape of a technician reference, for example "TECH-003". */
export const TECHNICIAN_ID_PATTERN = /^TECH-\d{3,6}$/

const LABELS: Record<TaskInputField, string> = {
  title: 'task title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assigneeId: 'technician',
  startDate: 'start date',
  dueDate: 'due date',
}

export type TaskValidationResult = { ok: true; value: TaskInput } | { ok: false; errors: ApiErrorDetail[] }

/**
 * Checks untrusted task input and returns either clean values (text trimmed) or every problem found.
 * `assigneeId` may be null (or left out) for an unassigned task; an empty string is not accepted.
 */
export function validateTaskInput(raw: unknown): TaskValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ field: 'body', message: 'Send the task as a JSON object.' }] }
  }
  const input = raw
  const errors: ApiErrorDetail[] = []

  const title = checkText('title', LABELS.title, input.title, { limit: TASK_TEXT_LIMITS.title, required: true, multiline: false }, errors)
  const description = checkText(
    'description',
    LABELS.description,
    input.description,
    { limit: TASK_TEXT_LIMITS.description, required: false, multiline: true },
    errors,
  )
  const status = checkChoice('status', LABELS.status, input.status, TASK_STATUSES, errors)
  const priority = checkChoice('priority', LABELS.priority, input.priority, TASK_PRIORITIES, errors)

  let assigneeId: string | null = null
  if (input.assigneeId !== undefined && input.assigneeId !== null) {
    if (typeof input.assigneeId === 'string' && TECHNICIAN_ID_PATTERN.test(input.assigneeId)) {
      assigneeId = input.assigneeId
    } else {
      errors.push({ field: 'assigneeId', message: 'Choose a technician from the list, or leave the task unassigned.' })
    }
  }

  const startDate = checkDate('startDate', LABELS.startDate, input.startDate, errors)
  const dueDate = checkDate('dueDate', LABELS.dueDate, input.dueDate, errors)
  if (startDate && dueDate && dueDate < startDate) {
    errors.push({ field: 'dueDate', message: 'The due date must be on or after the start date.' })
  }

  rejectUnknownFields(input, TASK_INPUT_FIELDS, errors)
  sortByFieldOrder(errors, TASK_INPUT_FIELDS)

  if (errors.length > 0 || !status || !priority || !startDate || !dueDate) return { ok: false, errors }
  return { ok: true, value: { title, description, status, priority, assigneeId, startDate, dueDate } }
}
