import { describe, expect, it } from 'vitest'
import { PROJECT_INPUT_FIELDS, isIsoDate, validateProjectInput } from './validation.js'

const valid = {
  name: 'Test Network Upgrade',
  description: 'Replace switches in the test building.',
  location: 'Test Building One',
  department: 'Infrastructure',
  lead: 'Casey Lane',
  priority: 'High',
  status: 'Planning',
  progress: 0,
  startDate: '2026-03-01',
  dueDate: '2026-06-30',
}

function errorsFor(change: Record<string, unknown>) {
  const result = validateProjectInput({ ...valid, ...change })
  return result.ok ? [] : result.errors
}
const fieldsFor = (change: Record<string, unknown>) => errorsFor(change).map((e) => e.field)

describe('validateProjectInput', () => {
  it('accepts a valid project and returns the clean values', () => {
    expect(validateProjectInput(valid)).toEqual({ ok: true, value: valid })
  })

  it('trims text fields', () => {
    const result = validateProjectInput({ ...valid, name: '  Padded name  ', lead: ' Casey Lane\t' })
    expect(result).toMatchObject({ ok: true, value: { name: 'Padded name', lead: 'Casey Lane' } })
  })

  it('allows line breaks in the description only', () => {
    expect(validateProjectInput({ ...valid, description: 'Line one.\nLine two.' }).ok).toBe(true)
    expect(fieldsFor({ name: 'Line one\nLine two' })).toEqual(['name'])
  })

  it.each(['name', 'description', 'location', 'department', 'lead', 'priority', 'status', 'progress', 'startDate', 'dueDate'])(
    'requires %s',
    (field) => {
      const { [field]: _omitted, ...rest } = valid as Record<string, unknown>
      void _omitted
      const result = validateProjectInput(rest)
      expect(result.ok).toBe(false)
      expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual([field])
    },
  )

  it.each(['name', 'description', 'location', 'department', 'lead'])('rejects blank or whitespace-only %s', (field) => {
    expect(fieldsFor({ [field]: '   ' })).toEqual([field])
    expect(errorsFor({ [field]: '' })[0].message).toMatch(/^Enter the /)
  })

  it('rejects text that is too long, and accepts the exact limit', () => {
    expect(fieldsFor({ name: 'x'.repeat(101) })).toEqual(['name'])
    expect(fieldsFor({ name: 'x'.repeat(100) })).toEqual([])
    expect(fieldsFor({ description: 'x'.repeat(1001) })).toEqual(['description'])
    expect(fieldsFor({ description: 'x'.repeat(1000) })).toEqual([])
  })

  it('rejects non-text values and control characters', () => {
    expect(fieldsFor({ name: 42 })).toEqual(['name'])
    expect(fieldsFor({ lead: ['Casey'] })).toEqual(['lead'])
    expect(fieldsFor({ location: 'Bad\u0000place' })).toEqual(['location'])
  })

  it('rejects unsupported status and priority values', () => {
    expect(fieldsFor({ status: 'Finished' })).toEqual(['status'])
    expect(fieldsFor({ status: 'on track' })).toEqual(['status'])
    expect(fieldsFor({ priority: 'Urgent' })).toEqual(['priority'])
    expect(fieldsFor({ priority: 3 })).toEqual(['priority'])
    expect(errorsFor({ priority: '' })[0].message).toBe('Choose a priority.')
  })

  it.each([-1, 101, 1.5, Number.NaN, Infinity, '50', null, true])('rejects progress %j', (progress) => {
    expect(fieldsFor({ progress })).toEqual(['progress'])
  })

  it.each([0, 1, 50, 100])('accepts progress %d', (progress) => {
    expect(fieldsFor({ progress, status: 'On track' })).toEqual([])
  })

  it('requires a completed project to be 100% complete', () => {
    expect(errorsFor({ status: 'Complete', progress: 90 })).toEqual([
      { field: 'progress', message: 'A completed project must be 100% complete.' },
    ])
    expect(fieldsFor({ status: 'Complete', progress: 100 })).toEqual([])
  })

  it('rejects malformed and impossible dates', () => {
    expect(fieldsFor({ startDate: '01/03/2026' })).toEqual(['startDate'])
    expect(fieldsFor({ startDate: '2026-02-30' })).toEqual(['startDate'])
    expect(fieldsFor({ dueDate: '2026-13-01' })).toEqual(['dueDate'])
    expect(fieldsFor({ dueDate: '2026-6-30' })).toEqual(['dueDate'])
    expect(fieldsFor({ dueDate: 20260630 })).toEqual(['dueDate'])
    expect(fieldsFor({ startDate: '1800-01-01', dueDate: '2026-06-30' })).toEqual(['startDate'])
  })

  it('rejects a target date before the start date, but allows the same day', () => {
    expect(errorsFor({ startDate: '2026-07-01', dueDate: '2026-06-30' })).toEqual([
      { field: 'dueDate', message: 'The target completion date must be on or after the start date.' },
    ])
    expect(fieldsFor({ startDate: '2026-06-30', dueDate: '2026-06-30' })).toEqual([])
  })

  it('accepts leap days only in leap years', () => {
    expect(fieldsFor({ startDate: '2028-02-29', dueDate: '2028-03-01' })).toEqual([])
    expect(fieldsFor({ startDate: '2027-02-29' })).toEqual(['startDate'])
  })

  it('rejects unknown fields, including an attempt to set the reference', () => {
    expect(errorsFor({ id: 'PRJ-999' })).toEqual([{ field: 'id', message: 'This field is not recognised.' }])
    expect(fieldsFor({ statuss: 'Planning' })).toEqual(['statuss'])
  })

  it.each([null, undefined, 'text', 42, [], [valid]])('rejects a body that is not an object: %j', (body) => {
    expect(validateProjectInput(body)).toEqual({
      ok: false,
      errors: [{ field: 'body', message: 'Send the project as a JSON object.' }],
    })
  })

  it('reports every problem at once, in form order', () => {
    const result = validateProjectInput({ ...valid, dueDate: 'x', name: '', progress: 500, extra: 1 })
    expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(['name', 'progress', 'dueDate', 'extra'])
  })

  it('lists every field it validates', () => {
    expect([...PROJECT_INPUT_FIELDS].sort()).toEqual(Object.keys(valid).sort())
  })
})

describe('isIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(isIsoDate('2026-01-31')).toBe(true)
    expect(isIsoDate('2000-02-29')).toBe(true)
  })
  it('rejects everything else', () => {
    for (const bad of ['', '2026-1-1', '2026-04-31', '2026-00-10', '2026-01-00', '2100-12-32', ' 2026-01-01', '2026-01-01T00:00']) {
      expect(isIsoDate(bad)).toBe(false)
    }
  })
})
