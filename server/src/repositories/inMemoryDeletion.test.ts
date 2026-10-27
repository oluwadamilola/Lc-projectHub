import { beforeEach, describe, expect, it } from 'vitest'
import { fixtureProjects } from '../testing/fixtures.js'
import { fixtureTasks } from '../testing/taskFixtures.js'
import { InMemoryProjectRepository } from './inMemoryProjectRepository.js'
import { InMemoryTaskRepository } from './inMemoryTaskRepository.js'

const everyone = { page: 1, pageSize: 50, today: '2026-02-10' }
const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe('InMemoryTaskRepository deletion', () => {
  let repo: InMemoryTaskRepository
  beforeEach(() => {
    repo = new InMemoryTaskRepository(fixtureTasks)
  })

  it('delete removes one task and returns it', async () => {
    const removed = await repo.delete('TASK-002')
    expect(removed).toMatchObject({ id: 'TASK-002', projectId: 'PRJ-001', title: 'Order switches' })
    expect(await repo.findById('TASK-002')).toBeNull()
    expect(ids((await repo.listAll(everyone)).items)).toEqual(['TASK-001', 'TASK-004', 'TASK-003', 'TASK-005'])
  })

  it('delete of a missing task is null and changes nothing', async () => {
    expect(await repo.delete('TASK-999')).toBeNull()
    expect((await repo.listAll(everyone)).total).toBe(5)
  })

  it('deleting twice removes it once: the second time is null', async () => {
    expect(await repo.delete('TASK-001')).not.toBeNull()
    expect(await repo.delete('TASK-001')).toBeNull()
  })

  it('delete returns a copy, not the stored object', async () => {
    const removed = (await repo.delete('TASK-001'))!
    removed.title = 'Changed'
    await repo.restore([removed])
    expect((await repo.findById('TASK-001'))?.title).toBe('Changed') // restore stores what it is given...
    removed.title = 'Changed again'
    expect((await repo.findById('TASK-001'))?.title).toBe('Changed') // ...but as its own copy
  })

  it('never hands a deleted reference to a new task', async () => {
    await repo.delete('TASK-005') // the highest reference
    const created = await repo.create('PRJ-001', {
      title: 'New', description: '', status: 'To do', priority: 'Low', assigneeId: null, startDate: '2026-03-01', dueDate: '2026-03-02',
    })
    expect(created.id).toBe('TASK-006')
  })

  it('deleteByProject removes exactly that project\'s tasks and returns them', async () => {
    const removed = await repo.deleteByProject('PRJ-001')
    expect(ids(removed)).toEqual(['TASK-001', 'TASK-002', 'TASK-003', 'TASK-005'])
    expect(ids((await repo.listAll(everyone)).items)).toEqual(['TASK-004'])
  })

  it('deleteByProject is an empty result, not an error, when there is nothing to remove', async () => {
    expect(await repo.deleteByProject('PRJ-003')).toEqual([])
    expect(await repo.deleteByProject('PRJ-999')).toEqual([])
    expect((await repo.listAll(everyone)).total).toBe(5)
  })

  it('restore puts removed tasks back exactly as they were, in order, once', async () => {
    const before = await repo.listAll(everyone)
    const removed = await repo.deleteByProject('PRJ-001')
    await repo.restore(removed)
    expect(await repo.listAll(everyone)).toEqual(before)
    await repo.restore(removed) // restoring twice does not duplicate anything
    expect((await repo.listAll(everyone)).total).toBe(5)
  })

  it('restore does not overwrite a task that has the same reference', async () => {
    const removed = (await repo.delete('TASK-001'))!
    await repo.restore([{ ...removed, title: 'Stale copy' }, { ...removed, id: 'TASK-001' }])
    expect((await repo.findById('TASK-001'))?.title).toBe('Stale copy') // the first one wins, the duplicate is ignored
    expect((await repo.listAll(everyone)).total).toBe(5)
  })
})

describe('InMemoryProjectRepository deletion', () => {
  let repo: InMemoryProjectRepository
  beforeEach(() => {
    repo = new InMemoryProjectRepository(fixtureProjects)
  })

  it('delete removes the project and returns it', async () => {
    const removed = await repo.delete('PRJ-002')
    expect(removed).toMatchObject({ id: 'PRJ-002', name: 'Bravo Laptops' })
    expect(await repo.findById('PRJ-002')).toBeNull()
    expect((await repo.list({ page: 1, pageSize: 50 })).total).toBe(4)
  })

  it('delete of a missing project is null and changes nothing', async () => {
    expect(await repo.delete('PRJ-999')).toBeNull()
    expect((await repo.list({ page: 1, pageSize: 50 })).total).toBe(5)
  })

  it('deleting twice removes it once', async () => {
    expect(await repo.delete('PRJ-001')).not.toBeNull()
    expect(await repo.delete('PRJ-001')).toBeNull()
  })

  it('never hands a deleted reference to a new project', async () => {
    await repo.delete('PRJ-011') // the highest reference
    const { id: _id, ...input } = fixtureProjects[0]
    void _id
    expect((await repo.create(input)).id).toBe('PRJ-012')
  })
})
