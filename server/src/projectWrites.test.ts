import type { ProjectInput, ProjectListResponse } from '@lc-projecthub/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRepository } from './domain/projectRepository.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { fixtureProjects } from './testing/fixtures.js'
import { startTestServer, type RunningApp } from './testing/startTestServer.js'

const valid: ProjectInput = {
  name: 'Foxtrot Wi-Fi',
  description: 'Add access points to the annexe.',
  location: 'Test Annexe',
  department: 'Infrastructure',
  lead: 'Jamie Cole',
  priority: 'Medium',
  status: 'Planning',
  progress: 0,
  startDate: '2026-05-01',
  dueDate: '2026-08-01',
}

let running: RunningApp
beforeEach(async () => {
  running = await startTestServer(new InMemoryProjectRepository(fixtureProjects))
})
afterEach(() => running.close())

const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${running.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
const post = (body?: unknown) => send('POST', '/api/projects', body)
const put = (id: string, body?: unknown) => send('PUT', `/api/projects/${id}`, body)
const getJson = async (path: string) => (await fetch(`${running.baseUrl}${path}`)).json()

async function expectValidation(response: Response, ...fields: string[]) {
  const body = await response.json()
  expect(response.status).toBe(400)
  expect(body.error.code).toBe('VALIDATION_ERROR')
  expect(body.error.details.map((d: { field: string }) => d.field)).toEqual(fields)
  for (const detail of body.error.details) expect(detail.message.length).toBeGreaterThan(5)
}

describe('POST /api/projects', () => {
  it('creates a project: 201, Location header, server-assigned reference', async () => {
    const response = await post(valid)
    const body = await response.json()
    expect(response.status).toBe(201)
    expect(body).toEqual({ data: { ...valid, id: 'PRJ-012' } })
    expect(response.headers.get('location')).toBe('/api/projects/PRJ-012')
  })

  it('stores the project so it can be read, listed and searched', async () => {
    const { data } = await (await post(valid)).json()
    expect(await getJson(`/api/projects/${data.id}`)).toEqual({ data })
    const list = (await getJson('/api/projects?pageSize=50')) as ProjectListResponse
    expect(list.meta.total).toBe(6)
    expect(list.data.at(-1)).toEqual(data)
    expect(((await getJson('/api/projects?q=foxtrot')) as ProjectListResponse).data).toEqual([data])
  })

  it('trims text before storing it', async () => {
    const { data } = await (await post({ ...valid, name: '  Padded  ', lead: ' Jamie Cole ' })).json()
    expect(data.name).toBe('Padded')
    expect(data.lead).toBe('Jamie Cole')
  })

  it('gives every project a unique reference, even for simultaneous requests', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(valid)))
    const ids = (await Promise.all(responses.map((r) => r.json()))).map((b) => b.data.id)
    expect(responses.every((r) => r.status === 201)).toBe(true)
    expect(new Set(ids).size).toBe(20)
    expect(new Set([...ids, ...fixtureProjects.map((p) => p.id)]).size).toBe(25)
  })

  it('accepts progress above zero for a new project', async () => {
    expect((await post({ ...valid, status: 'On track', progress: 40 })).status).toBe(201)
  })

  it('ignores a client-supplied reference by rejecting it', async () => {
    await expectValidation(await post({ ...valid, id: 'PRJ-001' }), 'id')
    expect((await getJson('/api/projects/PRJ-001')).data.name).toBe('Alpha Network')
  })

  it.each(['name', 'description', 'location', 'department', 'lead', 'priority', 'status', 'progress', 'startDate', 'dueDate'])(
    'rejects a missing %s with a field-specific error',
    async (field) => {
      const { [field]: _omitted, ...rest } = valid as unknown as Record<string, unknown>
      void _omitted
      await expectValidation(await post(rest), field)
    },
  )

  it('rejects blank text, over-long text and wrong types', async () => {
    await expectValidation(await post({ ...valid, name: '   ' }), 'name')
    await expectValidation(await post({ ...valid, description: 'x'.repeat(1001) }), 'description')
    await expectValidation(await post({ ...valid, lead: 12 }), 'lead')
  })

  it('rejects unsupported status and priority', async () => {
    await expectValidation(await post({ ...valid, status: 'Finished' }), 'status')
    await expectValidation(await post({ ...valid, priority: 'Urgent' }), 'priority')
  })

  it.each([-1, 101, 1.5, '50', null])('rejects invalid progress %j', async (progress) => {
    await expectValidation(await post({ ...valid, progress }), 'progress')
  })

  it('rejects a completed project that is not 100% complete', async () => {
    await expectValidation(await post({ ...valid, status: 'Complete', progress: 50 }), 'progress')
  })

  it('rejects bad dates and a target date before the start date', async () => {
    await expectValidation(await post({ ...valid, startDate: '2026-02-30' }), 'startDate')
    await expectValidation(await post({ ...valid, dueDate: 'next week' }), 'dueDate')
    await expectValidation(await post({ ...valid, startDate: '2026-09-01', dueDate: '2026-08-01' }), 'dueDate')
  })

  it('reports every problem in one response', async () => {
    await expectValidation(await post({ ...valid, name: '', progress: 200, dueDate: '' }), 'name', 'progress', 'dueDate')
  })

  it('rejects bodies that are not a JSON object', async () => {
    await expectValidation(await post([valid]), 'body')
    // An empty body is read as {}, so every required field is reported as missing.
    await expectValidation(
      await send('POST', '/api/projects', undefined),
      'name', 'description', 'location', 'department', 'lead', 'priority', 'status', 'progress', 'startDate', 'dueDate',
    )
    // Bare JSON values are refused by the body parser itself, before validation: still a clean 400.
    for (const bare of ['null', '"text"', '42']) {
      const response = await post(bare)
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('rejects malformed JSON and non-JSON content with 400', async () => {
    const malformed = await send('POST', '/api/projects', '{"name": ')
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error.code).toBe('VALIDATION_ERROR')
    const text = await send('POST', '/api/projects', JSON.stringify(valid), { 'Content-Type': 'text/plain' })
    expect(text.status).toBe(400)
  })

  it('stores nothing when validation fails', async () => {
    await post({ ...valid, progress: 500 })
    await post({ ...valid, name: '' })
    expect(((await getJson('/api/projects')) as ProjectListResponse).meta.total).toBe(5)
    expect((await (await post(valid)).json()).data.id).toBe('PRJ-012')
  })
})

describe('PUT /api/projects/:id', () => {
  const changed: ProjectInput = {
    ...valid,
    name: 'Bravo Laptops (renamed)',
    status: 'On track',
    progress: 55,
  }

  it('updates the project and returns it with the same reference', async () => {
    const response = await put('PRJ-002', changed)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ...changed, id: 'PRJ-002' } })
  })

  it('persists the change and leaves other projects alone', async () => {
    await put('PRJ-002', changed)
    expect((await getJson('/api/projects/PRJ-002')).data).toEqual({ ...changed, id: 'PRJ-002' })
    expect((await getJson('/api/projects/PRJ-001')).data).toEqual(fixtureProjects[0])
    expect(((await getJson('/api/projects')) as ProjectListResponse).meta.total).toBe(5)
  })

  it('returns 404 for a project that does not exist', async () => {
    const response = await put('PRJ-999', changed)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Project PRJ-999 was not found.' } })
  })

  it('returns 404 for a missing project even when the body is also invalid', async () => {
    expect((await put('PRJ-999', { name: '' })).status).toBe(404)
  })

  it('returns 400 for a malformed reference', async () => {
    await expectValidation(await put('bad%20id', changed), 'id')
  })

  it('validates the body and keeps the stored project unchanged on failure', async () => {
    await expectValidation(await put('PRJ-002', { ...changed, progress: 101, dueDate: '2000-01-01' }), 'progress', 'dueDate')
    expect((await getJson('/api/projects/PRJ-002')).data).toEqual(fixtureProjects[1])
  })

  it('requires the whole project (PUT replaces)', async () => {
    await expectValidation(await put('PRJ-002', { name: 'Only a name' }), 'description', 'location', 'department', 'lead', 'priority', 'status', 'progress', 'startDate', 'dueDate')
  })

  it('refuses to change the reference', async () => {
    await expectValidation(await put('PRJ-002', { ...changed, id: 'PRJ-001' }), 'id')
    expect((await getJson('/api/projects/PRJ-001')).data.name).toBe('Alpha Network')
  })

  it('rejects unsupported status and priority', async () => {
    await expectValidation(await put('PRJ-002', { ...changed, status: 'Done' }), 'status')
    await expectValidation(await put('PRJ-002', { ...changed, priority: 'Whenever' }), 'priority')
  })

  it('allows saving without changes', async () => {
    const { id: _id, ...unchanged } = fixtureProjects[1]
    void _id
    expect((await put('PRJ-002', unchanged)).status).toBe(200)
  })
})

describe('what is not supported', () => {
  it('has no partial-update endpoint (deleting is covered in projectDeletion.test.ts)', async () => {
    expect((await send('PATCH', '/api/projects/PRJ-001')).status).toBe(404)
    expect((await getJson('/api/projects/PRJ-001')).data.name).toBe('Alpha Network')
  })

  it('keeps /api/health and reads working', async () => {
    expect((await getJson('/api/health')).status).toBe('ok')
    expect(((await getJson('/api/projects')) as ProjectListResponse).meta.total).toBe(5)
  })
})

describe('when the repository fails', () => {
  const failing: ProjectRepository = {
    list: () => Promise.reject(new Error('secret-connection-string')),
    findById: (id) => Promise.resolve(id === 'PRJ-001' ? fixtureProjects[0] : null),
    create: () => Promise.reject(new Error('secret-connection-string')),
    update: () => Promise.reject(new Error('secret-connection-string')),
    delete: () => Promise.reject(new Error('secret-connection-string')),
  }
  let broken: RunningApp
  beforeEach(async () => {
    broken = await startTestServer(failing)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(async () => {
    await broken.close()
    vi.restoreAllMocks()
  })

  it('returns 500 with a generic message for a failed create and does not leak details', async () => {
    const response = await fetch(`${broken.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    })
    const text = await response.text()
    expect(response.status).toBe(500)
    expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR')
    expect(text).not.toContain('secret-connection-string')
  })

  it('returns 500 for a failed update', async () => {
    const response = await fetch(`${broken.baseUrl}/api/projects/PRJ-001`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    })
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('secret-connection-string')
  })

  it('still reports validation problems as 400, not 500', async () => {
    const response = await fetch(`${broken.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...valid, name: '' }),
    })
    expect(response.status).toBe(400)
  })
})
