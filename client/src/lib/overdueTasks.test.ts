import type { TaskStatus } from '@lc-projecthub/shared'
import { describe, expect, it } from 'vitest'
import { countOverdueTasks, countTasksDueInWeek, isTaskOverdue, toIsoDate, weekRange } from './dashboardMetrics'

const task = (dueDate: unknown, status: TaskStatus = 'To do') => ({ dueDate: dueDate as string, status })

describe('toIsoDate', () => {
  it('formats the local calendar day with zero padding', () => {
    expect(toIsoDate(new Date(2026, 0, 5, 9, 30))).toBe('2026-01-05')
    expect(toIsoDate(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31')
    expect(toIsoDate(new Date(2028, 1, 29))).toBe('2028-02-29')
  })
})

describe('isTaskOverdue', () => {
  const today = '2026-06-10'

  it('is overdue when due yesterday, but not when due today or tomorrow', () => {
    expect(isTaskOverdue(task('2026-06-09'), today)).toBe(true) // yesterday
    expect(isTaskOverdue(task('2026-06-10'), today)).toBe(false) // today: still on time
    expect(isTaskOverdue(task('2026-06-11'), today)).toBe(false) // tomorrow
  })

  it('is overdue however long ago it was due', () => {
    expect(isTaskOverdue(task('2026-01-01'), today)).toBe(true)
    expect(isTaskOverdue(task('1999-12-31'), today)).toBe(true)
  })

  it('is not overdue when due later this week or far in the future', () => {
    expect(isTaskOverdue(task('2026-06-12'), today)).toBe(false)
    expect(isTaskOverdue(task('2027-01-01'), today)).toBe(false)
  })

  it('never counts a completed (Done) task, however old', () => {
    expect(isTaskOverdue(task('2026-06-09', 'Done'), today)).toBe(false)
    expect(isTaskOverdue(task('2020-01-01', 'Done'), today)).toBe(false)
  })

  it.each<TaskStatus>(['To do', 'In progress', 'Blocked'])('counts an unfinished task with status "%s"', (status) => {
    expect(isTaskOverdue(task('2026-06-09', status), today)).toBe(true)
  })

  it.each([undefined, null, '', '   '])('is not overdue with a missing due date (%j)', (dueDate) => {
    expect(isTaskOverdue(task(dueDate), today)).toBe(false)
  })

  it.each([
    'not a date',
    '2026-02-30',
    '2026-13-01',
    '2026-6-9',
    '09/06/2026',
    '2026-06-09T09:00:00',
    ' 2026-06-09',
    20260609,
    {},
    ['2026-06-09'],
  ])('is not overdue with an invalid due date (%j)', (dueDate) => {
    expect(isTaskOverdue(task(dueDate), today)).toBe(false)
  })

  it('handles the end of a month', () => {
    expect(isTaskOverdue(task('2026-02-28'), '2026-03-01')).toBe(true)
    expect(isTaskOverdue(task('2026-03-01'), '2026-03-01')).toBe(false)
    expect(isTaskOverdue(task('2026-04-30'), '2026-05-01')).toBe(true)
    expect(isTaskOverdue(task('2026-05-01'), '2026-04-30')).toBe(false)
  })

  it('handles the end of a year in both directions', () => {
    expect(isTaskOverdue(task('2025-12-31'), '2026-01-01')).toBe(true)
    expect(isTaskOverdue(task('2025-12-31'), '2025-12-31')).toBe(false)
    expect(isTaskOverdue(task('2026-01-01'), '2025-12-31')).toBe(false)
  })

  it('handles a leap day, and a day that does not exist', () => {
    // 2028 is a leap year: 29 February exists.
    expect(isTaskOverdue(task('2028-02-29'), '2028-03-01')).toBe(true)
    expect(isTaskOverdue(task('2028-02-29'), '2028-02-29')).toBe(false)
    expect(isTaskOverdue(task('2028-02-28'), '2028-02-29')).toBe(true)
    // 2027 is not: 28 February is the last day, and "29 February" is not a date at all.
    expect(isTaskOverdue(task('2027-02-28'), '2027-03-01')).toBe(true)
    expect(isTaskOverdue(task('2027-02-29'), '2027-03-01')).toBe(false)
  })
})

describe('countOverdueTasks', () => {
  const wednesday = new Date(2026, 5, 10, 12, 0)

  it('counts only unfinished tasks with a valid due date before today', () => {
    const tasks = [
      task('2026-06-09'), // yesterday: overdue
      task('2026-06-10'), // today: not overdue
      task('2026-06-11'), // tomorrow: not overdue
      task('2026-01-15', 'In progress'), // long ago: overdue
      task('2026-06-01', 'Blocked'), // overdue
      task('2026-06-09', 'Done'), // finished: never
      task(undefined), // no due date
      task('2026-02-30'), // not a real date
    ]
    expect(countOverdueTasks(tasks, wednesday)).toBe(3)
  })

  it('returns a genuine zero for no tasks, and when nothing is late', () => {
    expect(countOverdueTasks([], wednesday)).toBe(0)
    expect(countOverdueTasks([task('2026-06-10'), task('2026-07-01'), task('2020-01-01', 'Done')], wednesday)).toBe(0)
  })

  it('does not depend on the time of day: the whole of today is on time', () => {
    const tasks = [task('2026-06-09'), task('2026-06-10')]
    expect(countOverdueTasks(tasks, new Date(2026, 5, 10, 0, 0, 0))).toBe(1)
    expect(countOverdueTasks(tasks, new Date(2026, 5, 10, 23, 59, 59))).toBe(1)
  })

  it('turns a task overdue at the first moment of the next day', () => {
    const tasks = [task('2026-06-10')]
    expect(countOverdueTasks(tasks, new Date(2026, 5, 10, 23, 59, 59))).toBe(0)
    expect(countOverdueTasks(tasks, new Date(2026, 5, 11, 0, 0, 0))).toBe(1)
  })

  it('uses the local calendar day when clocks change (UK: 29 March and 25 October 2026)', () => {
    expect(countOverdueTasks([task('2026-03-28')], new Date(2026, 2, 29, 12))).toBe(1)
    expect(countOverdueTasks([task('2026-03-29')], new Date(2026, 2, 29, 12))).toBe(0)
    expect(countOverdueTasks([task('2026-10-24')], new Date(2026, 9, 25, 12))).toBe(1)
    expect(countOverdueTasks([task('2026-10-25')], new Date(2026, 9, 25, 12))).toBe(0)
  })

  it('crosses month, year and leap-day boundaries', () => {
    expect(countOverdueTasks([task('2026-02-28')], new Date(2026, 2, 1))).toBe(1)
    expect(countOverdueTasks([task('2025-12-31')], new Date(2026, 0, 1))).toBe(1)
    expect(countOverdueTasks([task('2028-02-29')], new Date(2028, 2, 1))).toBe(1)
    expect(countOverdueTasks([task('2028-02-29')], new Date(2028, 1, 29))).toBe(0)
  })

  it('relates to "due this week" without changing it: an earlier day this week is both, a later one is only due', () => {
    const range = weekRange(wednesday) // Monday 8 to Sunday 14 June
    const monday = task('2026-06-08') // already past: in the week AND overdue
    const friday = task('2026-06-12') // still to come: in the week, not overdue
    const lastWeek = task('2026-06-02') // overdue, but not in this week
    expect(countTasksDueInWeek([monday, friday, lastWeek], range)).toBe(2)
    expect(countOverdueTasks([monday, friday, lastWeek], wednesday)).toBe(2)
    expect(isTaskOverdue(friday, toIsoDate(wednesday))).toBe(false)
  })
})
