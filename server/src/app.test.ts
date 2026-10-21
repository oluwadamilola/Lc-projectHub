import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { ProjectListResponse } from '@lc-projecthub/shared'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import type { ProjectRepository } from './domain/projectRepository.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { ProjectService } from './services/projectService.js'
import { fixtureProjects } from './testing/fixtures.js'

interface RunningApp {
  baseUrl: string
  close: () => Promise<void>
}

async function start(repository: ProjectRepository): Promise<RunningApp> {
  const app = createApp({ projectService: new ProjectService(repository), clientOrigin: 'http://localhost:5173' })
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

describe('API', () => {
  let running: RunningApp
  const get = (path: string) => fetch(`${running.baseUrl}${path}`)

  beforeAll(async () => {
    running = await start(new InMemoryProjectRepository(fixtureProjects))
  })
  afterAll(() => running.close())

  it('keeps /api/health working', async () => {
    const response = await get('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', service: 'lc-projecthub-server' })
  })

  describe('GET /api/projects', () => {
    it('returns data and paging meta', async () => {
      const response = await get('/api/projects?pageSize=2')
      const body = (await response.json()) as ProjectListResponse
      expect(response.status).toBe(200)
      expect(body.data.map((p) => p.id)).toEqual(['PRJ-001', 'PRJ-002'])
      expect(body.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 })
    })

    it('returns the full project shape', async () => {
      const body = (await (await get('/api/projects?q=alpha')).json()) as ProjectListResponse
      expect(body.data[0]).toEqual(fixtureProjects[0])
    })

    it('filters by status and search', async () => {
      const byStatus = (await (await get('/api/projects?status=Delayed')).json()) as ProjectListResponse
      expect(byStatus.data.map((p) => p.id)).toEqual(['PRJ-010'])
      const bySearch = (await (await get('/api/projects?q=casey&status=Complete')).json()) as ProjectListResponse
      expect(bySearch.data.map((p) => p.id)).toEqual(['PRJ-011'])
    })

    it('returns 200 with an empty list when nothing matches', async () => {
      const response = await get('/api/projects?q=zzz')
      const body = (await response.json()) as ProjectListResponse
      expect(response.status).toBe(200)
      expect(body.data).toEqual([])
      expect(body.meta.total).toBe(0)
      expect(body.meta.totalPages).toBe(0)
    })

    it('rejects invalid parameters with 400 and field details', async () => {
      const response = await get('/api/projects?status=Finished&page=0&pageSize=1000')
      const body = await response.json()
      expect(response.status).toBe(400)
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.details.map((d: { field: string }) => d.field)).toEqual(['status', 'page', 'pageSize'])
    })

    it('rejects a misspelt parameter instead of returning unfiltered data', async () => {
      const response = await get('/api/projects?statuss=Delayed')
      const body = await response.json()
      expect(response.status).toBe(400)
      expect(body.error.details[0].field).toBe('statuss')
    })

    it('does not advertise the server software', async () => {
      expect((await get('/api/projects')).headers.get('x-powered-by')).toBeNull()
    })

    it('rejects repeated parameters', async () => {
      expect((await get('/api/projects?status=At%20risk&status=Delayed')).status).toBe(400)
    })
  })

  describe('GET /api/projects/:id', () => {
    it('returns one project', async () => {
      const response = await get('/api/projects/PRJ-002')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: fixtureProjects[1] })
    })

    it('returns 404 with the standard error shape for a missing project', async () => {
      const response = await get('/api/projects/PRJ-999')
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Project PRJ-999 was not found.' },
      })
    })

    it('returns 400 for a malformed reference', async () => {
      const response = await get('/api/projects/bad%20id')
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
    })
  })

  it('returns a JSON 404 for unknown API routes', async () => {
    const response = await get('/api/nope')
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})

describe('API when the repository fails unexpectedly', () => {
  const failing: ProjectRepository = {
    list: () => Promise.reject(new Error('connection string leaked: secret-value')),
    findById: () => Promise.reject(new Error('boom')),
  }
  let running: RunningApp

  beforeAll(async () => {
    running = await start(failing)
  })
  afterAll(() => running.close())
  afterEach(() => vi.restoreAllMocks())

  it('returns 500 with a generic message and does not leak internals', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await fetch(`${running.baseUrl}/api/projects`)
    const text = await response.text()
    expect(response.status).toBe(500)
    expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR')
    expect(text).not.toContain('secret-value')
    expect(logged).toHaveBeenCalled()
  })

  it('returns 500 for a failing single-project lookup', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await fetch(`${running.baseUrl}/api/projects/PRJ-001`)
    expect(response.status).toBe(500)
  })
})
