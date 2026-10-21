import { describe, expect, it } from 'vitest'
import { describeDeadline, formatDate, isOverdue } from './format'

const today = new Date(2026, 5, 10, 15, 30)

describe('formatDate', () => {
  it('formats ISO dates in British style', () => {
    expect(formatDate('2026-06-01')).toBe('1 Jun 2026')
  })
})

describe('describeDeadline', () => {
  it('describes future, current and past deadlines', () => {
    expect(describeDeadline('2026-06-24', 'On track', today)).toBe('Due in 14 days')
    expect(describeDeadline('2026-06-11', 'On track', today)).toBe('Due in 1 day')
    expect(describeDeadline('2026-06-10', 'At risk', today)).toBe('Due today')
    expect(describeDeadline('2026-06-04', 'Delayed', today)).toBe('Overdue by 6 days')
    expect(describeDeadline('2026-06-09', 'Delayed', today)).toBe('Overdue by 1 day')
  })

  it('says nothing for completed projects', () => {
    expect(describeDeadline('2026-01-01', 'Complete', today)).toBeNull()
  })
})

describe('isOverdue', () => {
  it('is true only after the due day has passed', () => {
    expect(isOverdue('2026-06-09', false, today)).toBe(true)
    expect(isOverdue('2026-06-10', false, today)).toBe(false)
    expect(isOverdue('2026-06-11', false, today)).toBe(false)
  })

  it('is never true for finished work', () => {
    expect(isOverdue('2000-01-01', true, today)).toBe(false)
  })
})
