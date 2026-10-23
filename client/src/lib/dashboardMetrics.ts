import { isIsoDate, type Task } from '@lc-projecthub/shared'

/*
  Dashboard calculations. Pure functions: no network, no clock of their own (the caller passes "today"),
  so they are easy to test at the edges of a week.

  Conventions
  - A week runs Monday to Sunday, both days included.
  - Dates are calendar dates in the viewer's local time (YYYY-MM-DD), like everywhere else in the app.
    Because they are compared as text, they only work for valid ISO dates, which is why each task's date is checked first.
*/

export interface WeekRange {
  /** The Monday, as an ISO date. */
  start: string
  /** The Sunday, as an ISO date. */
  end: string
}

/** A date as YYYY-MM-DD in the viewer's local calendar. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * The Monday-to-Sunday week that contains `today`.
 * Dates are built from the local calendar (year, month, day) rather than by adding milliseconds,
 * so month ends, year ends, leap days and clock changes cannot shift the result.
 */
export function weekRange(today: Date = new Date()): WeekRange {
  const daysSinceMonday = (today.getDay() + 6) % 7 // Monday = 0 ... Sunday = 6
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return { start: toIsoDate(monday), end: toIsoDate(sunday) }
}

/**
 * True when the task still needs doing and is due inside the week.
 *
 * Decision: finished tasks (status "Done") are NOT counted. "Tasks due this week" is a workload
 * measure, and work that is already complete is not outstanding. Tasks with a missing or invalid
 * due date are never counted, and overdue tasks from earlier weeks are not part of this week.
 */
export function isOutstandingAndDueInWeek(task: Pick<Task, 'dueDate' | 'status'>, week: WeekRange): boolean {
  if (task.status === 'Done') return false
  const due: unknown = task.dueDate
  if (typeof due !== 'string' || !isIsoDate(due)) return false
  return due >= week.start && due <= week.end
}

export function countTasksDueInWeek(tasks: readonly Pick<Task, 'dueDate' | 'status'>[], week: WeekRange): number {
  return tasks.filter((task) => isOutstandingAndDueInWeek(task, week)).length
}

/**
 * True when the task is overdue: still outstanding (not "Done"), with a real ISO due date that is
 * strictly before `todayIso`. A task due today is not overdue, and neither is one due later this week.
 * A missing or invalid due date is never overdue (we cannot know it is late).
 */
export function isTaskOverdue(task: Pick<Task, 'dueDate' | 'status'>, todayIso: string): boolean {
  if (task.status === 'Done') return false
  const due: unknown = task.dueDate
  if (typeof due !== 'string' || !isIsoDate(due)) return false
  return due < todayIso
}

/** How many tasks are overdue as of `today` (the viewer's local calendar day; the time of day does not matter). */
export function countOverdueTasks(tasks: readonly Pick<Task, 'dueDate' | 'status'>[], today: Date = new Date()): number {
  const todayIso = toIsoDate(today)
  return tasks.filter((task) => isTaskOverdue(task, todayIso)).length
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

function formatWeekDay(iso: string): string {
  const parts = dayFormat.formatToParts(new Date(`${iso}T00:00:00`))
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')}`
}

/** For example "Mon 8 Jun – Sun 14 Jun". */
export function describeWeek(week: WeekRange): string {
  return `${formatWeekDay(week.start)} – ${formatWeekDay(week.end)}`
}
