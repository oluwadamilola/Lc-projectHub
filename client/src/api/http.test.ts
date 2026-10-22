import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from './http'
import { createProject, getProject, getProjects, updateProject } from './projects'
import { projectA } from '../test/fixtures'

const { id: _ignored, ...inputA } = projectA
void _ignored

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

describe('saving projects', () => {
  it('POSTs the project as JSON and returns the created project', async () => {
    const created = { ...projectA, id: 'PRJ-113' }
    const fetchMock = respondWith(201, { data: created })
    expect(await createProject(inputA)).toEqual(created)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/projects')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual(inputA)
  })

  it('PUTs the project to its own address and returns the updated project', async () => {
    const fetchMock = respondWith(200, { data: projectA })
    expect(await updateProject('PRJ-001', inputA)).toEqual(projectA)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/projects/PRJ-001')
    expect(init.method).toBe('PUT')
  })

  it('encodes the reference in the address', async () => {
    const fetchMock = respondWith(200, { data: projectA })
    await updateProject('a/b c', inputA)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/a%2Fb%20c')
  })

  it('does not send a body or content type for reads', async () => {
    const fetchMock = respondWith(200, { data: projectA })
    await getProject('PRJ-001')
    const init = fetchMock.mock.calls[0][1]
    expect(init.body).toBeUndefined()
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('carries field-level validation details from a 400 response', async () => {
    const details = [{ field: 'progress', message: 'Enter the progress as a whole number from 0 to 100.' }]
    respondWith(400, { error: { code: 'VALIDATION_ERROR', message: 'The request contains invalid values.', details } })
    const error = await createProject(inputA).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details })
  })

  it('reports a missing project on update as 404', async () => {
    respondWith(404, { error: { code: 'NOT_FOUND', message: 'Project PRJ-9 was not found.' } })
    await expect(updateProject('PRJ-9', inputA)).rejects.toMatchObject({ status: 404, details: [] })
  })

  it('reports an unreachable server on save as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(createProject(inputA)).rejects.toMatchObject({ status: 0 })
  })
})
