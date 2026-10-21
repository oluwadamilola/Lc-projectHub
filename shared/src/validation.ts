import {
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  type ApiErrorDetail,
  type ProjectInput,
  type ProjectInputField,
} from './types.js'

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

const MIN_YEAR = 1900
const MAX_YEAR = 2100

/** True for a real calendar date written as YYYY-MM-DD (so 2026-02-30 is rejected). */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (year < MIN_YEAR || year > MAX_YEAR) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Control characters have no place in these fields; only the description may contain line breaks. */
function hasForbiddenCharacter(value: string, allowLineBreaks: boolean): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    const isLineBreak = code === 0x0a || code === 0x0d
    if ((code < 0x20 && !(allowLineBreaks && isLineBreak)) || code === 0x7f) return true
  }
  return false
}

type TextField = keyof typeof PROJECT_TEXT_LIMITS

function checkText(field: TextField, raw: unknown, errors: ApiErrorDetail[]): string {
  const label = LABELS[field]
  if (raw === undefined || raw === null) {
    errors.push({ field, message: `Enter the ${label}.` })
    return ''
  }
  if (typeof raw !== 'string') {
    errors.push({ field, message: `The ${label} must be text.` })
    return ''
  }
  const value = raw.trim()
  if (value === '') {
    errors.push({ field, message: `Enter the ${label}.` })
  } else if (value.length > PROJECT_TEXT_LIMITS[field]) {
    errors.push({ field, message: `The ${label} must be ${PROJECT_TEXT_LIMITS[field]} characters or fewer.` })
  } else if (hasForbiddenCharacter(value, field === 'description')) {
    errors.push({ field, message: `The ${label} contains characters that are not allowed.` })
  }
  return value
}

function checkChoice<T extends string>(
  field: 'priority' | 'status',
  raw: unknown,
  allowed: readonly T[],
  errors: ApiErrorDetail[],
): T | undefined {
  if (raw === undefined || raw === null || raw === '') {
    errors.push({ field, message: `Choose a ${LABELS[field]}.` })
    return undefined
  }
  const match = allowed.find((option) => option === raw)
  if (!match) errors.push({ field, message: `The ${LABELS[field]} must be one of: ${allowed.join(', ')}.` })
  return match
}

function checkDate(field: 'startDate' | 'dueDate', raw: unknown, errors: ApiErrorDetail[]): string | undefined {
  if (raw === undefined || raw === null || raw === '') {
    errors.push({ field, message: `Enter the ${LABELS[field]}.` })
    return undefined
  }
  if (typeof raw !== 'string' || !isIsoDate(raw)) {
    errors.push({ field, message: `Enter a valid ${LABELS[field]}.` })
    return undefined
  }
  return raw
}

/**
 * Checks untrusted input and returns either clean values (text trimmed) or every problem found.
 * Unknown properties are rejected so a mistyped field name can never be silently dropped.
 */
export function validateProjectInput(raw: unknown): ProjectValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ field: 'body', message: 'Send the project as a JSON object.' }] }
  }
  const input = raw as Record<string, unknown>
  const errors: ApiErrorDetail[] = []

  const name = checkText('name', input.name, errors)
  const description = checkText('description', input.description, errors)
  const location = checkText('location', input.location, errors)
  const department = checkText('department', input.department, errors)
  const lead = checkText('lead', input.lead, errors)
  const priority = checkChoice('priority', input.priority, PROJECT_PRIORITIES, errors)
  const status = checkChoice('status', input.status, PROJECT_STATUSES, errors)

  let progress: number | undefined
  if (typeof input.progress === 'number' && Number.isInteger(input.progress) && input.progress >= 0 && input.progress <= 100) {
    progress = input.progress
    if (status === 'Complete' && progress !== 100) {
      errors.push({ field: 'progress', message: 'A completed project must be 100% complete.' })
    }
  } else {
    errors.push({ field: 'progress', message: 'Enter the progress as a whole number from 0 to 100.' })
  }

  const startDate = checkDate('startDate', input.startDate, errors)
  const dueDate = checkDate('dueDate', input.dueDate, errors)
  if (startDate && dueDate && dueDate < startDate) {
    errors.push({ field: 'dueDate', message: 'The target completion date must be on or after the start date.' })
  }

  const known: readonly string[] = PROJECT_INPUT_FIELDS
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) errors.push({ field: key, message: 'This field is not recognised.' })
  }

  // Report errors in form order (unknown fields last).
  const rank = (field: string) => {
    const index = known.indexOf(field)
    return index === -1 ? known.length : index
  }
  errors.sort((a, b) => rank(a.field) - rank(b.field))

  if (errors.length > 0 || !priority || !status || progress === undefined || !startDate || !dueDate) {
    return { ok: false, errors }
  }
  return { ok: true, value: { name, description, location, department, lead, priority, status, progress, startDate, dueDate } }
}
