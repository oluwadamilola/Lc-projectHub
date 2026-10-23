import type { TaskStatus } from '@lc-projecthub/shared'
import { describe, expect, it } from 'vitest'
import {
  countTasksDueInWeek,
  describeWeek,
  isOutstandingAndDueInWeek,
  weekRange,
  type WeekRange,
} from './dashboardMetrics'

// Wednesday 10 June 2026 sits in the week Monday 8 June to Sunday 14 June.
const week: WeekRange = { start: '2026-06-08', end: '2026-06-14' }
const task = (dueDate: unknown, status: TaskStatus = 'To do') => ({ dueDate: dueDate as string, status })

describe('weekRange', () => {
  it('returns the Monday-to-Sunday week containing a midweek day', () => {
    expect(weekRange(new Date(2026, 5, 10, 15, 30))).toEqual(week)
  })

  it('starts on Monday: a Monday belongs to the week it begins', () => {
    expect(weekRange(new Date(2026, 5, 8, 0, 0))).toEqual(week)
    expect(weekRange(new Date(2026, 5, 8, 23, 59, 59))).toEqual(week)
  })

  it('ends on Sunday: a Sunday belongs to the week it finishes', () => {
    expect(weekRange(new Date(2026, 5, 14, 0, 0))).toEqual(week)
    expect(weekRange(new Date(2026, 5, 14, 23, 59, 59))).toEqual(week)
  })

  it('moves to the next week at the first moment of Monday, and the previous week at the end of Sunday', () => {
    expect(weekRange(new Date(2026, 5, 15, 0, 0))).toEqual({ start: '2026-06-15', end: '2026-06-21' })
    expect(weekRange(new Date(2026, 5, 7, 23, 59))).toEqual({ start: '2026-06-01', end: '2026-06-07' })
  })

  it('crosses month ends', () => {
    expect(weekRange(new Date(2026, 6, 1))).toEqual({ start: '2026-06-29', end: '2026-07-05' })
    expect(weekRange(new Date(2026, 5, 30))).toEqual({ start: '2026-06-29', end: '2026-07-05' })
  })

  it('crosses year ends in both directions', () => {
    expect(weekRange(new Date(2026, 0, 1))).toEqual({ start: '2025-12-29', end: '2026-01-04' })
    expect(weekRange(new Date(2025, 11, 31))).toEqual({ start: '2025-12-29', end: '2026-01-04' })
    expect(weekRange(new Date(2026, 11, 31))).toEqual({ start: '2026-12-28', end: '2027-01-03' })
  })

  it('handles a leap day', () => {
    expect(weekRange(new Date(2024, 1, 29))).toEqual({ start: '2024-02-26', end: '2024-03-03' })
    expect(weekRange(new Date(2028, 1, 29))).toEqual({ start: '2028-02-28', end: '2028-03-05' })
  })

  it('is not thrown off by clocks changing (UK: 29 March and 25 October 2026 are Sundays)', () => {
    expect(weekRange(new Date(2026, 2, 29, 12))).toEqual({ start: '2026-03-23', end: '2026-03-29' })
    expect(weekRange(new Date(2026, 2, 30, 12))).toEqual({ start: '2026-03-30', end: '2026-04-05' })
    expect(weekRange(new Date(2026, 9, 25, 12))).toEqual({ start: '2026-10-19', end: '2026-10-25' })
    expect(weekRange(new Date(2026, 9, 26, 12))).toEqual({ start: '2026-10-26', end: '2026-11-01' })
  })

  it('always gives a Monday-to-Sunday span of seven days that contains the day, for every day of 2026 and 2028', () => {
    for (const year of [2026, 2028]) {
      for (let day = new Date(year, 0, 1); day.getFullYear() === year; day = new Date(year, day.getMonth(), day.getDate() + 1)) {
        const range = weekRange(day)
        const start = new Date(`${range.start}T00:00:00`)
        const end = new Date(`${range.end}T00:00:00`)
        const iso = `${year}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
        expect(start.getDay()).toBe(1)
        expect(end.getDay()).toBe(0)
        expect(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6).getTime()).toBe(start.getTime())
        expect(iso >= range.start && iso <= range.end).toBe(true)
      }
    }
  })
})

describe('isOutstandingAndDueInWeek', () => {
  it('counts a task due on the first day (Monday) and the last day (Sunday) of the week', () => {
    expect(isOutstandingAndDueInWeek(task('2026-06-08'), week)).toBe(true)
    expect(isOutstandingAndDueInWeek(task('2026-06-14'), week)).toBe(true)
  })

  it('counts a task due mid-week', () => {
    expect(isOutstandingAndDueInWeek(task('2026-06-10'), week)).toBe(true)
  })

  it('does not count tasks due the day before the week or the day after it', () => {
    expect(isOutstandingAndDueInWeek(task('2026-06-07'), week)).toBe(false)
    expect(isOutstandingAndDueInWeek(task('2026-06-15'), week)).toBe(false)
  })

  it('does not count tasks due far outside the week, including overdue ones', () => {
    expect(isOutstandingAndDueInWeek(task('2026-01-01'), week)).toBe(false)
    expect(isOutstandingAndDueInWeek(task('2027-06-10'), week)).toBe(false)
  })

  it('does not count finished (Done) tasks, even when due this week', () => {
    expect(isOutstandingAndDueInWeek(task('2026-06-10', 'Done'), week)).toBe(false)
    expect(isOutstandingAndDueInWeek(task('2026-06-08', 'Done'), week)).toBe(false)
  })

  it.each<TaskStatus>(['To do', 'In progress', 'Blocked'])('counts an unfinished task with status "%s"', (status) => {
    expect(isOutstandingAndDueInWeek(task('2026-06-10', status), week)).toBe(true)
  })

  it.each([undefined, null, '', '   '])('ignores a missing due date (%j)', (dueDate) => {
    expect(isOutstandingAndDueInWeek(task(dueDate), week)).toBe(false)
  })

  it.each([
    'not a date',
    '2026-02-30',
    '2026-13-01',
    '2026-6-10',
    '10/06/2026',
    '2026-06-10T09:00:00',
    ' 2026-06-10',
    '2026-06-10 ',
    20260610,
    {},
    ['2026-06-10'],
  ])('ignores an invalid due date (%j)', (dueDate) => {
    expect(isOutstandingAndDueInWeek(task(dueDate), week)).toBe(false)
  })
})

describe('countTasksDueInWeek', () => {
  it('counts only unfinished tasks with a valid due date inside the week', () => {
    const tasks = [
      task('2026-06-07'), // Sunday before: no
      task('2026-06-08'), // Monday: yes
      task('2026-06-10', 'In progress'), // yes
      task('2026-06-11', 'Blocked'), // yes
      task('2026-06-12', 'Done'), // finished: no
      task('2026-06-14'), // Sunday: yes
      task('2026-06-15'), // Monday after: no
      task(undefined), // no due date: no
      task('2026-02-30'), // invalid: no
    ]
    expect(countTasksDueInWeek(tasks, week)).toBe(4)
  })

  it('returns a genuine zero for no tasks, and when nothing falls in the week', () => {
    expect(countTasksDueInWeek([], week)).toBe(0)
    expect(countTasksDueInWeek([task('2026-07-01'), task('2026-05-01')], week)).toBe(0)
  })

  it('counts each task once, however many projects it came from', () => {
    expect(countTasksDueInWeek([task('2026-06-09'), task('2026-06-09')], week)).toBe(2)
  })
})

describe('describeWeek', () => {
  it('names the first and last day', () => {
    expect(describeWeek(week)).toBe('Mon 8 Jun – Sun 14 Jun')
  })

  it('works across a month and a year', () => {
    expect(describeWeek({ start: '2026-06-29', end: '2026-07-05' })).toBe('Mon 29 Jun – Sun 5 Jul')
    expect(describeWeek({ start: '2025-12-29', end: '2026-01-04' })).toBe('Mon 29 Dec – Sun 4 Jan')
  })
})
