import type { TaskInput } from '@lc-projecthub/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { fixtureTasks } from '../testing/taskFixtures.js'
import { InMemoryTaskRepository } from './inMemoryTaskRepository.js'
import { InMemoryTechnicianRepository } from './inMemoryTechnicianRepository.js'

const input: TaskInput = {
  title: 'Label the cables',
  description: 'Both ends of every run.',
  status: 'To do',
  priority: 'Medium',
  assigneeId: 'TECH-002',
  startDate: '2026-03-01',
  dueDate: '2026-03-10',
}

const all = (projectId: string) => ({ projectId, page: 1, pageSize: 50 })
const ids = (items: { id: string }[]) => items.map((item) => item.id)

let repo: InMemoryTaskRepository
beforeEach(() => {
  repo = new InMemoryTaskRepository(fixtureTasks)
})

describe('InMemoryTaskRepository.list', () => {
  it('lists only the tasks of the requested project', async () => {
    expect(ids((await repo.list(all('PRJ-001'))).items)).toEqual(['TASK-001', 'TASK-002', 'TASK-003', 'TASK-005'])
    expect(ids((await repo.list(all('PRJ-002'))).items)).toEqual(['TASK-004'])
  })

  it('returns an empty page for a project with no tasks', async () => {
    expect(await repo.list(all('PRJ-003'))).toEqual({ items: [], total: 0 })
    expect(await repo.list(all('PRJ-999'))).toEqual({ items: [], total: 0 })
  })

  it('orders by due date, then reference', async () => {
    const shuffled = new InMemoryTaskRepository([...fixtureTasks].reverse())
    expect(ids((await shuffled.list(all('PRJ-001'))).items)).toEqual(['TASK-001', 'TASK-002', 'TASK-003', 'TASK-005'])
    const sameDay = new InMemoryTaskRepository([
      { ...fixtureTasks[0], id: 'TASK-010', dueDate: '2026-05-01' },
      { ...fixtureTasks[0], id: 'TASK-009', dueDate: '2026-05-01' },
      { ...fixtureTasks[0], id: 'TASK-002', dueDate: '2026-04-01' },
    ])
    expect(ids((await sameDay.list(all('PRJ-001'))).items)).toEqual(['TASK-002', 'TASK-009', 'TASK-010'])
  })

  it('filters by status', async () => {
    const { items } = await repo.list({ ...all('PRJ-001'), status: 'To do' })
    expect(ids(items)).toEqual(['TASK-003', 'TASK-005'])
  })

  it('filters by technician and by "unassigned"', async () => {
    expect(ids((await repo.list({ ...all('PRJ-001'), assignee: 'TECH-002' })).items)).toEqual(['TASK-002', 'TASK-005'])
    expect(ids((await repo.list({ ...all('PRJ-001'), assignee: 'unassigned' })).items)).toEqual(['TASK-003'])
    expect((await repo.list({ ...all('PRJ-001'), assignee: 'TECH-099' })).total).toBe(0)
  })

  it('searches reference, title and description without regard to case', async () => {
    const find = async (search: string) => ids((await repo.list({ ...all('PRJ-001'), search })).items)
    expect(await find('SURVEY')).toEqual(['TASK-001'])
    expect(await find('purchase request')).toEqual(['TASK-002'])
    expect(await find('task-005')).toEqual(['TASK-005'])
    expect(await find('   ')).toHaveLength(4)
    expect(await find('nothing like this')).toEqual([])
  })

  it('does not search inside other projects', async () => {
    expect((await repo.list({ ...all('PRJ-001'), search: 'laptops' })).total).toBe(0)
  })

  it('combines filters', async () => {
    const { items } = await repo.list({ ...all('PRJ-001'), status: 'To do', assignee: 'TECH-002', search: 'test' })
    expect(ids(items)).toEqual(['TASK-005'])
  })

  it('pages results while reporting the unpaged total', async () => {
    const first = await repo.list({ projectId: 'PRJ-001', page: 1, pageSize: 3 })
    const second = await repo.list({ projectId: 'PRJ-001', page: 2, pageSize: 3 })
    expect(first.total).toBe(4)
    expect(ids(first.items)).toEqual(['TASK-001', 'TASK-002', 'TASK-003'])
    expect(ids(second.items)).toEqual(['TASK-005'])
    expect((await repo.list({ projectId: 'PRJ-001', page: 9, pageSize: 3 })).items).toEqual([])
  })
})

describe('InMemoryTaskRepository.findById', () => {
  it('finds a task or returns null', async () => {
    expect((await repo.findById('TASK-004'))?.title).toBe('Image the laptops')
    expect(await repo.findById('TASK-999')).toBeNull()
  })

  it('returns copies', async () => {
    const task = await repo.findById('TASK-001')
    task!.title = 'Changed'
    expect((await repo.findById('TASK-001'))?.title).toBe('Survey the site')
  })
})

describe('InMemoryTaskRepository.create', () => {
  it('assigns the next reference, across all projects', async () => {
    const created = await repo.create('PRJ-002', input)
    expect(created).toEqual({ ...input, id: 'TASK-006', projectId: 'PRJ-002' })
    expect((await repo.create('PRJ-001', input)).id).toBe('TASK-007')
  })

  it('starts at TASK-001 for an empty repository', async () => {
    expect((await new InMemoryTaskRepository([]).create('PRJ-001', input)).id).toBe('TASK-001')
  })

  it('gives every task a unique reference, including simultaneous calls', async () => {
    const created = await Promise.all(Array.from({ length: 40 }, () => repo.create('PRJ-001', input)))
    expect(new Set(created.map((task) => task.id)).size).toBe(40)
    expect(created[0].id).toBe('TASK-006')
    expect(created[39].id).toBe('TASK-045')
  })

  it('keeps references unique past three digits', async () => {
    const big = new InMemoryTaskRepository([{ ...fixtureTasks[0], id: 'TASK-999' }])
    expect((await big.create('PRJ-001', input)).id).toBe('TASK-1000')
  })

  it('makes the task appear in its own project only', async () => {
    const created = await repo.create('PRJ-003', input)
    expect(ids((await repo.list(all('PRJ-003'))).items)).toEqual([created.id])
    expect((await repo.list(all('PRJ-001'))).total).toBe(4)
  })

  it('ignores a project or reference smuggled into the input and does not keep the caller object', async () => {
    const sneaky = { ...input, id: 'TASK-001', projectId: 'PRJ-009' } as TaskInput
    const created = await repo.create('PRJ-003', sneaky)
    expect(created).toMatchObject({ id: 'TASK-006', projectId: 'PRJ-003' })
    expect((await repo.findById('TASK-001'))?.title).toBe('Survey the site')
    created.title = 'Changed result'
    expect((await repo.findById('TASK-006'))?.title).toBe('Label the cables')
  })
})

describe('InMemoryTaskRepository.update', () => {
  it('replaces every editable field and keeps the reference and project', async () => {
    const updated = await repo.update('TASK-004', input)
    expect(updated).toEqual({ ...input, id: 'TASK-004', projectId: 'PRJ-002' })
    expect(await repo.findById('TASK-004')).toEqual(updated)
  })

  it('cannot move a task to another project or change its reference', async () => {
    const sneaky = { ...input, projectId: 'PRJ-001', id: 'TASK-001' } as TaskInput
    expect(await repo.update('TASK-004', sneaky)).toMatchObject({ id: 'TASK-004', projectId: 'PRJ-002' })
    expect((await repo.findById('TASK-001'))?.title).toBe('Survey the site')
  })

  it('leaves every other task untouched', async () => {
    await repo.update('TASK-004', input)
    for (const original of fixtureTasks.filter((task) => task.id !== 'TASK-004')) {
      expect(await repo.findById(original.id)).toEqual(original)
    }
  })

  it('returns null for a missing task and changes nothing', async () => {
    expect(await repo.update('TASK-999', input)).toBeNull()
    expect((await repo.list(all('PRJ-001'))).total).toBe(4)
  })

  it('is reflected in filters and ordering', async () => {
    await repo.update('TASK-005', { ...input, status: 'Done', dueDate: '2026-01-01', startDate: '2026-01-01' })
    expect(ids((await repo.list({ ...all('PRJ-001'), status: 'Done' })).items)).toEqual(['TASK-005', 'TASK-001'])
  })

  it('returns copies and never changes the data it was constructed with', async () => {
    const updated = await repo.update('TASK-004', input)
    updated!.title = 'Changed result'
    expect((await repo.findById('TASK-004'))?.title).toBe('Label the cables')
    expect(fixtureTasks[3].title).toBe('Image the laptops')
  })
})

describe('InMemoryTechnicianRepository', () => {
  const technicians = new InMemoryTechnicianRepository([{ id: 'TECH-001', name: 'Test One', team: 'A' }])

  it('lists and finds technicians', async () => {
    expect(await technicians.list()).toEqual([{ id: 'TECH-001', name: 'Test One', team: 'A' }])
    expect((await technicians.findById('TECH-001'))?.name).toBe('Test One')
    expect(await technicians.findById('TECH-002')).toBeNull()
  })

  it('returns copies', async () => {
    const [first] = await technicians.list()
    first.name = 'Changed'
    expect((await technicians.findById('TECH-001'))?.name).toBe('Test One')
  })
})
