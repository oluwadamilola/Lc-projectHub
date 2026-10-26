import { beforeEach, describe, expect, it } from 'vitest'
import type { AllTasksCriteria, TaskRecord } from '../domain/taskRepository.js'
import { fixtureTasks } from '../testing/taskFixtures.js'
import { InMemoryTaskRepository } from './inMemoryTaskRepository.js'

/*
  Fixture tasks, soonest deadline first:
    TASK-001 PRJ-001 Done        High     TECH-001  due 2026-01-12
    TASK-002 PRJ-001 In progress Medium   TECH-002  due 2026-02-01
    TASK-004 PRJ-002 Blocked     Critical TECH-001  due 2026-02-10
    TASK-003 PRJ-001 To do       High     nobody    due 2026-02-20
    TASK-005 PRJ-001 To do       Low      TECH-002  due 2026-02-28
  2026-02-01 is a Sunday, so 9 to 15 Feb is a Monday-to-Sunday week.
*/

const query = (overrides: Partial<AllTasksCriteria> = {}): AllTasksCriteria => ({
  today: '2026-02-10',
  page: 1,
  pageSize: 50,
  ...overrides,
})
const ids = (items: { id: string }[]) => items.map((item) => item.id)

let repo: InMemoryTaskRepository
beforeEach(() => {
  repo = new InMemoryTaskRepository(fixtureTasks)
})

describe('InMemoryTaskRepository.listAll', () => {
  it('lists the tasks of every project, soonest deadline first', async () => {
    const page = await repo.listAll(query())
    expect(ids(page.items)).toEqual(['TASK-001', 'TASK-002', 'TASK-004', 'TASK-003', 'TASK-005'])
    expect(page.total).toBe(5)
  })

  it('filters by project', async () => {
    expect(ids((await repo.listAll(query({ projectId: 'PRJ-002' }))).items)).toEqual(['TASK-004'])
    expect((await repo.listAll(query({ projectId: 'PRJ-003' }))).total).toBe(0)
    expect((await repo.listAll(query({ projectId: 'PRJ-999' }))).total).toBe(0)
  })

  it('filters by status and by priority', async () => {
    expect(ids((await repo.listAll(query({ status: 'To do' }))).items)).toEqual(['TASK-003', 'TASK-005'])
    expect(ids((await repo.listAll(query({ priority: 'High' }))).items)).toEqual(['TASK-001', 'TASK-003'])
  })

  it('filters by technician and by unassigned', async () => {
    expect(ids((await repo.listAll(query({ assignee: 'TECH-001' }))).items)).toEqual(['TASK-001', 'TASK-004'])
    expect(ids((await repo.listAll(query({ assignee: 'unassigned' }))).items)).toEqual(['TASK-003'])
    expect((await repo.listAll(query({ assignee: 'TECH-099' }))).total).toBe(0)
  })

  it('searches reference, title and description without regard to case', async () => {
    expect(ids((await repo.listAll(query({ search: 'SWITCH' }))).items)).toEqual(['TASK-002', 'TASK-003'])
    expect(ids((await repo.listAll(query({ search: 'task-004' }))).items)).toEqual(['TASK-004'])
    expect(ids((await repo.listAll(query({ search: 'purchase request' }))).items)).toEqual(['TASK-002'])
    expect((await repo.listAll(query({ search: 'zzz' }))).total).toBe(0)
  })

  it('combines filters', async () => {
    const page = await repo.listAll(query({ projectId: 'PRJ-001', status: 'To do', assignee: 'TECH-002' }))
    expect(ids(page.items)).toEqual(['TASK-005'])
  })

  it('pages the results and reports the total ignoring paging', async () => {
    const first = await repo.listAll(query({ pageSize: 2 }))
    expect(ids(first.items)).toEqual(['TASK-001', 'TASK-002'])
    expect(first.total).toBe(5)
    expect(ids((await repo.listAll(query({ pageSize: 2, page: 3 }))).items)).toEqual(['TASK-005'])
    expect(await repo.listAll(query({ pageSize: 2, page: 4 }))).toMatchObject({ items: [], total: 5 })
  })

  it('returns copies, not the stored objects', async () => {
    const page = await repo.listAll(query())
    page.items[0].title = 'Changed'
    expect((await repo.findById('TASK-001'))?.title).toBe('Survey the site')
  })

  it('includes tasks created later', async () => {
    const created = await repo.create('PRJ-002', {
      title: 'New one',
      description: '',
      status: 'To do',
      priority: 'Low',
      assigneeId: null,
      startDate: '2026-02-01',
      dueDate: '2026-02-05',
    })
    expect((await repo.listAll(query())).items.map((task) => task.id)).toContain(created.id)
  })
})

describe('InMemoryTaskRepository.listAll: overdue and due this week', () => {
  it('overdue means outstanding and strictly before today', async () => {
    // Due 2026-02-01 is before the 10th; TASK-004 is due ON the 10th, so it is not overdue yet.
    expect(ids((await repo.listAll(query({ due: 'overdue', today: '2026-02-10' }))).items)).toEqual(['TASK-002'])
    expect(ids((await repo.listAll(query({ due: 'overdue', today: '2026-02-11' }))).items)).toEqual(['TASK-002', 'TASK-004'])
  })

  it('a task is not overdue on its due day, but is the day after', async () => {
    expect((await repo.listAll(query({ due: 'overdue', today: '2026-02-01' }))).total).toBe(0)
    expect(ids((await repo.listAll(query({ due: 'overdue', today: '2026-02-02' }))).items)).toEqual(['TASK-002'])
  })

  it('never treats a completed task as overdue, however old', async () => {
    expect(ids((await repo.listAll(query({ due: 'overdue', today: '2030-01-01' }))).items)).not.toContain('TASK-001')
  })

  it('this week runs Monday to Sunday and ignores finished tasks', async () => {
    // Week of Mon 9 to Sun 15 Feb contains TASK-004 only.
    expect(ids((await repo.listAll(query({ due: 'this-week', today: '2026-02-10' }))).items)).toEqual(['TASK-004'])
    expect(ids((await repo.listAll(query({ due: 'this-week', today: '2026-02-09' }))).items)).toEqual(['TASK-004'])
    expect(ids((await repo.listAll(query({ due: 'this-week', today: '2026-02-15' }))).items)).toEqual(['TASK-004'])
    // Monday 16 Feb starts the next week (TASK-003 is due Fri 20 Feb); Sunday 8 Feb is still the week before.
    expect(ids((await repo.listAll(query({ due: 'this-week', today: '2026-02-16' }))).items)).toEqual(['TASK-003'])
    expect((await repo.listAll(query({ due: 'this-week', today: '2026-02-08' }))).total).toBe(0)
    // TASK-001 is Done and due 12 Jan: not counted in its own week.
    expect((await repo.listAll(query({ due: 'this-week', today: '2026-01-12' }))).total).toBe(0)
  })

  it('combines the due filter with other filters', async () => {
    const page = await repo.listAll(query({ due: 'overdue', today: '2026-03-01', assignee: 'TECH-001' }))
    expect(ids(page.items)).toEqual(['TASK-004'])
  })
})

describe('InMemoryTaskRepository.listAll: summary counts', () => {
  it('counts outstanding and overdue tasks over every match, not just the page', async () => {
    const page = await repo.listAll(query({ today: '2026-02-15', pageSize: 1 }))
    expect(page.items).toHaveLength(1)
    // Outstanding: everything but TASK-001 (Done). Overdue on the 15th: TASK-002 (1 Feb) and TASK-004 (10 Feb).
    expect(page).toMatchObject({ total: 5, outstanding: 4, overdue: 2 })
  })

  it('counts within the filters', async () => {
    expect(await repo.listAll(query({ today: '2026-03-01', projectId: 'PRJ-001' }))).toMatchObject({
      total: 4,
      outstanding: 3,
      overdue: 3,
    })
    expect(await repo.listAll(query({ today: '2026-03-01', status: 'Done' }))).toMatchObject({
      total: 1,
      outstanding: 0,
      overdue: 0,
    })
  })

  it('counts nothing for an empty result', async () => {
    expect(await repo.listAll(query({ search: 'zzz' }))).toEqual({ items: [], total: 0, outstanding: 0, overdue: 0 })
  })

  it('agrees with the "overdue" filter on the same day', async () => {
    for (const today of ['2026-01-01', '2026-02-01', '2026-02-10', '2026-02-11', '2026-03-01']) {
      const all = await repo.listAll(query({ today }))
      const overdue = await repo.listAll(query({ today, due: 'overdue' }))
      expect(all.overdue).toBe(overdue.total)
    }
  })
})

describe('InMemoryTaskRepository.listAll: missing or invalid due dates', () => {
  const broken = (id: string, dueDate: string, status: TaskRecord['status'] = 'To do'): TaskRecord => ({
    ...fixtureTasks[2],
    id,
    dueDate,
    status,
  })
  const withBroken = () =>
    new InMemoryTaskRepository([...fixtureTasks, broken('TASK-020', ''), broken('TASK-021', 'next week'), broken('TASK-022', '2026-02-30')])

  it('lists them last, in reference order, when nothing is filtered', async () => {
    const page = await withBroken().listAll(query())
    expect(ids(page.items)).toEqual(['TASK-001', 'TASK-002', 'TASK-004', 'TASK-003', 'TASK-005', 'TASK-020', 'TASK-021', 'TASK-022'])
  })

  it('never calls them overdue or due this week, whatever today is', async () => {
    const repoWithBroken = withBroken()
    for (const today of ['2026-02-10', '2099-01-01']) {
      const overdue = ids((await repoWithBroken.listAll(query({ due: 'overdue', today }))).items)
      const thisWeek = ids((await repoWithBroken.listAll(query({ due: 'this-week', today }))).items)
      for (const id of ['TASK-020', 'TASK-021', 'TASK-022']) {
        expect(overdue).not.toContain(id)
        expect(thisWeek).not.toContain(id)
      }
    }
  })

  it('still counts them as outstanding, but not overdue', async () => {
    expect(await withBroken().listAll(query({ today: '2099-01-01' }))).toMatchObject({ total: 8, outstanding: 7, overdue: 4 })
  })

  it('does not count a completed task with an invalid date as outstanding', async () => {
    const repoDone = new InMemoryTaskRepository([broken('TASK-030', '', 'Done')])
    expect(await repoDone.listAll(query())).toMatchObject({ total: 1, outstanding: 0, overdue: 0 })
  })
})
