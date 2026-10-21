import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from './http'
import { getProject, getProjects } from './projects'
import { projectA } from '../test/fixtures'

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('projects API client', () => {
  it('sends only the parameters that were provided', async () => {
    const fetchMock = respondWith(200, { data: [], meta: {} })
    await getProjects({ q: 'wifi', status: 'At risk', page: 2, pageSize: 10 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects?q=wifi&status=At+risk&page=2&pageSize=10')
  })

  it('sends no query string when there are no parameters', async () => {
    const fetchMock = respondWith(200, { data: [], meta: {} })
    await getProjects({})
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects')
  })

  it('unwraps a single project', async () => {
    const fetchMock = respondWith(200, { data: projectA })
    expect(await getProject('PRJ-001')).toEqual(projectA)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/PRJ-001')
  })

  it('turns an API error body into an ApiRequestError', async () => {
    respondWith(404, { error: { code: 'NOT_FOUND', message: 'Project PRJ-9 was not found.' } })
    await expect(getProject('PRJ-9')).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 404,
      code: 'NOT_FOUND',
      message: 'Project PRJ-9 was not found.',
    })
  })

  it('explains a server failure that has no JSON body', async () => {
    respondWith(502, '<html>Bad gateway</html>')
    const error = await getProjects().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({
      status: 502,
      message: 'The server is currently unavailable. Please try again shortly.',
    })
  })

  it('handles a client-error response that is not JSON', async () => {
    respondWith(418, 'teapot')
    await expect(getProjects()).rejects.toMatchObject({
      status: 418,
      message: 'The server returned an unexpected response.',
    })
  })

  it('reports an unreachable server as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(getProjects()).rejects.toMatchObject({ status: 0 })
  })
})
