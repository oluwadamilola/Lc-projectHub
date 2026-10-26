import type { Task } from './types.js'
import { isIsoDate } from './validationHelpers.js'

/*
  The one definition of "outstanding", "overdue" and "due this week", shared by the server (the cross-project
  task filters) and the web app (the dashboard cards). Pure functions: no clock of their own, the caller
  passes "today", so they are easy to test at the edges of a day or a week.

  Conventions
  - A week runs Monday to Sunday, both days included.
  - Dates are calendar dates (YYYY-MM-DD), compared as text. That only works for valid ISO dates, which is
    why each task's date is checked first.
*/

export interface WeekRange {
  /** The Monday, as an ISO date. */
  start: string
  /** The Sunday, as an ISO date. */
  end: string
}

type DueTask = Pick<Task, 'dueDate' | 'status'>

/** A date as YYYY-MM-DD in the local calendar of the machine it runs on. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * The Monday-to-Sunday week that contains `today`.
 * Dates are built from the calendar (year, month, day) rather than by adding milliseconds,
 * so month ends, year ends, leap days and clock changes cannot shift the result.
 */
export function weekRange(today: Date = new Date()): WeekRange {
  const daysSinceMonday = (today.getDay() + 6) % 7 // Monday = 0 ... Sunday = 6
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return { start: toIsoDate(monday), end: toIsoDate(sunday) }
}

/** The week containing an ISO calendar date. The date must be valid (see `isIsoDate`). */
export function weekRangeFor(todayIso: string): WeekRange {
  const [year, month, day] = todayIso.split('-').map(Number)
  return weekRange(new Date(year, month - 1, day))
}

/** A task's due date when it is a real ISO calendar date, otherwise null (so it can never count as late or due). */
function validDueDate(task: DueTask): string | null {
  const due: unknown = task.dueDate
  return typeof due === 'string' && isIsoDate(due) ? due : null
}

/** Outstanding means not finished: every status except "Done". */
export function isTaskOutstanding(task: Pick<Task, 'status'>): boolean {
  return task.status !== 'Done'
}

/**
 * True when the task still needs doing and is due inside the week.
 *
 * Decision: finished tasks (status "Done") are NOT counted. "Tasks due this week" is a workload
 * measure, and work that is already complete is not outstanding. Tasks with a missing or invalid
 * due date are never counted, and overdue tasks from earlier weeks are not part of this week.
 */
export function isOutstandingAndDueInWeek(task: DueTask, week: WeekRange): boolean {
  if (!isTaskOutstanding(task)) return false
  const due = validDueDate(task)
  return due !== null && due >= week.start && due <= week.end
}

export function countTasksDueInWeek(tasks: readonly DueTask[], week: WeekRange): number {
  return tasks.filter((task) => isOutstandingAndDueInWeek(task, week)).length
}

/**
 * True when the task is overdue: still outstanding (not "Done"), with a real ISO due date that is
 * strictly before `todayIso`. A task due today is not overdue, and neither is one due later this week.
 * A missing or invalid due date is never overdue (we cannot know it is late).
 */
export function isTaskOverdue(task: DueTask, todayIso: string): boolean {
  if (!isTaskOutstanding(task)) return false
  const due = validDueDate(task)
  return due !== null && due < todayIso
}

/** How many tasks are overdue as of `today` (the local calendar day; the time of day does not matter). */
export function countOverdueTasks(tasks: readonly DueTask[], today: Date = new Date()): number {
  const todayIso = toIsoDate(today)
  return tasks.filter((task) => isTaskOverdue(task, todayIso)).length
}
