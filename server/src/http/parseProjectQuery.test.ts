import { describe, expect, it } from 'vitest'
import { ValidationError } from '../errors.js'
import { parseProjectId, parseProjectQuery } from './parseProjectQuery.js'

function fieldsRejected(query: Record<string, unknown>): string[] {
  try {
    parseProjectQuery(query)
  } catch (error) {
    if (error instanceof ValidationError) return error.details!.map((detail) => detail.field)
    throw error
  }
  return []
}

describe('parseProjectQuery', () => {
  it('applies defaults when nothing is supplied', () => {
    expect(parseProjectQuery({})).toEqual({ search: undefined, status: undefined, page: 1, pageSize: 20 })
  })

  it('accepts valid values and trims search text', () => {
    expect(parseProjectQuery({ q: '  wifi ', status: 'At risk', page: '2', pageSize: '10' })).toEqual({
      search: 'wifi',
      status: 'At risk',
      page: 2,
      pageSize: 10,
    })
  })

  it('treats empty values as absent', () => {
    expect(parseProjectQuery({ q: '  ', status: '', page: '' })).toMatchObject({
      search: undefined,
      status: undefined,
      page: 1,
    })
  })

  it('rejects an unknown status', () => {
    expect(fieldsRejected({ status: 'Finished' })).toEqual(['status'])
    expect(fieldsRejected({ status: 'on track' })).toEqual(['status'])
  })

  it.each(['0', '-1', '1.5', 'abc', '1e3', '100001'])('rejects page=%s', (page) => {
    expect(fieldsRejected({ page })).toEqual(['page'])
  })

  it.each(['0', '101', '-5', 'ten'])('rejects pageSize=%s', (pageSize) => {
    expect(fieldsRejected({ pageSize })).toEqual(['pageSize'])
  })

  it('rejects over-long search text', () => {
    expect(fieldsRejected({ q: 'x'.repeat(101) })).toEqual(['q'])
    expect(fieldsRejected({ q: 'x'.repeat(100) })).toEqual([])
  })

  it('rejects repeated or nested parameters', () => {
    expect(fieldsRejected({ q: ['a', 'b'], status: { a: 'b' } })).toEqual(['q', 'status'])
  })

  it('rejects unknown parameters so typos do not silently return unfiltered data', () => {
    expect(fieldsRejected({ statuss: 'Delayed' })).toEqual(['statuss'])
    expect(fieldsRejected({ 'status[]': 'Delayed', limit: '5' })).toEqual(['status[]', 'limit'])
  })

  it('reports every problem at once', () => {
    expect(fieldsRejected({ status: 'nope', page: '0', pageSize: '500' })).toEqual(['status', 'page', 'pageSize'])
  })
})

describe('parseProjectId', () => {
  it('accepts reference-like values', () => {
    expect(parseProjectId('PRJ-101')).toBe('PRJ-101')
  })

  it.each(['', 'a b', 'PRJ_1', '<script>', 'x'.repeat(33)])('rejects %j', (id) => {
    expect(() => parseProjectId(id)).toThrow(ValidationError)
  })
})
