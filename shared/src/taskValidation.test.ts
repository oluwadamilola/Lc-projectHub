import { describe, expect, it } from 'vitest'
import { TASK_INPUT_FIELDS, TECHNICIAN_ID_PATTERN, validateTaskInput } from './taskValidation.js'

const valid = {
  title: 'Install access points',
  description: 'Mount and cable four access points on the first floor.',
  status: 'To do',
  priority: 'High',
  assigneeId: 'TECH-001',
  startDate: '2026-03-01',
  dueDate: '2026-03-15',
}

function errorsFor(change: Record<string, unknown>) {
  const result = validateTaskInput({ ...valid, ...change })
  return result.ok ? [] : result.errors
}
const fieldsFor = (change: Record<string, unknown>) => errorsFor(change).map((e) => e.field)

describe('validateTaskInput', () => {
  it('accepts a valid task and returns the clean values', () => {
    expect(validateTaskInput(valid)).toEqual({ ok: true, value: valid })
  })

  it('trims text fields', () => {
    expect(validateTaskInput({ ...valid, title: '  Padded title ', description: '  Notes  ' })).toMatchObject({
      ok: true,
      value: { title: 'Padded title', description: 'Notes' },
    })
  })

  describe('title', () => {
    it.each([undefined, null, '', '   '])('is required (%j)', (title) => {
      expect(errorsFor({ title })).toEqual([{ field: 'title', message: 'Enter the task title.' }])
    })
    it('has a 120 character limit', () => {
      expect(fieldsFor({ title: 'x'.repeat(121) })).toEqual(['title'])
      expect(fieldsFor({ title: 'x'.repeat(120) })).toEqual([])
    })
    it('must be single-line text', () => {
      expect(fieldsFor({ title: 'two\nlines' })).toEqual(['title'])
      expect(fieldsFor({ title: 42 })).toEqual(['title'])
      expect(fieldsFor({ title: 'bad\u0000char' })).toEqual(['title'])
    })
  })

  describe('description', () => {
    it('is optional', () => {
      expect(validateTaskInput({ ...valid, description: '' })).toMatchObject({ ok: true, value: { description: '' } })
      expect(validateTaskInput({ ...valid, description: '   ' })).toMatchObject({ ok: true, value: { description: '' } })
      const { description: _omitted, ...without } = valid
      void _omitted
      expect(validateTaskInput(without)).toMatchObject({ ok: true, value: { description: '' } })
      expect(validateTaskInput({ ...valid, description: null })).toMatchObject({ ok: true, value: { description: '' } })
    })
    it('allows line breaks and has a 1000 character limit', () => {
      expect(fieldsFor({ description: 'one\ntwo' })).toEqual([])
      expect(fieldsFor({ description: 'x'.repeat(1001) })).toEqual(['description'])
      expect(fieldsFor({ description: 'x'.repeat(1000) })).toEqual([])
    })
    it('must be text', () => {
      expect(fieldsFor({ description: 5 })).toEqual(['description'])
    })
  })

  describe('status and priority', () => {
    it.each(['To do', 'In progress', 'Blocked', 'Done'])('accepts status %s', (status) => {
      expect(fieldsFor({ status })).toEqual([])
    })
    it.each(['Low', 'Medium', 'High', 'Critical'])('accepts priority %s', (priority) => {
      expect(fieldsFor({ priority })).toEqual([])
    })
    it('rejects unsupported values, other casing and project-only statuses', () => {
      expect(fieldsFor({ status: 'Finished' })).toEqual(['status'])
      expect(fieldsFor({ status: 'in progress' })).toEqual(['status'])
      expect(fieldsFor({ status: 'On track' })).toEqual(['status'])
      expect(fieldsFor({ priority: 'Urgent' })).toEqual(['priority'])
      expect(fieldsFor({ priority: 2 })).toEqual(['priority'])
    })
    it('requires both', () => {
      expect(errorsFor({ status: '' })).toEqual([{ field: 'status', message: 'Choose a status.' }])
      expect(errorsFor({ priority: undefined })).toEqual([{ field: 'priority', message: 'Choose a priority.' }])
    })
  })

  describe('assigneeId', () => {
    it('may be null or left out, meaning unassigned', () => {
      expect(validateTaskInput({ ...valid, assigneeId: null })).toMatchObject({ ok: true, value: { assigneeId: null } })
      const { assigneeId: _omitted, ...without } = valid
      void _omitted
      expect(validateTaskInput(without)).toMatchObject({ ok: true, value: { assigneeId: null } })
    })
    it.each(['', ' ', 'TECH-1', 'tech-001', 'TECH-0001234', 'PRJ-101', 'TECH-001 ', 7, true, ['TECH-001']])(
      'rejects %j',
      (assigneeId) => {
        expect(errorsFor({ assigneeId })).toEqual([
          { field: 'assigneeId', message: 'Choose a technician from the list, or leave the task unassigned.' },
        ])
      },
    )
    it('matches the technician reference pattern', () => {
      expect(TECHNICIAN_ID_PATTERN.test('TECH-006')).toBe(true)
      expect(TECHNICIAN_ID_PATTERN.test('TECH-006x')).toBe(false)
    })
  })

  describe('dates', () => {
    it.each(['startDate', 'dueDate'])('requires %s', (field) => {
      expect(fieldsFor({ [field]: undefined })).toEqual([field])
      expect(fieldsFor({ [field]: '' })).toEqual([field])
    })
    it('rejects malformed and impossible dates', () => {
      expect(fieldsFor({ startDate: '01/03/2026' })).toEqual(['startDate'])
      expect(fieldsFor({ startDate: '2026-02-30' })).toEqual(['startDate'])
      expect(fieldsFor({ dueDate: '2026-13-01' })).toEqual(['dueDate'])
      expect(fieldsFor({ dueDate: 20260315 })).toEqual(['dueDate'])
    })
    it('rejects a due date before the start date, and allows the same day', () => {
      expect(errorsFor({ startDate: '2026-03-16', dueDate: '2026-03-15' })).toEqual([
        { field: 'dueDate', message: 'The due date must be on or after the start date.' },
      ])
      expect(fieldsFor({ startDate: '2026-03-15', dueDate: '2026-03-15' })).toEqual([])
    })
    it('does not also report a range error when a date is already invalid', () => {
      expect(errorsFor({ startDate: 'nope', dueDate: '2026-03-15' })).toHaveLength(1)
    })
  })

  it('rejects unknown fields, including attempts to set the reference, project or technician name', () => {
    expect(errorsFor({ id: 'TASK-999' })).toEqual([{ field: 'id', message: 'This field is not recognised.' }])
    expect(fieldsFor({ projectId: 'PRJ-101' })).toEqual(['projectId'])
    expect(fieldsFor({ assigneeName: 'Someone' })).toEqual(['assigneeName'])
    expect(fieldsFor({ statuss: 'Done' })).toEqual(['statuss'])
  })

  it.each([null, undefined, 'text', 42, [], [valid]])('rejects a body that is not an object: %j', (body) => {
    expect(validateTaskInput(body)).toEqual({
      ok: false,
      errors: [{ field: 'body', message: 'Send the task as a JSON object.' }],
    })
  })

  it('reports every problem at once, in form order, with unknown fields last', () => {
    const result = validateTaskInput({ ...valid, dueDate: 'x', title: '', status: 'nope', extra: 1 })
    expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(['title', 'status', 'dueDate', 'extra'])
  })

  it('lists every field it validates', () => {
    expect([...TASK_INPUT_FIELDS].sort()).toEqual(Object.keys(valid).sort())
  })
})
