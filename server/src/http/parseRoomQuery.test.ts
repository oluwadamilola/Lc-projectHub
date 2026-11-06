import { describe, expect, it } from 'vitest'
import { ValidationError } from '../errors.js'
import { parseCycleQuery } from './parseCycleQuery.js'
import { parseRoomQuery } from './parseRoomQuery.js'

function fieldsRejected(query: Record<string, unknown>): string[] {
  try {
    parseRoomQuery(query)
  } catch (error) {
    if (error instanceof ValidationError) return error.details!.map((detail) => detail.field)
    throw error
  }
  return []
}

describe('parseRoomQuery', () => {
  it('applies defaults: active rooms, every inspection state, the open cycle, first page of 20', () => {
    expect(parseRoomQuery({})).toEqual({
      blockId: undefined,
      floorId: undefined,
      search: undefined,
      status: 'active',
      cycleId: undefined,
      inspection: 'all',
      page: 1,
      pageSize: 20,
    })
  })

  it('accepts every parameter and trims the search text', () => {
    expect(parseRoomQuery({ q: ' lab ', block: 'BLK-002', floor: 'FLR-010', status: 'retired', cycle: 'CYC-002', inspection: 'toInspect', page: '3', pageSize: '5' })).toEqual({
      blockId: 'BLK-002',
      floorId: 'FLR-010',
      search: 'lab',
      status: 'retired',
      cycleId: 'CYC-002',
      inspection: 'toInspect',
      page: 3,
      pageSize: 5,
    })
  })

  it.each(['active', 'retired', 'all'])('accepts the status %s', (status) => {
    expect(parseRoomQuery({ status }).status).toBe(status)
  })

  it.each(['all', 'toInspect', 'notStarted', 'inProgress', 'completed', 'unable'])('accepts the inspection filter %s', (inspection) => {
    expect(parseRoomQuery({ inspection }).inspection).toBe(inspection)
  })

  it('treats empty values as absent', () => {
    expect(parseRoomQuery({ q: '  ', block: '', floor: '', status: '', cycle: '', inspection: '' })).toMatchObject({
      search: undefined, blockId: undefined, floorId: undefined, status: 'active', cycleId: undefined, inspection: 'all',
    })
  })

  it('rejects unknown parameters so a misspelt filter cannot silently return everything', () => {
    expect(fieldsRejected({ blok: 'BLK-001', sort: 'code' })).toEqual(['blok', 'sort'])
  })

  it.each([
    ['block', 'FLR-001'],
    ['block', 'BLK-1'],
    ['block', 'B Block'],
    ['floor', 'BLK-001'],
    ['status', 'Active'],
    ['status', 'inactive'],
    ['cycle', 'INS-001'],
    ['cycle', 'CYC-1'],
    ['cycle', 'Summer 2027'],
    ['inspection', 'Completed'],
    ['inspection', 'awaiting'],
    ['inspection', 'In progress'],
  ])('rejects an invalid %s value (%s)', (field, value) => {
    expect(fieldsRejected({ [field]: value })).toEqual([field])
  })

  it('rejects repeated parameters', () => {
    expect(fieldsRejected({ block: ['BLK-001', 'BLK-002'], cycle: ['CYC-001', 'CYC-002'], inspection: ['all', 'unable'] })).toEqual(['block', 'cycle', 'inspection'])
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
  ])('bounds paging: %s=%s', (field, value) => {
    expect(fieldsRejected({ [field]: value })).toEqual([field])
  })

  it('accepts the page size limits', () => {
    expect(parseRoomQuery({ pageSize: '1' }).pageSize).toBe(1)
    expect(parseRoomQuery({ pageSize: '100' }).pageSize).toBe(100)
  })

  it('reports every problem at once', () => {
    expect(fieldsRejected({ block: 'x', floor: 'y', status: 'z', cycle: 'w', inspection: 'v', page: '0' })).toEqual(['block', 'floor', 'status', 'cycle', 'inspection', 'page'])
  })
})

describe('parseCycleQuery', () => {
  const rejected = (query: Record<string, unknown>): string[] => {
    try {
      parseCycleQuery(query)
    } catch (error) {
      if (error instanceof ValidationError) return error.details!.map((detail) => detail.field)
      throw error
    }
    return []
  }

  it('returns the cycle, or undefined for "the open cycle"', () => {
    expect(parseCycleQuery({})).toBeUndefined()
    expect(parseCycleQuery({ cycle: '' })).toBeUndefined()
    expect(parseCycleQuery({ cycle: '  ' })).toBeUndefined()
    expect(parseCycleQuery({ cycle: 'CYC-002' })).toBe('CYC-002')
    expect(parseCycleQuery({ cycle: ' CYC-002 ' })).toBe('CYC-002')
  })

  it.each(['CYC-1', 'cyc-001', 'INS-001', 'Summer', 'CYC-001/x'])('rejects the malformed cycle %s', (cycle) => {
    expect(rejected({ cycle })).toEqual(['cycle'])
  })

  it('rejects a repeated cycle and any other parameter', () => {
    expect(rejected({ cycle: ['CYC-001', 'CYC-002'] })).toEqual(['cycle'])
    expect(rejected({ cyle: 'CYC-001', page: '2' })).toEqual(['cyle', 'page'])
  })
})
