import type { TaskInput, TaskListResponse } from '@lc-projecthub/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRepository } from './domain/projectRepository.js'
import type { TaskRepository } from './domain/taskRepository.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { InMemoryTaskRepository } from './repositories/inMemoryTaskRepository.js'
import { fixtureProjects } from './testing/fixtures.js'
import { startTestServer, type RunningApp } from './testing/startTestServer.js'
import { fixtureTasks, fixtureTechnicians } from './testing/taskFixtures.js'

const valid: TaskInput = {
  title: 'Label the cables',
  description: 'Both ends of every run.',
  status: 'To do',
  priority: 'Medium',
  assigneeId: 'TECH-002',
  startDate: '2026-03-01',
  dueDate: '2026-03-10',
}

let running: RunningApp
beforeEach(async () => {
  running = await startTestServer(new InMemoryProjectRepository(fixtureProjects), {
    tasks: new InMemoryTaskRepository(fixtureTasks),
    technicians: fixtureTechnicians,
  })
})
afterEach(() => running.close())

const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${running.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
const get = (path: string) => send('GET', path)
const post = (projectId: string, body?: unknown) => send('POST', `/api/projects/${projectId}/tasks`, body)
const put = (projectId: string, taskId: string, body?: unknown) =>
  send('PUT', `/api/projects/${projectId}/tasks/${taskId}`, body)
const list = async (path: string) => (await (await get(path)).json()) as TaskListResponse

async function expectValidation(response: Response, ...fields: string[]) {
  const body = await response.json()
  expect(response.status).toBe(400)
  expect(body.error.code).toBe('VALIDATION_ERROR')
  expect(body.error.details.map((d: { field: string }) => d.field)).toEqual(fields)
  for (const detail of body.error.details) expect(detail.message.length).toBeGreaterThan(5)
}
async function expectNotFound(response: Response, message: string) {
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message } })
}

describe('GET /api/technicians', () => {
  it('lists the technicians in the standard shape', async () => {
    const response = await get('/api/technicians')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: fixtureTechnicians })
  })
})

describe('GET /api/projects/:id/tasks', () => {
  it('lists a project’s tasks with data and paging meta, soonest due first', async () => {
    const body = await list('/api/projects/PRJ-001/tasks')
    expect(body.data.map((t) => t.id)).toEqual(['TASK-001', 'TASK-002', 'TASK-003', 'TASK-005'])
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 4, totalPages: 1 })
  })

  it('includes the technician name, or null when unassigned', async () => {
    const { data } = await list('/api/projects/PRJ-001/tasks')
    expect(data[0]).toMatchObject({ assigneeId: 'TECH-001', assigneeName: 'Test Technician One' })
    expect(data[2]).toMatchObject({ assigneeId: null, assigneeName: null })
  })

  it('never includes another project’s tasks', async () => {
    expect((await list('/api/projects/PRJ-002/tasks')).data.map((t) => t.id)).toEqual(['TASK-004'])
  })

  it('returns 200 with an empty list for a project without tasks', async () => {
    const body = await list('/api/projects/PRJ-003/tasks')
    expect(body.data).toEqual([])
    expect(body.meta).toMatchObject({ total: 0, totalPages: 0 })
  })

  it('searches, filters by status and assignee, and pages', async () => {
    expect((await list('/api/projects/PRJ-001/tasks?q=SWITCH')).data.map((t) => t.id)).toEqual(['TASK-002', 'TASK-003'])
    expect((await list('/api/projects/PRJ-001/tasks?status=To%20do')).data.map((t) => t.id)).toEqual(['TASK-003', 'TASK-005'])
    expect((await list('/api/projects/PRJ-001/tasks?assignee=TECH-002')).data.map((t) => t.id)).toEqual(['TASK-002', 'TASK-005'])
    expect((await list('/api/projects/PRJ-001/tasks?assignee=unassigned')).data.map((t) => t.id)).toEqual(['TASK-003'])
    const page = await list('/api/projects/PRJ-001/tasks?pageSize=3&page=2')
    expect(page.data.map((t) => t.id)).toEqual(['TASK-005'])
    expect(page.meta).toEqual({ page: 2, pageSize: 3, total: 4, totalPages: 2 })
  })

  it('returns 404 for a missing project', async () => {
    await expectNotFound(await get('/api/projects/PRJ-999/tasks'), 'Project PRJ-999 was not found.')
  })

  it('returns 400 with field details for invalid parameters', async () => {
    await expectValidation(await get('/api/projects/PRJ-001/tasks?status=Finished&assignee=bob&page=0'), 'status', 'assignee', 'page')
    await expectValidation(await get('/api/projects/PRJ-001/tasks?statuss=Done'), 'statuss')
  })

  it('returns 400 for a malformed project reference', async () => {
    await expectValidation(await get('/api/projects/bad%20id/tasks'), 'projectId')
  })
})

describe('GET /api/projects/:id/tasks/:taskId', () => {
  it('returns one task with the technician name', async () => {
    const response = await get('/api/projects/PRJ-001/tasks/TASK-002')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { ...fixtureTasks[1], assigneeName: 'Test Technician Two' },
    })
  })

  it('returns 404 for a missing task', async () => {
    await expectNotFound(await get('/api/projects/PRJ-001/tasks/TASK-999'), 'Task TASK-999 was not found in project PRJ-001.')
  })

  it('returns 404 for a task that belongs to a different project', async () => {
    await expectNotFound(await get('/api/projects/PRJ-001/tasks/TASK-004'), 'Task TASK-004 was not found in project PRJ-001.')
  })

  it('returns 404 for a missing project and 400 for malformed references', async () => {
    await expectNotFound(await get('/api/projects/PRJ-999/tasks/TASK-001'), 'Project PRJ-999 was not found.')
    await expectValidation(await get('/api/projects/PRJ-001/tasks/bad%20id'), 'taskId')
  })
})

describe('POST /api/projects/:id/tasks', () => {
  it('creates a task: 201, Location header, server-assigned reference and technician name', async () => {
    const response = await post('PRJ-002', valid)
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body).toEqual({
      data: { ...valid, id: 'TASK-006', projectId: 'PRJ-002', assigneeName: 'Test Technician Two' },
    })
    expect(response.headers.get('location')).toBe('/api/projects/PRJ-002/tasks/TASK-006')
  })

  it('stores the task so it can be read and listed under its project only', async () => {
    const { data } = await (await post('PRJ-003', valid)).json()
    expect((await (await get(`/api/projects/PRJ-003/tasks/${data.id}`)).json()).data).toEqual(data)
    expect((await list('/api/projects/PRJ-003/tasks')).data).toEqual([data])
    expect((await list('/api/projects/PRJ-001/tasks')).meta.total).toBe(4)
  })

  it('accepts an unassigned task, with or without assigneeId, and an empty description', async () => {
    const a = await (await post('PRJ-003', { ...valid, assigneeId: null, description: '' })).json()
    expect(a.data).toMatchObject({ assigneeId: null, assigneeName: null, description: '' })
    const { assigneeId: _omit, ...without } = valid
    void _omit
    expect((await (await post('PRJ-003', without)).json()).data.assigneeId).toBeNull()
  })

  it('trims text', async () => {
    const { data } = await (await post('PRJ-003', { ...valid, title: '  Padded  ' })).json()
    expect(data.title).toBe('Padded')
  })

  it('gives unique references to simultaneous creations', async () => {
    const responses = await Promise.all(Array.from({ length: 15 }, () => post('PRJ-001', valid)))
    const ids = (await Promise.all(responses.map((r) => r.json()))).map((b) => b.data.id)
    expect(responses.every((r) => r.status === 201)).toBe(true)
    expect(new Set([...ids, ...fixtureTasks.map((t) => t.id)]).size).toBe(20)
  })

  it('returns 404 for a missing project and creates nothing', async () => {
    await expectNotFound(await post('PRJ-999', valid), 'Project PRJ-999 was not found.')
    expect((await list('/api/projects/PRJ-001/tasks')).meta.total).toBe(4)
  })

  it('returns 404 for a missing project even when the body is invalid', async () => {
    expect((await post('PRJ-999', {})).status).toBe(404)
  })

  it('returns 400 for a malformed project reference', async () => {
    await expectValidation(await post('bad%20id', valid), 'projectId')
  })

  it.each(['title', 'status', 'priority', 'startDate', 'dueDate'])('rejects a missing %s', async (field) => {
    const { [field]: _omit, ...rest } = valid as unknown as Record<string, unknown>
    void _omit
    await expectValidation(await post('PRJ-001', rest), field)
  })

  it('rejects blank or over-long titles and wrong types', async () => {
    await expectValidation(await post('PRJ-001', { ...valid, title: '   ' }), 'title')
    await expectValidation(await post('PRJ-001', { ...valid, title: 'x'.repeat(121) }), 'title')
    await expectValidation(await post('PRJ-001', { ...valid, description: 5 }), 'description')
  })

  it('rejects unsupported enum values, including project statuses', async () => {
    await expectValidation(await post('PRJ-001', { ...valid, status: 'Finished' }), 'status')
    await expectValidation(await post('PRJ-001', { ...valid, status: 'On track' }), 'status')
    await expectValidation(await post('PRJ-001', { ...valid, priority: 'Urgent' }), 'priority')
  })

  it('rejects bad dates and a due date before the start date', async () => {
    await expectValidation(await post('PRJ-001', { ...valid, startDate: '2026-02-30' }), 'startDate')
    await expectValidation(await post('PRJ-001', { ...valid, startDate: '2026-03-10', dueDate: '2026-03-01' }), 'dueDate')
  })

  it('rejects an unknown technician and a malformed technician reference', async () => {
    const unknown = await post('PRJ-001', { ...valid, assigneeId: 'TECH-099' })
    await expectValidation(unknown, 'assigneeId')
    await expectValidation(await post('PRJ-001', { ...valid, assigneeId: 'bob' }), 'assigneeId')
    await expectValidation(await post('PRJ-001', { ...valid, assigneeId: '' }), 'assigneeId')
  })

  it('rejects attempts to set the reference, project or technician name through the body', async () => {
    await expectValidation(await post('PRJ-001', { ...valid, id: 'TASK-001' }), 'id')
    await expectValidation(await post('PRJ-001', { ...valid, projectId: 'PRJ-002' }), 'projectId')
    await expectValidation(await post('PRJ-001', { ...valid, assigneeName: 'Someone' }), 'assigneeName')
  })

  it('reports every problem at once', async () => {
    await expectValidation(await post('PRJ-001', { ...valid, title: '', priority: 'x', dueDate: '' }), 'title', 'priority', 'dueDate')
  })

  it('rejects bodies that are not a JSON object, and malformed JSON', async () => {
    await expectValidation(await post('PRJ-001', [valid]), 'body')
    expect((await post('PRJ-001', '{"title": ')).status).toBe(400)
    expect((await post('PRJ-001', 'null')).status).toBe(400)
  })

  it('stores nothing when validation fails and does not consume a reference', async () => {
    await post('PRJ-001', { ...valid, title: '' })
    await post('PRJ-001', { ...valid, assigneeId: 'TECH-099' })
    expect((await (await post('PRJ-001', valid)).json()).data.id).toBe('TASK-006')
  })
})

describe('PUT /api/projects/:id/tasks/:taskId', () => {
  const changed: TaskInput = { ...valid, title: 'Install switches (phase 2)', status: 'In progress', assigneeId: 'TECH-001' }

  it('updates the task and returns it with the same reference and project', async () => {
    const response = await put('PRJ-001', 'TASK-003', changed)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { ...changed, id: 'TASK-003', projectId: 'PRJ-001', assigneeName: 'Test Technician One' },
    })
  })

  it('persists the change, leaves other tasks alone and can unassign', async () => {
    await put('PRJ-001', 'TASK-002', { ...changed, assigneeId: null })
    const body = await list('/api/projects/PRJ-001/tasks')
    expect(body.data.find((t) => t.id === 'TASK-002')).toMatchObject({ title: changed.title, assigneeId: null, assigneeName: null })
    expect(body.data.find((t) => t.id === 'TASK-001')).toMatchObject({ title: 'Survey the site' })
    expect(body.meta.total).toBe(4)
  })

  it('returns 404 for a missing task, a task in another project, and a missing project', async () => {
    await expectNotFound(await put('PRJ-001', 'TASK-999', changed), 'Task TASK-999 was not found in project PRJ-001.')
    await expectNotFound(await put('PRJ-001', 'TASK-004', changed), 'Task TASK-004 was not found in project PRJ-001.')
    await expectNotFound(await put('PRJ-999', 'TASK-001', changed), 'Project PRJ-999 was not found.')
    // A task cannot be edited through the wrong project, and so cannot be moved by accident.
    expect((await (await get('/api/projects/PRJ-002/tasks/TASK-004')).json()).data.title).toBe('Image the laptops')
  })

  it('returns 404 before validating the body', async () => {
    expect((await put('PRJ-001', 'TASK-999', {})).status).toBe(404)
  })

  it('returns 400 for malformed references', async () => {
    await expectValidation(await put('bad%20id', 'TASK-001', changed), 'projectId')
    await expectValidation(await put('PRJ-001', 'bad%20id', changed), 'taskId')
  })

  it('validates the body and leaves the stored task unchanged on failure', async () => {
    await expectValidation(await put('PRJ-001', 'TASK-002', { ...changed, startDate: '2026-04-01', dueDate: '2026-03-01' }), 'dueDate')
    await expectValidation(await put('PRJ-001', 'TASK-002', { ...changed, assigneeId: 'TECH-099' }), 'assigneeId')
    expect((await (await get('/api/projects/PRJ-001/tasks/TASK-002')).json()).data).toMatchObject({
      title: 'Order switches',
      assigneeId: 'TECH-002',
    })
  })

  it('refuses to change the reference or move the task to another project', async () => {
    await expectValidation(await put('PRJ-001', 'TASK-002', { ...changed, id: 'TASK-001' }), 'id')
    await expectValidation(await put('PRJ-001', 'TASK-002', { ...changed, projectId: 'PRJ-002' }), 'projectId')
    expect((await list('/api/projects/PRJ-002/tasks')).meta.total).toBe(1)
  })

  it('requires the whole task (PUT replaces) and allows saving without changes', async () => {
    await expectValidation(await put('PRJ-001', 'TASK-002', { title: 'Only a title' }), 'status', 'priority', 'startDate', 'dueDate')
    const { id: _id, projectId: _p, assigneeName: _n, ...unchanged } = { ...fixtureTasks[1], assigneeName: 'x' }
    void _id
    void _p
    void _n
    expect((await put('PRJ-001', 'TASK-002', unchanged)).status).toBe(200)
  })
})

describe('what is not supported', () => {
  it('has no delete or partial-update endpoint for tasks', async () => {
    for (const method of ['DELETE', 'PATCH']) {
      expect((await send(method, '/api/projects/PRJ-001/tasks/TASK-001')).status).toBe(404)
    }
    expect((await get('/api/projects/PRJ-001/tasks/TASK-001')).status).toBe(200)
  })

  it('does not allow writing technicians', async () => {
    expect((await send('POST', '/api/technicians', { name: 'x' })).status).toBe(404)
  })

  it('leaves the project endpoints working', async () => {
    expect((await get('/api/projects/PRJ-001')).status).toBe(200)
    expect((await get('/api/projects?pageSize=2')).status).toBe(200)
    expect((await get('/api/health')).status).toBe(200)
  })
})

describe('when a repository fails', () => {
  const projects: ProjectRepository = new InMemoryProjectRepository(fixtureProjects)
  const failing: TaskRepository = {
    list: () => Promise.reject(new Error('secret-connection-string')),
    findById: (id) => Promise.resolve(id === 'TASK-001' ? fixtureTasks[0] : null),
    create: () => Promise.reject(new Error('secret-connection-string')),
    update: () => Promise.reject(new Error('secret-connection-string')),
  }
  let broken: RunningApp
  beforeEach(async () => {
    broken = await startTestServer(projects, { tasks: failing, technicians: fixtureTechnicians })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(async () => {
    await broken.close()
    vi.restoreAllMocks()
  })

  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${broken.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('returns 500 with a generic message for list, create and update, without leaking details', async () => {
    for (const response of [
      await call('GET', '/api/projects/PRJ-001/tasks'),
      await call('POST', '/api/projects/PRJ-001/tasks', valid),
      await call('PUT', '/api/projects/PRJ-001/tasks/TASK-001', valid),
    ]) {
      const text = await response.text()
      expect(response.status).toBe(500)
      expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR')
      expect(text).not.toContain('secret-connection-string')
    }
  })

  it('still reports validation problems as 400, not 500', async () => {
    expect((await call('POST', '/api/projects/PRJ-001/tasks', { ...valid, title: '' })).status).toBe(400)
  })
})
