import { describe, expect, it } from 'vitest'
import { taskA, taskB } from '../test/fixtures'
import {
  emptyTaskFormValues,
  isTaskFormDirty,
  isTaskFormField,
  validateTaskForm,
  valuesFromTask,
  type TaskFormValues,
} from './taskForm'

const filled: TaskFormValues = {
  ...emptyTaskFormValues(new Date(2026, 2, 5)),
  title: 'Label the cables',
  dueDate: '2026-03-20',
}

describe('emptyTaskFormValues', () => {
  it('defaults to to do, medium priority, unassigned and starting today', () => {
    expect(emptyTaskFormValues(new Date(2026, 2, 5))).toEqual({
      title: '',
      description: '',
      status: 'To do',
      priority: 'Medium',
      assigneeId: '',
      startDate: '2026-03-05',
      dueDate: '',
    })
  })

  it('uses the local calendar day', () => {
    expect(emptyTaskFormValues(new Date(2026, 0, 1, 0, 30)).startDate).toBe('2026-01-01')
    expect(emptyTaskFormValues(new Date(2026, 11, 31, 23, 59)).startDate).toBe('2026-12-31')
  })
})

describe('valuesFromTask', () => {
  it('converts a task to text values without the reference, project or technician name', () => {
    const values = valuesFromTask(taskA)
    expect(values).toEqual({
      title: 'Survey the site',
      description: 'Walk every room and note the cable routes.',
      status: 'In progress',
      priority: 'High',
      assigneeId: 'TECH-001',
      startDate: '2000-01-05',
      dueDate: '2099-01-12',
    })
  })

  it('shows an unassigned task as an empty technician', () => {
    expect(valuesFromTask(taskB).assigneeId).toBe('')
  })
})

describe('validateTaskForm', () => {
  it('accepts valid values, trims text and turns "Unassigned" into null', () => {
    expect(validateTaskForm({ ...filled, title: '  Label the cables ' })).toMatchObject({
      ok: true,
      input: { title: 'Label the cables', assigneeId: null, description: '' },
    })
  })

  it('keeps a chosen technician', () => {
    expect(validateTaskForm({ ...filled, assigneeId: 'TECH-002' })).toMatchObject({ ok: true, input: { assigneeId: 'TECH-002' } })
  })

  it('requires a title and a due date', () => {
    const result = validateTaskForm({ ...filled, title: ' ', dueDate: '' })
    expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(['title', 'dueDate'])
  })

  it('rejects a due date before the start date', () => {
    const result = validateTaskForm({ ...filled, startDate: '2026-03-21', dueDate: '2026-03-20' })
    expect(result.ok ? [] : result.errors).toEqual([
      { field: 'dueDate', message: 'The due date must be on or after the start date.' },
    ])
  })

  it('rejects unsupported status, priority and technician values', () => {
    const result = validateTaskForm({ ...filled, status: 'Finished', priority: '', assigneeId: 'bob' })
    expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(['status', 'priority', 'assigneeId'])
  })
})

describe('helpers', () => {
  it('recognises task form fields', () => {
    expect(isTaskFormField('assigneeId')).toBe(true)
    expect(isTaskFormField('projectId')).toBe(false)
  })

  it('detects unsaved changes', () => {
    expect(isTaskFormDirty(filled, filled)).toBe(false)
    expect(isTaskFormDirty({ ...filled, description: 'Notes' }, filled)).toBe(true)
    expect(isTaskFormDirty({ ...filled, assigneeId: 'TECH-001' }, filled)).toBe(true)
  })
})
