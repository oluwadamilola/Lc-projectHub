import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from './http'
import { deleteProject } from './projects'
import { deleteTask } from './tasks'
import { projectA, taskA } from '../test/fixtures'

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('deleteTask', () => {
  it('sends DELETE to the task\'s address, with no body, and returns the deleted task', async () => {
    const fetchMock = respondWith(200, { data: taskA })
    expect(await deleteTask('PRJ-001', 'TASK-001')).toEqual(taskA)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/projects/PRJ-001/tasks/TASK-001')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('encodes both references in the address', async () => {
    const fetchMock = respondWith(200, { data: taskA })
    await deleteTask('a/b c', 'd?e')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/a%2Fb%20c/tasks/d%3Fe')
  })

  it('raises the server\'s own message and status for a 404', async () => {
    respondWith(404, { error: { code: 'NOT_FOUND', message: 'Task TASK-001 was not found in project PRJ-001.' } })
    await expect(deleteTask('PRJ-001', 'TASK-001')).rejects.toMatchObject({
      message: 'Task TASK-001 was not found in project PRJ-001.',
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('raises a plain-language error when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const failure = await deleteTask('PRJ-001', 'TASK-001').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiRequestError)
    expect(failure).toMatchObject({ status: 0 })
  })

  it('does not treat a server error as success', async () => {
    respondWith(500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } })
    await expect(deleteTask('PRJ-001', 'TASK-001')).rejects.toMatchObject({ status: 500 })
  })
})

describe('deleteProject', () => {
  it('sends DELETE to the project\'s address and returns the project and the task count', async () => {
    const body = { data: projectA, meta: { deletedTasks: 4 } }
    const fetchMock = respondWith(200, body)
    expect(await deleteProject('PRJ-001')).toEqual(body)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/projects/PRJ-001')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  it('encodes the reference and raises server errors', async () => {
    const fetchMock = respondWith(404, { error: { code: 'NOT_FOUND', message: 'Project a/b was not found.' } })
    await expect(deleteProject('a/b')).rejects.toMatchObject({ status: 404, message: 'Project a/b was not found.' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/a%2Fb')
  })
})
