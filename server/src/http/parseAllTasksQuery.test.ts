import { describe, expect, it } from 'vitest'
import { ValidationError } from '../errors.js'
import { parseAllTasksQuery } from './parseAllTasksQuery.js'

const NOW = new Date(2026, 1, 10, 15, 30) // 10 Feb 2026, local time

function fieldsRejected(query: Record<string, unknown>): string[] {
  try {
    parseAllTasksQuery(query, NOW)
  } catch (error) {
    if (error instanceof ValidationError) return error.details!.map((detail) => detail.field)
    throw error
  }
  return []
}

describe('parseAllTasksQuery', () => {
  it('applies defaults, taking today from the clock', () => {
    expect(parseAllTasksQuery({}, NOW)).toEqual({
      projectId: undefined,
      search: undefined,
      status: undefined,
      priority: undefined,
      assignee: undefined,
      due: undefined,
      today: '2026-02-10',
      page: 1,
      pageSize: 20,
    })
  })

  it('accepts every filter, trims search text and prefers the caller\'s day to the clock', () => {
    expect(
      parseAllTasksQuery(
        {
          q: ' cable ',
          project: 'PRJ-101',
          status: 'In progress',
          priority: 'High',
          assignee: 'TECH-003',
          due: 'overdue',
          today: '2026-03-01',
          page: '2',
          pageSize: '5',
        },
        NOW,
      ),
    ).toEqual({
      projectId: 'PRJ-101',
      search: 'cable',
      status: 'In progress',
      priority: 'High',
      assignee: 'TECH-003',
      due: 'overdue',
      today: '2026-03-01',
      page: 2,
      pageSize: 5,
    })
  })

  it('accepts "unassigned" and the "this-week" due filter', () => {
    const criteria = parseAllTasksQuery({ assignee: 'unassigned', due: 'this-week' }, NOW)
    expect(criteria.assignee).toBe('unassigned')
    expect(criteria.due).toBe('this-week')
  })

  it('treats empty values as absent', () => {
    const criteria = parseAllTasksQuery({ q: '  ', project: '', status: '', priority: '', assignee: '', due: '', today: '' }, NOW)
    expect(criteria).toMatchObject({ search: undefined, projectId: undefined, status: undefined, due: undefined, today: '2026-02-10' })
  })

  it('rejects unknown parameters so a misspelt filter cannot silently return everything', () => {
    expect(fieldsRejected({ statuss: 'Done', sort: 'title' })).toEqual(['statuss', 'sort'])
  })

  it.each([
    ['status', 'Finished'],
    ['status', 'done'],
    ['priority', 'Urgent'],
    ['due', 'tomorrow'],
    ['due', 'Overdue'],
    ['assignee', 'Riley'],
    ['assignee', 'TECH-1'],
    ['project', 'PRJ 101'],
    ['project', 'PRJ-101/../x'],
    ['today', '2026-02-30'],
    ['today', '10/02/2026'],
    ['today', 'today'],
  ])('rejects an invalid %s value (%s)', (field, value) => {
    expect(fieldsRejected({ [field]: value })).toEqual([field])
  })

  it('rejects repeated parameters', () => {
    expect(fieldsRejected({ status: ['Done', 'To do'], project: ['PRJ-101', 'PRJ-102'] })).toEqual(['project', 'status'])
  })

  it('limits the search text to 100 characters', () => {
    expect(fieldsRejected({ q: 'x'.repeat(100) })).toEqual([])
    expect(fieldsRejected({ q: 'x'.repeat(101) })).toEqual(['q'])
  })

  it.each([
    ['page', '0'],
    ['page', '-1'],
    ['page', '1.5'],
    ['page', 'abc'],
    ['page', '100001'],
    ['pageSize', '0'],
    ['pageSize', '101'],
    ['pageSize', '1e2'],
    ['pageSize', ''],
  ])('bounds paging: %s=%s', (field, value) => {
    // An empty value counts as absent, so it falls back to the default instead of failing.
    expect(fieldsRejected({ [field]: value })).toEqual(value === '' ? [] : [field])
  })

  it('accepts the page size limits', () => {
    expect(parseAllTasksQuery({ pageSize: '1' }, NOW).pageSize).toBe(1)
    expect(parseAllTasksQuery({ pageSize: '100' }, NOW).pageSize).toBe(100)
  })

  it('reports every problem at once', () => {
    expect(fieldsRejected({ status: 'x', priority: 'y', due: 'z', page: '0' })).toEqual(['status', 'priority', 'due', 'page'])
  })
})
