import { describe, expect, it } from 'vitest'
import {
  TASK_DUE_FILTERS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  countOverdueTasks,
  countTasksDueInWeek,
  isOutstandingAndDueInWeek,
  isTaskOutstanding,
  isTaskOverdue,
  toIsoDate,
  weekRange,
  weekRangeFor,
  type TaskStatus,
} from './index.js'

const task = (dueDate: string, status: TaskStatus = 'To do') => ({ dueDate, status })

describe('toIsoDate and weekRange', () => {
  it('formats local calendar dates with zero padding', () => {
    expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(toIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('runs Monday to Sunday for any day of the week', () => {
    // Mon 9 Feb 2026 to Sun 15 Feb 2026
    for (let day = 9; day <= 15; day += 1) {
      expect(weekRange(new Date(2026, 1, day, 12))).toEqual({ start: '2026-02-09', end: '2026-02-15' })
    }
    expect(weekRange(new Date(2026, 1, 16))).toEqual({ start: '2026-02-16', end: '2026-02-22' })
    expect(weekRange(new Date(2026, 1, 8))).toEqual({ start: '2026-02-02', end: '2026-02-08' })
  })

  it('crosses month, year and leap-day boundaries', () => {
    expect(weekRange(new Date(2025, 11, 31))).toEqual({ start: '2025-12-29', end: '2026-01-04' })
    expect(weekRange(new Date(2024, 1, 29))).toEqual({ start: '2024-02-26', end: '2024-03-03' })
    expect(weekRange(new Date(2026, 2, 30))).toEqual({ start: '2026-03-30', end: '2026-04-05' })
  })

  it('weekRangeFor gives the same answer from an ISO date', () => {
    expect(weekRangeFor('2026-02-10')).toEqual(weekRange(new Date(2026, 1, 10)))
    expect(weekRangeFor('2024-02-29')).toEqual({ start: '2024-02-26', end: '2024-03-03' })
  })
})

describe('isTaskOutstanding', () => {
  it('is every status except Done', () => {
    expect(TASK_STATUSES.filter((status) => isTaskOutstanding({ status }))).toEqual(['To do', 'In progress', 'Blocked'])
  })
})

describe('isTaskOverdue', () => {
  it('is strictly before today: due today is not overdue, due yesterday is', () => {
    expect(isTaskOverdue(task('2026-02-09'), '2026-02-10')).toBe(true)
    expect(isTaskOverdue(task('2026-02-10'), '2026-02-10')).toBe(false)
    expect(isTaskOverdue(task('2026-02-11'), '2026-02-10')).toBe(false)
  })

  it('never counts a completed task, however late', () => {
    expect(isTaskOverdue(task('2020-01-01', 'Done'), '2026-02-10')).toBe(false)
  })

  it('counts Blocked and In progress tasks', () => {
    expect(isTaskOverdue(task('2026-01-01', 'Blocked'), '2026-02-10')).toBe(true)
    expect(isTaskOverdue(task('2026-01-01', 'In progress'), '2026-02-10')).toBe(true)
  })

  it.each(['', 'soon', '2026-02-30', '2026-13-01', '10/02/2026', '2026-2-9', '0000-01-01'])(
    'never counts a missing or invalid due date (%j)',
    (dueDate) => {
      expect(isTaskOverdue(task(dueDate), '2099-01-01')).toBe(false)
    },
  )

  it('ignores a due date that is not even text', () => {
    expect(isTaskOverdue({ dueDate: undefined as unknown as string, status: 'To do' }, '2099-01-01')).toBe(false)
    expect(isTaskOverdue({ dueDate: null as unknown as string, status: 'To do' }, '2099-01-01')).toBe(false)
  })
})

describe('isOutstandingAndDueInWeek', () => {
  const week = { start: '2026-02-09', end: '2026-02-15' }

  it('includes both ends of the week and excludes the days either side', () => {
    expect(isOutstandingAndDueInWeek(task('2026-02-08'), week)).toBe(false)
    expect(isOutstandingAndDueInWeek(task('2026-02-09'), week)).toBe(true)
    expect(isOutstandingAndDueInWeek(task('2026-02-15'), week)).toBe(true)
    expect(isOutstandingAndDueInWeek(task('2026-02-16'), week)).toBe(false)
  })

  it('excludes completed tasks and invalid dates', () => {
    expect(isOutstandingAndDueInWeek(task('2026-02-10', 'Done'), week)).toBe(false)
    expect(isOutstandingAndDueInWeek(task(''), week)).toBe(false)
    expect(isOutstandingAndDueInWeek(task('2026-02-30'), week)).toBe(false)
  })
})

describe('counts', () => {
  const tasks = [
    task('2026-02-02'), // overdue, earlier week
    task('2026-02-09'), // overdue, this week
    task('2026-02-10'), // due today
    task('2026-02-14'), // later this week
    task('2026-02-20'), // next week
    task('2026-02-01', 'Done'),
    task('2026-02-12', 'Done'),
    task(''),
  ]
  const today = new Date(2026, 1, 10, 9)

  it('counts overdue tasks as of today', () => {
    expect(countOverdueTasks(tasks, today)).toBe(2)
  })

  it('counts outstanding tasks due in the week', () => {
    expect(countTasksDueInWeek(tasks, weekRange(today))).toBe(3)
  })

  it('"overdue" and "due this week" overlap by design: a task due earlier this week is in both', () => {
    const early = task('2026-02-09')
    expect(isTaskOverdue(early, '2026-02-10')).toBe(true)
    expect(isOutstandingAndDueInWeek(early, weekRange(today))).toBe(true)
  })

  it('counts nothing for no tasks', () => {
    expect(countOverdueTasks([], today)).toBe(0)
    expect(countTasksDueInWeek([], weekRange(today))).toBe(0)
  })
})

describe('cross-project task constants', () => {
  it('offers exactly the two due-date filters', () => {
    expect([...TASK_DUE_FILTERS]).toEqual(['overdue', 'this-week'])
  })

  it('shares the task priorities with projects', () => {
    expect([...TASK_PRIORITIES]).toEqual(['Low', 'Medium', 'High', 'Critical'])
  })
})
