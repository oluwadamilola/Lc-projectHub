import type { AllTasksResponse, TaskListResponse, TaskResponse } from '@lc-projecthub/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRepository } from './domain/taskRepository.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { InMemoryTaskRepository } from './repositories/inMemoryTaskRepository.js'
import { fixtureProjects } from './testing/fixtures.js'
import { startTestServer, type RunningApp } from './testing/startTestServer.js'
import { fixtureTasks, fixtureTechnicians } from './testing/taskFixtures.js'

/*
  DELETE /api/projects/:projectId/tasks/:taskId
  Fixture tasks: PRJ-001 has TASK-001, 002, 003, 005; PRJ-002 has TASK-004; PRJ-003 has none.
*/

let running: RunningApp
beforeEach(async () => {
  running = await startTestServer(new InMemoryProjectRepository(fixtureProjects), {
    tasks: new InMemoryTaskRepository(fixtureTasks),
    technicians: fixtureTechnicians,
  })
})
afterEach(() => running.close())

const send = (method: string, path: string, body?: unknown) =>
  fetch(`${running.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const del = (projectId: string, taskId: string) => send('DELETE', `/api/projects/${projectId}/tasks/${taskId}`)
const get = (path: string) => send('GET', path)
const taskIds = async (projectId: string) =>
  ((await (await get(`/api/projects/${projectId}/tasks?pageSize=100`)).json()) as TaskListResponse).data.map((task) => task.id)

async function expectError(response: Response, status: number, code: string, message?: string, ...fields: string[]) {
  const body = await response.json()
  expect(response.status).toBe(status)
  expect(body.error.code).toBe(code)
  if (message) expect(body.error.message).toBe(message)
  if (fields.length > 0) expect(body.error.details.map((d: { field: string }) => d.field)).toEqual(fields)
}

describe('DELETE /api/projects/:projectId/tasks/:taskId', () => {
  it('deletes the task and answers with the deleted task in the standard shape', async () => {
    const response = await del('PRJ-001', 'TASK-002')
    expect(response.status).toBe(200)
    const body = (await response.json()) as TaskResponse
    expect(body.data).toMatchObject({
      id: 'TASK-002',
      projectId: 'PRJ-001',
      title: 'Order switches',
      assigneeId: 'TECH-002',
      assigneeName: 'Test Technician Two',
    })
  })

  it('removes the task everywhere it was visible', async () => {
    await del('PRJ-001', 'TASK-002')
    expect((await get('/api/projects/PRJ-001/tasks/TASK-002')).status).toBe(404)
    expect(await taskIds('PRJ-001')).toEqual(['TASK-001', 'TASK-003', 'TASK-005'])
    const all = (await (await get('/api/tasks?pageSize=100&today=2026-02-10')).json()) as AllTasksResponse
    expect(all.data.map((task) => task.id)).toEqual(['TASK-001', 'TASK-004', 'TASK-003', 'TASK-005'])
  })

  it('keeps the outstanding and overdue counts accurate', async () => {
    const before = (await (await get('/api/tasks?today=2026-03-01')).json()) as AllTasksResponse
    expect(before.summary).toEqual({ outstanding: 4, overdue: 4 })
    await del('PRJ-001', 'TASK-002') // outstanding and overdue
    await del('PRJ-001', 'TASK-001') // already Done: changes neither count
    const after = (await (await get('/api/tasks?today=2026-03-01')).json()) as AllTasksResponse
    expect(after.summary).toEqual({ outstanding: 3, overdue: 3 })
    expect(after.meta.total).toBe(3)
  })

  it('leaves every other task, and the project, as they were', async () => {
    await del('PRJ-001', 'TASK-003')
    expect(await taskIds('PRJ-001')).toEqual(['TASK-001', 'TASK-002', 'TASK-005'])
    expect(await taskIds('PRJ-002')).toEqual(['TASK-004'])
    expect((await get('/api/projects/PRJ-001')).status).toBe(200)
  })

  it('can delete the last task of a project, leaving an empty list', async () => {
    expect((await del('PRJ-002', 'TASK-004')).status).toBe(200)
    expect(await taskIds('PRJ-002')).toEqual([])
    expect((await get('/api/projects/PRJ-002')).status).toBe(200)
  })

  it('answers a repeated request with 404, and does not delete anything else', async () => {
    expect((await del('PRJ-001', 'TASK-001')).status).toBe(200)
    await expectError(await del('PRJ-001', 'TASK-001'), 404, 'NOT_FOUND', 'Task TASK-001 was not found in project PRJ-001.')
    expect(await taskIds('PRJ-001')).toEqual(['TASK-002', 'TASK-003', 'TASK-005'])
  })

  it('answers an unknown project with 404 (and the project is checked first)', async () => {
    await expectError(await del('PRJ-999', 'TASK-001'), 404, 'NOT_FOUND', 'Project PRJ-999 was not found.')
    await expectError(await del('PRJ-999', 'TASK-999'), 404, 'NOT_FOUND', 'Project PRJ-999 was not found.')
  })

  it('answers an unknown task with 404', async () => {
    await expectError(await del('PRJ-001', 'TASK-999'), 404, 'NOT_FOUND', 'Task TASK-999 was not found in project PRJ-001.')
  })

  it('refuses to delete another project\'s task: 404, and the task survives', async () => {
    await expectError(await del('PRJ-002', 'TASK-001'), 404, 'NOT_FOUND', 'Task TASK-001 was not found in project PRJ-002.')
    await expectError(await del('PRJ-003', 'TASK-004'), 404, 'NOT_FOUND', 'Task TASK-004 was not found in project PRJ-003.')
    expect((await get('/api/projects/PRJ-001/tasks/TASK-001')).status).toBe(200)
    expect((await get('/api/projects/PRJ-002/tasks/TASK-004')).status).toBe(200)
  })

  it.each([
    ['PRJ%20001', 'TASK-001', 'projectId'],
    ['PRJ-001', 'TASK%20001', 'taskId'],
    ['PRJ-001', 'T'.repeat(33), 'taskId'],
  ])('rejects a malformed reference (%s, %s) with 400', async (projectId, taskId, field) => {
    await expectError(await del(projectId, taskId), 400, 'VALIDATION_ERROR', undefined, field)
  })

  it('ignores any request body', async () => {
    const response = await send('DELETE', '/api/projects/PRJ-001/tasks/TASK-005', { status: 'Done' })
    expect(response.status).toBe(200)
    expect(await taskIds('PRJ-001')).not.toContain('TASK-005')
  })

  it('never reuses the reference of a deleted task', async () => {
    await del('PRJ-001', 'TASK-005') // the highest reference
    const created = await send('POST', '/api/projects/PRJ-001/tasks', {
      title: 'Replacement', description: '', status: 'To do', priority: 'Low', assigneeId: null, startDate: '2026-03-01', dueDate: '2026-03-02',
    })
    expect(((await created.json()) as TaskResponse).data.id).toBe('TASK-006')
  })

  it('two simultaneous requests delete once: one 200, one 404', async () => {
    const [a, b] = await Promise.all([del('PRJ-001', 'TASK-003'), del('PRJ-001', 'TASK-003')])
    expect([a.status, b.status].sort()).toEqual([200, 404])
    expect(await taskIds('PRJ-001')).toEqual(['TASK-001', 'TASK-002', 'TASK-005'])
  })

  it('the other task endpoints are unchanged', async () => {
    expect((await get('/api/projects/PRJ-001/tasks')).status).toBe(200)
    expect((await get('/api/projects/PRJ-001/tasks/TASK-001')).status).toBe(200)
    expect((await send('PATCH', '/api/projects/PRJ-001/tasks/TASK-001', {})).status).toBe(404)
    expect((await send('DELETE', '/api/projects/PRJ-001/tasks')).status).toBe(404) // no "delete all tasks" endpoint
  })
})

describe('DELETE task when the repository fails', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('answers 500 without leaking details, and a retry can succeed', async () => {
    const real = new InMemoryTaskRepository(fixtureTasks)
    let failures = 1
    const flaky: TaskRepository = {
      list: (c) => real.list(c),
      listAll: (c) => real.listAll(c),
      findById: (id) => real.findById(id),
      create: (p, i) => real.create(p, i),
      update: (id, i) => real.update(id, i),
      delete: (id) => (failures-- > 0 ? Promise.reject(new Error('secret-connection-string')) : real.delete(id)),
      deleteByProject: (p) => real.deleteByProject(p),
      restore: (t) => real.restore(t),
    }
    const broken = await startTestServer(new InMemoryProjectRepository(fixtureProjects), { tasks: flaky, technicians: fixtureTechnicians })
    try {
      const first = await fetch(`${broken.baseUrl}/api/projects/PRJ-001/tasks/TASK-003`, { method: 'DELETE' })
      const text = await first.text()
      expect(first.status).toBe(500)
      expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR')
      expect(text).not.toContain('secret-connection-string')
      expect((await real.findById('TASK-003'))?.id).toBe('TASK-003') // nothing was lost

      const retry = await fetch(`${broken.baseUrl}/api/projects/PRJ-001/tasks/TASK-003`, { method: 'DELETE' })
      expect(retry.status).toBe(200)
      expect(await real.findById('TASK-003')).toBeNull()
    } finally {
      await broken.close()
    }
  })
})
