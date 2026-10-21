import {
  TASK_INPUT_FIELDS,
  validateTaskInput,
  type Task,
  type TaskInput,
  type TaskInputField,
} from '@lc-projecthub/shared'
import type { Validation } from '../hooks/useFormController'

/** Every field is held as text while the user is typing. An empty `assigneeId` means "Unassigned". */
export type TaskFormValues = Record<TaskInputField, string>

function localIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Starting values for a new task: to do, medium priority, unassigned, starting today. */
export function emptyTaskFormValues(today: Date = new Date()): TaskFormValues {
  return {
    title: '',
    description: '',
    status: 'To do',
    priority: 'Medium',
    assigneeId: '',
    startDate: localIsoDate(today),
    dueDate: '',
  }
}

export function valuesFromTask(task: Task | TaskInput): TaskFormValues {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId ?? '',
    startDate: task.startDate,
    dueDate: task.dueDate,
  }
}

/** Runs the same validation the server runs, so the browser and the API always agree. */
export function validateTaskForm(values: TaskFormValues): Validation<TaskInput> {
  const result = validateTaskInput({ ...values, assigneeId: values.assigneeId === '' ? null : values.assigneeId })
  return result.ok ? { ok: true, input: result.value } : result
}

export function isTaskFormField(field: string): field is TaskInputField {
  return (TASK_INPUT_FIELDS as readonly string[]).includes(field)
}

export function isTaskFormDirty(current: TaskFormValues, initial: TaskFormValues): boolean {
  return TASK_INPUT_FIELDS.some((field) => current[field] !== initial[field])
}
