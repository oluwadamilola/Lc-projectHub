import {
  PROJECT_INPUT_FIELDS,
  validateProjectInput,
  type ApiErrorDetail,
  type Project,
  type ProjectInput,
  type ProjectInputField,
} from '@lc-projecthub/shared'

/** Every field is held as text while the user is typing; conversion happens only on submit. */
export type FormValues = Record<ProjectInputField, string>

/** First message per field, ready to display next to each control. */
export type FieldErrors = Partial<Record<string, string>>

function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Starting values for a new project: planning, medium priority, 0% complete, starting today. */
export function emptyFormValues(today: Date = new Date()): FormValues {
  return {
    name: '',
    description: '',
    location: '',
    department: '',
    lead: '',
    priority: 'Medium',
    status: 'Planning',
    progress: '0',
    startDate: localIsoDate(today),
    dueDate: '',
  }
}

export function valuesFromProject(project: ProjectInput | Project): FormValues {
  return {
    name: project.name,
    description: project.description,
    location: project.location,
    department: project.department,
    lead: project.lead,
    priority: project.priority,
    status: project.status,
    progress: String(project.progress),
    startDate: project.startDate,
    dueDate: project.dueDate,
  }
}

/** Turns the typed progress into a number where it looks like one; anything else is left for validation to reject. */
function progressFromText(text: string): number | string {
  const trimmed = text.trim()
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed
}

export type FormValidation =
  | { ok: true; input: ProjectInput }
  | { ok: false; errors: ApiErrorDetail[] }

/** Runs the same validation the server runs, so the browser and the API always agree. */
export function validateForm(values: FormValues): FormValidation {
  const result = validateProjectInput({ ...values, progress: progressFromText(values.progress) })
  return result.ok ? { ok: true, input: result.value } : result
}

/** Keeps the first message for each field. */
export function toFieldErrors(details: readonly ApiErrorDetail[]): FieldErrors {
  const errors: FieldErrors = {}
  for (const { field, message } of details) {
    if (errors[field] === undefined) errors[field] = message
  }
  return errors
}

export function isFormField(field: string): field is ProjectInputField {
  return (PROJECT_INPUT_FIELDS as readonly string[]).includes(field)
}

export function isDirty(current: FormValues, initial: FormValues): boolean {
  return PROJECT_INPUT_FIELDS.some((field) => current[field] !== initial[field])
}
