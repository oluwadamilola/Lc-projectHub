import {
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  type ApiErrorDetail,
  type ProjectInput,
  type ProjectInputField,
} from './types.js'
import {
  checkChoice,
  checkDate,
  checkText,
  isPlainObject,
  rejectUnknownFields,
  sortByFieldOrder,
} from './validationHelpers.js'

export { isIsoDate } from './validationHelpers.js'

/*
  Validation for creating and editing projects.
  The server runs this as the authority; the browser runs the same function for instant feedback,
  so both always agree on the rules and the wording of the messages.
*/

export const PROJECT_TEXT_LIMITS = {
  name: 100,
  description: 1000,
  location: 100,
  department: 100,
  lead: 100,
} as const

/** Form order. Errors are reported in this order. */
export const PROJECT_INPUT_FIELDS = [
  'name',
  'description',
  'location',
  'department',
  'lead',
  'priority',
  'status',
  'progress',
  'startDate',
  'dueDate',
] as const satisfies readonly ProjectInputField[]

/** Names used inside messages, for example "Enter the project name." */
const LABELS: Record<ProjectInputField, string> = {
  name: 'project name',
  description: 'description',
  location: 'location',
  department: 'department',
  lead: 'project lead',
  priority: 'priority',
  status: 'status',
  progress: 'progress',
  startDate: 'start date',
  dueDate: 'target completion date',
}

export type ProjectValidationResult =
  | { ok: true; value: ProjectInput }
  | { ok: false; errors: ApiErrorDetail[] }

type TextField = keyof typeof PROJECT_TEXT_LIMITS

function text(field: TextField, raw: unknown, errors: ApiErrorDetail[]): string {
  return checkText(
    field,
    LABELS[field],
    raw,
    { limit: PROJECT_TEXT_LIMITS[field], required: true, multiline: field === 'description' },
    errors,
  )
}

/**
 * Checks untrusted input and returns either clean values (text trimmed) or every problem found.
 * Unknown properties are rejected so a mistyped field name can never be silently dropped.
 */
export function validateProjectInput(raw: unknown): ProjectValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ field: 'body', message: 'Send the project as a JSON object.' }] }
  }
  const input = raw
  const errors: ApiErrorDetail[] = []

  const name = text('name', input.name, errors)
  const description = text('description', input.description, errors)
  const location = text('location', input.location, errors)
  const department = text('department', input.department, errors)
  const lead = text('lead', input.lead, errors)
  const priority = checkChoice('priority', LABELS.priority, input.priority, PROJECT_PRIORITIES, errors)
  const status = checkChoice('status', LABELS.status, input.status, PROJECT_STATUSES, errors)

  let progress: number | undefined
  if (typeof input.progress === 'number' && Number.isInteger(input.progress) && input.progress >= 0 && input.progress <= 100) {
    progress = input.progress
    if (status === 'Complete' && progress !== 100) {
      errors.push({ field: 'progress', message: 'A completed project must be 100% complete.' })
    }
  } else {
    errors.push({ field: 'progress', message: 'Enter the progress as a whole number from 0 to 100.' })
  }

  const startDate = checkDate('startDate', LABELS.startDate, input.startDate, errors)
  const dueDate = checkDate('dueDate', LABELS.dueDate, input.dueDate, errors)
  if (startDate && dueDate && dueDate < startDate) {
    errors.push({ field: 'dueDate', message: 'The target completion date must be on or after the start date.' })
  }

  rejectUnknownFields(input, PROJECT_INPUT_FIELDS, errors)
  sortByFieldOrder(errors, PROJECT_INPUT_FIELDS)

  if (errors.length > 0 || !priority || !status || progress === undefined || !startDate || !dueDate) {
    return { ok: false, errors }
  }
  return { ok: true, value: { name, description, location, department, lead, priority, status, progress, startDate, dueDate } }
}
