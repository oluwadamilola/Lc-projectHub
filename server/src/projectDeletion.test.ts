import type { AllTasksResponse, ProjectDeleteResponse, ProjectListResponse } from '@lc-projecthub/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRepository } from './domain/projectRepository.js'
import { NotFoundError } from './errors.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { InMemoryTaskRepository } from './repositories/inMemoryTaskRepository.js'
import { InMemoryTechnicianRepository } from './repositories/inMemoryTechnicianRepository.js'
import { ProjectService } from './services/projectService.js'
import { TaskService } from './services/taskService.js'
import { fixtureProjects } from './testing/fixtures.js'
import { startTestServer, type RunningApp } from './testing/startTestServer.js'
import { fixtureTasks, fixtureTechnicians } from './testing/taskFixtures.js'

/*
  DELETE /api/projects/:id
  Fixture projects: PRJ-001, 002, 003, 010, 011. Tasks: PRJ-001 has TASK-001, 002, 003, 005; PRJ-002 has TASK-004; the rest have none.
*/

const send = (base: string, method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

/** Every task the API can list must belong to a project that still exists. */
async function expectNoOrphans(base: string) {
  const projects = (await (await send(base, 'GET', '/api/projects?pageSize=100')).json()) as ProjectListResponse
  const known = new Set(projects.data.map((project) => project.id))
  const tasks = (await (await send(base, 'GET', '/api/tasks?pageSize=100')).json()) as AllTasksResponse
  const orphans = tasks.data.filter((task) => !known.has(task.projectId)).map((task) => task.id)
  expect(orphans).toEqual([])
}

async function expectError(response: Response, status: number, code: string, message?: string, ...fields: string[]) {
  const body = await response.json()
  expect(response.status).toBe(status)
  expect(body.error.code).toBe(code)
  if (message) expect(body.error.message).toBe(message)
  if (fields.length > 0) expect(body.error.details.map((d: { field: string }) => d.field)).toEqual(fields)
}

describe('DELETE /api/projects/:id', () => {
  let running: RunningApp
  const call = (method: string, path: string, body?: unknown) => send(running.baseUrl, method, path, body)
  const projectIds = async () => ((await (await call('GET', '/api/projects?pageSize=100')).json()) as ProjectListResponse).data.map((p) => p.id)
  const allTaskIds = async () => ((await (await call('GET', '/api/tasks?pageSize=100')).json()) as AllTasksResponse).data.map((t) => t.id)

  beforeEach(async () => {
    running = await startTestServer(new InMemoryProjectRepository(fixtureProjects), {
      tasks: new InMemoryTaskRepository(fixtureTasks),
      technicians: fixtureTechnicians,
    })
  })
  afterEach(() => running.close())

  it('deletes the project and answers with it and how many tasks went too', async () => {
    const response = await call('DELETE', '/api/projects/PRJ-001')
    expect(response.status).toBe(200)
    const body = (await response.json()) as ProjectDeleteResponse
    expect(body.data).toMatchObject({ id: 'PRJ-001', name: 'Alpha Network' })
    expect(body.meta).toEqual({ deletedTasks: 4 })
  })

  it('removes the project from every view', async () => {
    await call('DELETE', '/api/projects/PRJ-001')
    expect((await call('GET', '/api/projects/PRJ-001')).status).toBe(404)
    expect(await projectIds()).toEqual(['PRJ-002', 'PRJ-003', 'PRJ-010', 'PRJ-011'])
    const list = (await (await call('GET', '/api/projects?pageSize=100')).json()) as ProjectListResponse
    expect(list.meta.total).toBe(4)
  })

  it('deletes all of the project\'s tasks and leaves no orphans', async () => {
    await call('DELETE', '/api/projects/PRJ-001')
    expect(await allTaskIds()).toEqual(['TASK-004'])
    for (const id of ['TASK-001', 'TASK-002', 'TASK-003', 'TASK-005']) {
      expect((await call('GET', `/api/projects/PRJ-001/tasks/${id}`)).status).toBe(404)
    }
    expect((await call('GET', '/api/projects/PRJ-001/tasks')).status).toBe(404)
    await expectNoOrphans(running.baseUrl)
  })

  it('leaves other projects and their tasks untouched', async () => {
    await call('DELETE', '/api/projects/PRJ-001')
    expect((await call('GET', '/api/projects/PRJ-002')).status).toBe(200)
    const tasks = (await (await call('GET', '/api/projects/PRJ-002/tasks')).json()) as { data: { id: string }[] }
    expect(tasks.data.map((task) => task.id)).toEqual(['TASK-004'])
  })

  it('keeps the cross-project counts accurate', async () => {
    const before = (await (await call('GET', '/api/tasks?today=2026-03-01')).json()) as AllTasksResponse
    expect(before.summary).toEqual({ outstanding: 4, overdue: 4 })
    await call('DELETE', '/api/projects/PRJ-001')
    const after = (await (await call('GET', '/api/tasks?today=2026-03-01')).json()) as AllTasksResponse
    expect(after.meta.total).toBe(1)
    expect(after.summary).toEqual({ outstanding: 1, overdue: 1 })
  })

  it('deletes a project that has no tasks and reports 0', async () => {
    const response = await call('DELETE', '/api/projects/PRJ-003')
    expect(response.status).toBe(200)
    expect(((await response.json()) as ProjectDeleteResponse).meta.deletedTasks).toBe(0)
    expect(await allTaskIds()).toHaveLength(5)
  })

  it('answers an unknown project with 404 and deletes nothing', async () => {
    await expectError(await call('DELETE', '/api/projects/PRJ-999'), 404, 'NOT_FOUND', 'Project PRJ-999 was not found.')
    expect(await projectIds()).toHaveLength(5)
    expect(await allTaskIds()).toHaveLength(5)
  })

  it('answers a repeated request with 404 and does not touch anything else', async () => {
    expect((await call('DELETE', '/api/projects/PRJ-001')).status).toBe(200)
    await expectError(await call('DELETE', '/api/projects/PRJ-001'), 404, 'NOT_FOUND', 'Project PRJ-001 was not found.')
    expect(await projectIds()).toEqual(['PRJ-002', 'PRJ-003', 'PRJ-010', 'PRJ-011'])
    expect(await allTaskIds()).toEqual(['TASK-004'])
  })

  it.each(['PRJ%20001', 'x'.repeat(33), 'PRJ-001%2Fx'])('rejects the malformed reference %s with 400', async (id) => {
    await expectError(await call('DELETE', `/api/projects/${id}`), 400, 'VALIDATION_ERROR', undefined, 'id')
  })

  it('cannot create a task in, or edit a task of, a deleted project', async () => {
    await call('DELETE', '/api/projects/PRJ-001')
    const input = { title: 'Late', description: '', status: 'To do', priority: 'Low', assigneeId: null, startDate: '2026-03-01', dueDate: '2026-03-02' }
    await expectError(await call('POST', '/api/projects/PRJ-001/tasks', input), 404, 'NOT_FOUND', 'Project PRJ-001 was not found.')
    await expectError(await call('PUT', '/api/projects/PRJ-001/tasks/TASK-001', input), 404, 'NOT_FOUND')
    await expectNoOrphans(running.baseUrl)
  })

  it('never reuses the reference of a deleted project or its tasks', async () => {
    await call('DELETE', '/api/projects/PRJ-011') // the highest project reference
    await call('DELETE', '/api/projects/PRJ-001') // takes TASK-005, the highest task reference, with it
    const project = (await (await call('POST', '/api/projects', { ...fixtureProjects[0], id: undefined })).json()) as { data: { id: string } }
    expect(project.data.id).toBe('PRJ-012')
    const task = (await (await call('POST', '/api/projects/PRJ-002/tasks', {
      title: 'New', description: '', status: 'To do', priority: 'Low', assigneeId: null, startDate: '2026-03-01', dueDate: '2026-03-02',
    })).json()) as { data: { id: string } }
    expect(task.data.id).toBe('TASK-006')
  })

  it('two simultaneous requests delete once: one 200, one 404, and still no orphans', async () => {
    const [a, b] = await Promise.all([call('DELETE', '/api/projects/PRJ-001'), call('DELETE', '/api/projects/PRJ-001')])
    expect([a.status, b.status].sort()).toEqual([200, 404])
    expect(await allTaskIds()).toEqual(['TASK-004'])
    await expectNoOrphans(running.baseUrl)
  })

  it('does not change the project endpoints it sits beside', async () => {
    expect((await call('GET', '/api/projects/PRJ-001')).status).toBe(200)
    expect((await call('PUT', '/api/projects/PRJ-001', { ...fixtureProjects[0], id: undefined })).status).toBe(200)
    expect((await call('DELETE', '/api/projects')).status).toBe(404) // no "delete every project" endpoint
  })
})

describe('project deletion when something goes wrong part-way', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  /** A project repository that behaves normally except for what the test injects into delete(). */
  function wrapProjects(real: InMemoryProjectRepository, onDelete: (id: string) => Promise<void>): ProjectRepository {
    return {
      list: (c) => real.list(c),
      findById: (id) => real.findById(id),
      create: (i) => real.create(i),
      update: (id, i) => real.update(id, i),
      delete: async (id) => {
        await onDelete(id)
        return real.delete(id)
      },
    }
  }

  it('puts the tasks back when removing the project fails, then succeeds on retry', async () => {
    const real = new InMemoryProjectRepository(fixtureProjects)
    let failures = 1
    const projects = wrapProjects(real, async () => {
      if (failures-- > 0) throw new Error('secret-connection-string')
    })
    const tasks = new InMemoryTaskRepository(fixtureTasks)
    const running = await startTestServer(projects, { tasks, technicians: fixtureTechnicians })
    try {
      const failed = await send(running.baseUrl, 'DELETE', '/api/projects/PRJ-001')
      const text = await failed.text()
      expect(failed.status).toBe(500)
      expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR')
      expect(text).not.toContain('secret-connection-string')

      // Nothing was lost: the project and all four of its tasks are still there.
      expect((await real.findById('PRJ-001'))?.name).toBe('Alpha Network')
      const restored = await tasks.listAll({ projectId: 'PRJ-001', page: 1, pageSize: 50, today: '2026-02-10' })
      expect(restored.items.map((t) => t.id)).toEqual(['TASK-001', 'TASK-002', 'TASK-003', 'TASK-005'])
      await expectNoOrphans(running.baseUrl)

      const retry = await send(running.baseUrl, 'DELETE', '/api/projects/PRJ-001')
      expect(retry.status).toBe(200)
      expect(((await retry.json()) as ProjectDeleteResponse).meta.deletedTasks).toBe(4)
      expect(await real.findById('PRJ-001')).toBeNull()
      expect((await tasks.listAll({ page: 1, pageSize: 50, today: '2026-02-10' })).items.map((t) => t.id)).toEqual(['TASK-004'])
      await expectNoOrphans(running.baseUrl)
    } finally {
      await running.close()
    }
  })

  it('sweeps up a task that is added while the project is being deleted', async () => {
    const real = new InMemoryProjectRepository(fixtureProjects)
    const tasks = new InMemoryTaskRepository(fixtureTasks)
    const projects = wrapProjects(real, async (id) => {
      // A create that slipped in after the first clean-up and before the project went away.
      await tasks.create(id, { title: 'Sneaked in', description: '', status: 'To do', priority: 'Low', assigneeId: null, startDate: '2026-03-01', dueDate: '2026-03-02' })
    })
    const running = await startTestServer(projects, { tasks, technicians: fixtureTechnicians })
    try {
      const response = await send(running.baseUrl, 'DELETE', '/api/projects/PRJ-001')
      expect(response.status).toBe(200)
      expect(((await response.json()) as ProjectDeleteResponse).meta.deletedTasks).toBe(5)
      expect((await tasks.listAll({ projectId: 'PRJ-001', page: 1, pageSize: 50, today: '2026-02-10' })).total).toBe(0)
      await expectNoOrphans(running.baseUrl)
    } finally {
      await running.close()
    }
  })

  it('does not put anything back when another request already deleted the project', async () => {
    const real = new InMemoryProjectRepository(fixtureProjects)
    const tasks = new InMemoryTaskRepository(fixtureTasks)
    const projects = wrapProjects(real, async (id) => {
      await real.delete(id) // the "other request" wins just before this one removes the project
    })
    const service = new ProjectService(projects, tasks)
    await expect(service.delete('PRJ-001')).rejects.toBeInstanceOf(NotFoundError)
    expect((await tasks.listAll({ projectId: 'PRJ-001', page: 1, pageSize: 50, today: '2026-02-10' })).total).toBe(0) // not resurrected
  })

  it('refuses a task created while its project is being deleted (no orphan)', async () => {
    const projects = new InMemoryProjectRepository(fixtureProjects)
    const tasks = new InMemoryTaskRepository(fixtureTasks)
    const projectService = new ProjectService(projects, tasks)
    // The technician lookup happens while the body is being checked; the project disappears right then.
    const technicians = new InMemoryTechnicianRepository(fixtureTechnicians)
    const racing = {
      list: () => technicians.list(),
      findById: async (id: string) => {
        await projectService.delete('PRJ-003')
        return technicians.findById(id)
      },
    }
    const taskService = new TaskService(tasks, racing, projects)
    await expect(
      taskService.create('PRJ-003', { title: 'Too late', description: '', status: 'To do', priority: 'Low', assigneeId: 'TECH-001', startDate: '2026-03-01', dueDate: '2026-03-02' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect((await tasks.listAll({ projectId: 'PRJ-003', page: 1, pageSize: 50, today: '2026-02-10' })).total).toBe(0)
  })
})
