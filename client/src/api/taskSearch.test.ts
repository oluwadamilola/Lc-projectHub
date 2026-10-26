import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from './http'
import { searchTasks } from './taskSearch'

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('searchTasks', () => {
  it('asks for every task when no parameters are given', async () => {
    const fetchMock = respondWith(200, { data: [], meta: {}, summary: {} })
    await searchTasks()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tasks')
  })

  it('sends only the parameters provided, encoded', async () => {
    const fetchMock = respondWith(200, { data: [], meta: {}, summary: {} })
    await searchTasks({
      q: 'rack & stack',
      project: 'PRJ-101',
      status: 'In progress',
      priority: 'High',
      assignee: 'TECH-002',
      due: 'this-week',
      today: '2026-02-10',
      page: 2,
      pageSize: 10,
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/tasks?q=rack+%26+stack&project=PRJ-101&status=In+progress&priority=High&assignee=TECH-002&due=this-week&today=2026-02-10&page=2&pageSize=10',
    )
    await searchTasks({ status: 'Done' })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/tasks?status=Done')
  })

  it('returns the data, paging and counts as the server sent them', async () => {
    const body = { data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 }, summary: { outstanding: 0, overdue: 0 } }
    respondWith(200, body)
    expect(await searchTasks()).toEqual(body)
  })

  it('raises the server\'s own message for a rejected request', async () => {
    respondWith(404, { error: { code: 'NOT_FOUND', message: 'Project PRJ-999 was not found.' } })
    await expect(searchTasks({ project: 'PRJ-999' })).rejects.toMatchObject({ message: 'Project PRJ-999 was not found.', status: 404 })
    await expect(searchTasks()).rejects.toBeInstanceOf(ApiRequestError)
  })
})
