import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from './http'
import { createTask, getTask, getTasks, getTechnicians, updateTask } from './tasks'
import { taskA, technicians } from '../test/fixtures'

const { id: _id, projectId: _projectId, assigneeName: _name, ...inputA } = taskA
void _id
void _projectId
void _name

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('tasks API client', () => {
  it('lists a project’s tasks, sending only the parameters provided', async () => {
    const fetchMock = respondWith(200, { data: [], meta: {} })
    await getTasks('PRJ-001', { q: 'cable', status: 'In progress', assignee: 'TECH-002', page: 2, pageSize: 10 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/PRJ-001/tasks?q=cable&status=In+progress&assignee=TECH-002&page=2&pageSize=10')
    await getTasks('PRJ-001')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/projects/PRJ-001/tasks')
  })

  it('encodes the project reference in the address', async () => {
    const fetchMock = respondWith(200, { data: [], meta: {} })
    await getTasks('a/b c')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/a%2Fb%20c/tasks')
  })

  it('unwraps a single task', async () => {
    const fetchMock = respondWith(200, { data: taskA })
    expect(await getTask('PRJ-001', 'TASK-001')).toEqual(taskA)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/PRJ-001/tasks/TASK-001')
  })

  it('POSTs a new task as JSON to its project', async () => {
    const created = { ...taskA, id: 'TASK-050' }
    const fetchMock = respondWith(201, { data: created })
    expect(await createTask('PRJ-001', inputA)).toEqual(created)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/projects/PRJ-001/tasks')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual(inputA)
  })

  it('PUTs an edited task to its own address', async () => {
    const fetchMock = respondWith(200, { data: taskA })
    expect(await updateTask('PRJ-001', 'TASK-001', inputA)).toEqual(taskA)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/projects/PRJ-001/tasks/TASK-001')
    expect(init.method).toBe('PUT')
  })

  it('lists technicians', async () => {
    const fetchMock = respondWith(200, { data: technicians })
    expect(await getTechnicians()).toEqual(technicians)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/technicians')
  })

  it('carries field-level validation details from a 400 response', async () => {
    const details = [{ field: 'assigneeId', message: 'That technician was not found. Choose one from the list.' }]
    respondWith(400, { error: { code: 'VALIDATION_ERROR', message: 'The request contains invalid values.', details } })
    const error = await createTask('PRJ-001', inputA).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details })
  })

  it('reports a missing project or task as 404', async () => {
    respondWith(404, { error: { code: 'NOT_FOUND', message: 'Project PRJ-9 was not found.' } })
    await expect(getTasks('PRJ-9')).rejects.toMatchObject({ status: 404, message: 'Project PRJ-9 was not found.' })
    await expect(updateTask('PRJ-9', 'TASK-1', inputA)).rejects.toMatchObject({ status: 404 })
  })

  it('reports an unreachable server as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(getTasks('PRJ-001')).rejects.toMatchObject({ status: 0 })
    await expect(createTask('PRJ-001', inputA)).rejects.toMatchObject({ status: 0 })
  })
})
