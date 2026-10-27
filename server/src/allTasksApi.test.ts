import type { AllTasksResponse } from '@lc-projecthub/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRepository } from './domain/taskRepository.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { InMemoryTaskRepository } from './repositories/inMemoryTaskRepository.js'
import { fixtureProjects } from './testing/fixtures.js'
import { startTestServer, type RunningApp } from './testing/startTestServer.js'
import { fixtureTasks, fixtureTechnicians } from './testing/taskFixtures.js'

/*
  GET /api/tasks against the fixture data (see inMemoryTaskRepository.listAll.test.ts for the table of tasks).
  Every request that depends on the date passes `today`, so these tests never depend on the real clock.
*/

let running: RunningApp
beforeEach(async () => {
  running = await startTestServer(new InMemoryProjectRepository(fixtureProjects), {
    tasks: new InMemoryTaskRepository(fixtureTasks),
    technicians: fixtureTechnicians,
  })
})
afterEach(() => running.close())

const get = (path: string) => fetch(`${running.baseUrl}${path}`)
const list = async (path: string) => (await (await get(path)).json()) as AllTasksResponse
const ids = (body: AllTasksResponse) => body.data.map((task) => task.id)

async function expectValidation(response: Response, ...fields: string[]) {
  const body = await response.json()
  expect(response.status).toBe(400)
  expect(body.error.code).toBe('VALIDATION_ERROR')
  expect(body.error.details.map((d: { field: string }) => d.field)).toEqual(fields)
  for (const detail of body.error.details) expect(detail.message.length).toBeGreaterThan(5)
}

describe('GET /api/tasks', () => {
  it('lists tasks of every project in the standard shape, soonest deadline first', async () => {
    const response = await get('/api/tasks?today=2026-02-10')
    expect(response.status).toBe(200)
    const body = (await response.json()) as AllTasksResponse
    expect(ids(body)).toEqual(['TASK-001', 'TASK-002', 'TASK-004', 'TASK-003', 'TASK-005'])
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 5, totalPages: 1 })
    expect(body.summary).toEqual({ outstanding: 4, overdue: 1 })
  })

  it('includes the owning project and the technician name in each result', async () => {
    const body = await list('/api/tasks?today=2026-02-10')
    expect(body.data.find((task) => task.id === 'TASK-004')).toEqual({
      id: 'TASK-004',
      projectId: 'PRJ-002',
      projectName: 'Bravo Laptops',
      title: 'Image the laptops',
      description: 'Apply the standard build.',
      status: 'Blocked',
      priority: 'Critical',
      assigneeId: 'TECH-001',
      assigneeName: 'Test Technician One',
      startDate: '2026-01-20',
      dueDate: '2026-02-10',
    })
    expect(body.data.find((task) => task.id === 'TASK-003')).toMatchObject({
      projectId: 'PRJ-001',
      projectName: 'Alpha Network',
      assigneeId: null,
      assigneeName: null,
    })
  })

  it('filters by project, and reports an unknown project as 404', async () => {
    expect(ids(await list('/api/tasks?project=PRJ-002'))).toEqual(['TASK-004'])
    expect((await list('/api/tasks?project=PRJ-003')).meta.total).toBe(0) // exists, has no tasks
    const missing = await get('/api/tasks?project=PRJ-999')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Project PRJ-999 was not found.' } })
  })

  it('filters by status, priority and technician', async () => {
    expect(ids(await list('/api/tasks?status=To%20do'))).toEqual(['TASK-003', 'TASK-005'])
    expect(ids(await list('/api/tasks?priority=Critical'))).toEqual(['TASK-004'])
    expect(ids(await list('/api/tasks?assignee=TECH-002'))).toEqual(['TASK-002', 'TASK-005'])
    expect(ids(await list('/api/tasks?assignee=unassigned'))).toEqual(['TASK-003'])
    expect((await list('/api/tasks?assignee=TECH-099')).meta.total).toBe(0)
  })

  it('searches reference, title and description', async () => {
    expect(ids(await list('/api/tasks?q=SWITCHES'))).toEqual(['TASK-002', 'TASK-003'])
    expect(ids(await list('/api/tasks?q=task-005'))).toEqual(['TASK-005'])
    expect(ids(await list('/api/tasks?q=certify'))).toEqual(['TASK-005'])
    const none = await list('/api/tasks?q=nothing-like-this')
    expect(none.data).toEqual([])
    expect(none.meta).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
  })

  it('treats search text literally (no wildcard or injection effect)', async () => {
    expect((await list('/api/tasks?q=%25')).meta.total).toBe(0)
    expect((await list(`/api/tasks?q=${encodeURIComponent("' OR 1=1 --")}`)).meta.total).toBe(0)
    expect((await list('/api/tasks?q=.*')).meta.total).toBe(0)
  })

  it('supports the overdue filter, including the day-boundary', async () => {
    expect(ids(await list('/api/tasks?due=overdue&today=2026-02-10'))).toEqual(['TASK-002'])
    expect(ids(await list('/api/tasks?due=overdue&today=2026-02-11'))).toEqual(['TASK-002', 'TASK-004'])
    expect((await list('/api/tasks?due=overdue&today=2026-02-01')).meta.total).toBe(0)
    expect((await list('/api/tasks?due=overdue&today=2026-02-01')).summary.overdue).toBe(0)
  })

  it('supports the due-this-week filter', async () => {
    expect(ids(await list('/api/tasks?due=this-week&today=2026-02-12'))).toEqual(['TASK-004'])
    expect(ids(await list('/api/tasks?due=this-week&today=2026-02-16'))).toEqual(['TASK-003'])
  })

  it('combines filters', async () => {
    const body = await list('/api/tasks?project=PRJ-001&status=To%20do&priority=Low&assignee=TECH-002&due=overdue&today=2026-03-01')
    expect(ids(body)).toEqual(['TASK-005'])
  })

  it('defaults "today" to the server\'s day', async () => {
    const body = await list('/api/tasks?due=overdue')
    // The fixtures are all in early 2026, so every outstanding task is overdue by now.
    expect(ids(body)).toEqual(['TASK-002', 'TASK-004', 'TASK-003', 'TASK-005'])
  })

  it('pages the results', async () => {
    const first = await list('/api/tasks?pageSize=2&today=2026-02-10')
    expect(ids(first)).toEqual(['TASK-001', 'TASK-002'])
    expect(first.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 })
    const last = await list('/api/tasks?pageSize=2&page=3&today=2026-02-10')
    expect(ids(last)).toEqual(['TASK-005'])
    // The summary describes every match, not just the page.
    expect(last.summary).toEqual(first.summary)
    const beyond = await list('/api/tasks?pageSize=2&page=4')
    expect(beyond.data).toEqual([])
    expect(beyond.meta).toEqual({ page: 4, pageSize: 2, total: 5, totalPages: 3 })
  })

  it('does not return a completed task as overdue, but still lists it', async () => {
    const body = await list('/api/tasks?status=Done&today=2030-01-01')
    expect(ids(body)).toEqual(['TASK-001'])
    expect(body.summary).toEqual({ outstanding: 0, overdue: 0 })
    expect((await list('/api/tasks?due=overdue&status=Done&today=2030-01-01')).meta.total).toBe(0)
  })

  it('agrees with the per-project lists (same tasks, nothing extra)', async () => {
    const everything = await list('/api/tasks?pageSize=100')
    const perProject = []
    for (const project of fixtureProjects) {
      const response = await (await get(`/api/projects/${project.id}/tasks?pageSize=100`)).json()
      perProject.push(...response.data.map((task: { id: string }) => task.id))
    }
    expect(ids(everything).sort()).toEqual(perProject.sort())
  })

  it('shows a newly created task straight away', async () => {
    const created = await fetch(`${running.baseUrl}/api/projects/PRJ-002/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Brand new task',
        description: '',
        status: 'To do',
        priority: 'Low',
        assigneeId: null,
        startDate: '2026-02-01',
        dueDate: '2026-02-05',
      }),
    })
    expect(created.status).toBe(201)
    const body = await list('/api/tasks?q=brand%20new')
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ projectId: 'PRJ-002', projectName: 'Bravo Laptops' })
  })

  describe('validation', () => {
    it.each([
      ['status=Finished', 'status'],
      ['priority=Urgent', 'priority'],
      ['due=tomorrow', 'due'],
      ['assignee=Riley', 'assignee'],
      ['project=PRJ%20101', 'project'],
      ['today=2026-02-30', 'today'],
      ['today=yesterday', 'today'],
      ['page=0', 'page'],
      ['page=-2', 'page'],
      ['page=abc', 'page'],
      ['pageSize=0', 'pageSize'],
      ['pageSize=101', 'pageSize'],
      ['pageSize=1.5', 'pageSize'],
      ['statuss=Done', 'statuss'],
      ['status=Done&status=To%20do', 'status'],
    ])('rejects %s with 400', async (query, field) => {
      await expectValidation(await get(`/api/tasks?${query}`), field)
    })

    it('rejects search text longer than 100 characters', async () => {
      await expectValidation(await get(`/api/tasks?q=${'x'.repeat(101)}`), 'q')
    })

    it('lists every problem at once', async () => {
      await expectValidation(await get('/api/tasks?status=x&due=y&page=0'), 'status', 'due', 'page')
    })

    it('allows the largest page size', async () => {
      expect((await get('/api/tasks?pageSize=100')).status).toBe(200)
    })
  })

  it('is read-only', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await fetch(`${running.baseUrl}/api/tasks`, { method })
      expect(response.status).toBe(404)
    }
  })

  it('leaves the per-project task endpoints and the project endpoints working', async () => {
    expect((await get('/api/projects/PRJ-001/tasks')).status).toBe(200)
    expect((await get('/api/projects/PRJ-001/tasks/TASK-001')).status).toBe(200)
    expect((await get('/api/projects/PRJ-001')).status).toBe(200)
    expect((await get('/api/projects')).status).toBe(200)
    expect((await get('/api/technicians')).status).toBe(200)
  })
})

describe('GET /api/tasks when the repository fails', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('returns a generic 500 without leaking details', async () => {
    const failing: TaskRepository = {
      list: () => Promise.reject(new Error('secret-connection-string')),
      listAll: () => Promise.reject(new Error('secret-connection-string')),
      findById: () => Promise.resolve(null),
      create: () => Promise.reject(new Error('secret-connection-string')),
      update: () => Promise.reject(new Error('secret-connection-string')),
      delete: () => Promise.reject(new Error('secret-connection-string')),
      deleteByProject: () => Promise.reject(new Error('secret-connection-string')),
      restore: () => Promise.reject(new Error('secret-connection-string')),
    }
    const broken = await startTestServer(new InMemoryProjectRepository(fixtureProjects), { tasks: failing })
    try {
      const response = await fetch(`${broken.baseUrl}/api/tasks`)
      const text = await response.text()
      expect(response.status).toBe(500)
      expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR')
      expect(text).not.toContain('secret-connection-string')
    } finally {
      await broken.close()
    }
  })
})
