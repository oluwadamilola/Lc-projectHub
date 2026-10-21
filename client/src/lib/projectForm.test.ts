import { describe, expect, it } from 'vitest'
import { projectA } from '../test/fixtures'
import {
  emptyFormValues,
  isDirty,
  isFormField,
  toFieldErrors,
  validateForm,
  valuesFromProject,
  type FormValues,
} from './projectForm'

const filled: FormValues = {
  ...emptyFormValues(new Date(2026, 2, 5)),
  name: 'New Wi-Fi',
  description: 'Better coverage.',
  location: 'Test Building',
  department: 'Infrastructure',
  lead: 'Casey Lane',
  dueDate: '2026-06-30',
}

describe('emptyFormValues', () => {
  it('defaults to planning, medium priority, zero progress and today as the start date', () => {
    expect(emptyFormValues(new Date(2026, 2, 5))).toMatchObject({
      name: '',
      status: 'Planning',
      priority: 'Medium',
      progress: '0',
      startDate: '2026-03-05',
      dueDate: '',
    })
  })

  it('uses the local calendar day, not UTC', () => {
    // 00:30 on 1 January local time is still 1 January, whatever the UTC offset.
    expect(emptyFormValues(new Date(2026, 0, 1, 0, 30)).startDate).toBe('2026-01-01')
    expect(emptyFormValues(new Date(2026, 11, 31, 23, 59)).startDate).toBe('2026-12-31')
  })
})

describe('valuesFromProject', () => {
  it('converts a project to text values, without the reference', () => {
    const values = valuesFromProject(projectA)
    expect(values.progress).toBe('60')
    expect(values.name).toBe('Alpha Network')
    expect(Object.keys(values)).not.toContain('id')
  })
})

describe('validateForm', () => {
  it('accepts valid values and converts progress to a number', () => {
    const result = validateForm({ ...filled, progress: ' 45 ' })
    expect(result).toMatchObject({ ok: true, input: { progress: 45, name: 'New Wi-Fi' } })
  })

  it('trims text', () => {
    expect(validateForm({ ...filled, name: '  Padded  ' })).toMatchObject({ ok: true, input: { name: 'Padded' } })
  })

  it('requires every text field', () => {
    const result = validateForm({ ...filled, name: ' ', description: '', location: '', department: '', lead: '' })
    expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(['name', 'description', 'location', 'department', 'lead'])
  })

  it.each(['', '  ', 'abc', '-1', '101', '2.5', '1e2'])('rejects progress %j', (progress) => {
    const result = validateForm({ ...filled, progress })
    expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(['progress'])
  })

  it.each(['0', '100', '7'])('accepts progress %j', (progress) => {
    expect(validateForm({ ...filled, progress, status: progress === '100' ? 'Complete' : 'On track' }).ok).toBe(true)
  })

  it('rejects an end date before the start date and a missing date', () => {
    const before = validateForm({ ...filled, startDate: '2026-07-01', dueDate: '2026-06-30' })
    expect(before.ok ? [] : before.errors).toEqual([
      { field: 'dueDate', message: 'The target completion date must be on or after the start date.' },
    ])
    const missing = validateForm({ ...filled, dueDate: '' })
    expect(missing.ok ? [] : missing.errors[0]).toMatchObject({ field: 'dueDate', message: 'Enter the target completion date.' })
  })

  it('rejects unsupported status and priority', () => {
    const result = validateForm({ ...filled, status: 'Finished', priority: '' })
    expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(['priority', 'status'])
  })
})

describe('helpers', () => {
  it('keeps the first message per field', () => {
    expect(toFieldErrors([{ field: 'name', message: 'one' }, { field: 'name', message: 'two' }, { field: 'lead', message: 'three' }])).toEqual({
      name: 'one',
      lead: 'three',
    })
  })

  it('recognises form fields', () => {
    expect(isFormField('dueDate')).toBe(true)
    expect(isFormField('id')).toBe(false)
  })

  it('detects unsaved changes', () => {
    expect(isDirty(filled, filled)).toBe(false)
    expect(isDirty({ ...filled, lead: 'Someone else' }, filled)).toBe(true)
  })
})
