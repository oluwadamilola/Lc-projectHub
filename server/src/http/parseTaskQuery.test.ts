import { describe, expect, it } from 'vitest'
import { ValidationError } from '../errors.js'
import { parseTaskQuery } from './parseTaskQuery.js'

function fieldsRejected(query: Record<string, unknown>): string[] {
  try {
    parseTaskQuery('PRJ-001', query)
  } catch (error) {
    if (error instanceof ValidationError) return error.details!.map((detail) => detail.field)
    throw error
  }
  return []
}

describe('parseTaskQuery', () => {
  it('applies defaults and carries the project reference', () => {
    expect(parseTaskQuery('PRJ-001', {})).toEqual({
      projectId: 'PRJ-001',
      search: undefined,
      status: undefined,
      assignee: undefined,
      page: 1,
      pageSize: 20,
    })
  })

  it('accepts valid values and trims search text', () => {
    expect(parseTaskQuery('PRJ-001', { q: ' cable ', status: 'In progress', assignee: 'TECH-003', page: '2', pageSize: '5' })).toEqual({
      projectId: 'PRJ-001',
      search: 'cable',
      status: 'In progress',
      assignee: 'TECH-003',
      page: 2,
      pageSize: 5,
    })
  })

  it('accepts "unassigned" as the assignee filter', () => {
    expect(parseTaskQuery('PRJ-001', { assignee: 'unassigned' }).assignee).toBe('unassigned')
  })

  it('treats empty values as absent', () => {
    expect(parseTaskQuery('PRJ-001', { q: ' ', status: '', assignee: '', page: '' })).toMatchObject({
      search: undefined,
      status: undefined,
      assignee: undefined,
      page: 1,
    })
  })

  it('rejects unsupported statuses (including project statuses)', () => {
    expect(fieldsRejected({ status: 'Finished' })).toEqual(['status'])
    expect(fieldsRejected({ status: 'On track' })).toEqual(['status'])
    expect(fieldsRejected({ status: 'in progress' })).toEqual(['status'])
  })

  it.each(['TECH-1', 'tech-001', 'PRJ-101', 'someone', 'Unassigned'])('rejects assignee=%s', (assignee) => {
    expect(fieldsRejected({ assignee })).toEqual(['assignee'])
  })

  it.each(['0', '-1', '1.5', 'abc'])('rejects page=%s', (page) => {
    expect(fieldsRejected({ page })).toEqual(['page'])
  })

  it.each(['0', '101', 'ten'])('rejects pageSize=%s', (pageSize) => {
    expect(fieldsRejected({ pageSize })).toEqual(['pageSize'])
  })

  it('rejects over-long search text, repeated parameters and unknown parameters', () => {
    expect(fieldsRejected({ q: 'x'.repeat(101) })).toEqual(['q'])
    expect(fieldsRejected({ q: ['a', 'b'] })).toEqual(['q'])
    expect(fieldsRejected({ statuss: 'Done' })).toEqual(['statuss'])
    expect(fieldsRejected({ projectId: 'PRJ-002' })).toEqual(['projectId'])
  })

  it('reports every problem at once', () => {
    expect(fieldsRejected({ status: 'x', assignee: 'y', page: '0' })).toEqual(['status', 'assignee', 'page'])
  })
})
