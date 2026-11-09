import type { AddEquipmentResponse, ApiErrorResponse, AuditRoomResponse, InspectionResponse } from '@lc-projecthub/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InspectionRepository } from './domain/auditRepository.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { buildFixtureAudit } from './testing/auditFixtures.js'
import { startTestServer, type RunningApp } from './testing/startTestServer.js'
import { fixtureProjects } from './testing/fixtures.js'

/*
  The inspection endpoints over real HTTP, against the hand-checkable fixture (see testing/auditFixtures.ts and
  services/inspectionService.test.ts for the rooms). The workflow rules are tested in the service tests; these check
  what only HTTP shows: status codes, headers, error bodies, malformed requests and requests that overlap.
*/

let running: RunningApp | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await running?.close()
  running = undefined
})

async function boot(options: Parameters<typeof buildFixtureAudit>[0] = {}) {
  const fixture = buildFixtureAudit(options)
  running = await startTestServer(new InMemoryProjectRepository(fixtureProjects), { audit: fixture.audit, inspections: fixture.inspections })
  return { fixture, base: running.baseUrl }
}

const call = (base: string, method: string, path: string, body?: unknown) =>
  fetch(`${base}/api/audit${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const TECH = { inspectorId: 'TECH-001' }

async function expectError(response: Response, status: number, code: string, ...fields: string[]) {
  const body = (await response.json()) as ApiErrorResponse
  expect(response.status).toBe(status)
  expect(body.error.code).toBe(code)
  expect(typeof body.error.message).toBe('string')
  if (fields.length > 0) expect(body.error.details?.map((detail) => detail.field)).toEqual(fields)
  return body.error
}

describe('POST /api/audit/rooms/:roomId/inspection', () => {
  it('starts an inspection: 201 with a Location, then 200 with the same inspection when asked again', async () => {
    const { base } = await boot()
    const created = await call(base, 'POST', '/rooms/ROOM-002/inspection', TECH)
    expect(created.status).toBe(201)
    const body = (await created.json()) as InspectionResponse
    expect(created.headers.get('location')).toBe(`/api/audit/inspections/${body.data.id}`)
    expect(body.data).toMatchObject({ id: 'INS-008', status: 'In progress', inspectorName: 'Test Technician One' })
    const again = await call(base, 'POST', '/rooms/ROOM-002/inspection', { inspectorId: 'TECH-002' })
    expect(again.status).toBe(200)
    expect(((await again.json()) as InspectionResponse).data).toMatchObject({ id: 'INS-008', inspectorId: 'TECH-001' })
  })

  it('creates one inspection when several requests arrive at once: one 201, the rest 200, all the same inspection', async () => {
    const { base } = await boot()
    const responses = await Promise.all(Array.from({ length: 6 }, () => call(base, 'POST', '/rooms/ROOM-002/inspection', TECH)))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 200, 200, 201])
    const ids = await Promise.all(responses.map(async (response) => ((await response.json()) as InspectionResponse).data.id))
    expect(new Set(ids).size).toBe(1)
    const room = (await (await call(base, 'GET', '/rooms/ROOM-002')).json()) as AuditRoomResponse
    expect(room.data.inspection.status).toBe('In progress')
  })

  it('shows the new inspection in the room page and the cycle progress', async () => {
    const { base } = await boot()
    await call(base, 'POST', '/rooms/ROOM-002/inspection', TECH)
    const room = (await (await call(base, 'GET', '/rooms/ROOM-002')).json()) as AuditRoomResponse
    expect(room.data.inspection).toMatchObject({ status: 'In progress', inspectorName: 'Test Technician One' })
    const cycles = (await (await call(base, 'GET', '/cycles/CYC-002')).json()) as { data: { progress: { inProgress: number; notStarted: number } } }
    expect(cycles.data.progress).toMatchObject({ inProgress: 2, notStarted: 1 })
  })

  it('answers the errors a client can cause', async () => {
    const { base } = await boot()
    await expectError(await call(base, 'POST', '/rooms/ROOM-999/inspection', TECH), 404, 'NOT_FOUND')
    await expectError(await call(base, 'POST', '/rooms/bad_id!/inspection', TECH), 400, 'VALIDATION_ERROR', 'roomId')
    await expectError(await call(base, 'POST', '/rooms/ROOM-002/inspection', {}), 400, 'VALIDATION_ERROR', 'inspectorId')
    await expectError(await call(base, 'POST', '/rooms/ROOM-002/inspection', { inspectorId: 'TECH-099' }), 400, 'VALIDATION_ERROR', 'inspectorId')
    await expectError(await call(base, 'POST', '/rooms/ROOM-002/inspection', { ...TECH, cycleId: 'CYC-999' }), 404, 'NOT_FOUND')
    await expectError(await call(base, 'POST', '/rooms/ROOM-002/inspection', { ...TECH, cycleId: 'CYC-001' }), 409, 'CONFLICT')
    await expectError(await call(base, 'POST', '/rooms/ROOM-001/inspection', TECH), 409, 'CONFLICT')
    await expectError(await call(base, 'POST', '/rooms/ROOM-003/inspection', TECH), 409, 'CONFLICT')
    const none = await fetch(`${base}/api/audit/rooms/ROOM-002/inspection`, { method: 'POST' })
    await expectError(none, 400, 'VALIDATION_ERROR', 'body')
    const malformed = await fetch(`${base}/api/audit/rooms/ROOM-002/inspection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"inspectorId":' })
    await expectError(malformed, 400, 'VALIDATION_ERROR')
    const room = (await (await call(base, 'GET', '/rooms/ROOM-002')).json()) as AuditRoomResponse
    expect(room.data.inspection.status).toBe('Not started')
  })

  it('refuses every start when there is no open cycle', async () => {
    const closed = await boot({ cycles: [{ id: 'CYC-001', name: 'Summer 2025', year: 2025, status: 'Closed', startDate: '2025-06-23', endDate: '2025-08-29', closedAt: '2025-09-05T10:00:00.000Z', scopeRoomIds: ['ROOM-002'] }] })
    const error = await expectError(await call(closed.base, 'POST', '/rooms/ROOM-002/inspection', TECH), 409, 'CONFLICT')
    expect(error.message).toMatch(/no open inspection cycle/)
  })
})

describe('GET /api/audit/inspections/:id', () => {
  it('returns the inspection with its checklist, progress and what is still needed', async () => {
    const { base } = await boot()
    const response = await call(base, 'GET', '/inspections/INS-006')
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as InspectionResponse
    expect(data).toMatchObject({ id: 'INS-006', status: 'In progress', progress: { total: 3, checked: 2 }, completion: { canComplete: false } })
    expect(data.completion.problems.map((problem) => problem.field)).toEqual(['results.EQP-004', 'results.EQP-005'])
    expect(data.lines.map((line) => line.id)).toEqual(['EQP-003', 'EQP-004', 'EQP-005'])
    expect(data.lines[0].previous?.cycleName).toBe('Summer 2025')
  })

  it('answers not found for an unknown inspection, a bad reference and an unknown parameter', async () => {
    const { base } = await boot()
    await expectError(await call(base, 'GET', '/inspections/INS-999'), 404, 'NOT_FOUND')
    await expectError(await call(base, 'GET', '/inspections/bad_id!'), 400, 'VALIDATION_ERROR', 'inspectionId')
    await expectError(await call(base, 'GET', '/inspections/INS-006?cycle=CYC-002'), 400, 'VALIDATION_ERROR', 'cycle')
  })

  it('cannot be deleted or patched: there is no such endpoint', async () => {
    const { base } = await boot()
    for (const method of ['DELETE', 'PATCH']) await expectError(await call(base, method, '/inspections/INS-006'), 404, 'NOT_FOUND')
    await expectError(await call(base, 'PUT', '/inspections/INS-006', { status: 'Completed' }), 404, 'NOT_FOUND')
    await expectError(await call(base, 'DELETE', '/inspections/INS-006/results/EQP-003'), 404, 'NOT_FOUND')
  })
})

describe('PUT /api/audit/inspections/:id/results/:itemId', () => {
  it('saves a line, returns the inspection with the new progress, and the answer persists for the next reader', async () => {
    const { base } = await boot()
    const response = await call(base, 'PUT', '/inspections/INS-006/results/EQP-004', { condition: 'Working', note: '', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }] })
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as InspectionResponse
    expect(data.progress).toEqual({ total: 3, checked: 3 })
    expect(data.lines.find((line) => line.id === 'EQP-004')!.current!.checks[0].condition).toBe('Working')
    const reread = (await (await call(base, 'GET', '/inspections/INS-006')).json()) as InspectionResponse
    expect(reread.data.progress.checked).toBe(3)
    const room = (await (await call(base, 'GET', '/rooms/ROOM-004')).json()) as AuditRoomResponse
    expect(room.data.equipment.find((line) => line.id === 'EQP-004')!.current!.condition).toBe('Working')
  })

  it('answers the errors a client can cause, leaving the inspection unchanged', async () => {
    const { base } = await boot()
    await expectError(await call(base, 'PUT', '/inspections/INS-006/results/EQP-004', { condition: 'Broken', note: '' }), 400, 'VALIDATION_ERROR', 'condition')
    await expectError(await call(base, 'PUT', '/inspections/INS-006/results/EQP-004', { condition: 'Working', note: '', checks: [{ checkId: 'colour', condition: 'Working', note: '' }] }), 400, 'VALIDATION_ERROR', 'checks.0')
    await expectError(await call(base, 'PUT', '/inspections/INS-006/results/EQP-001', { condition: 'Working', note: '' }), 404, 'NOT_FOUND')
    await expectError(await call(base, 'PUT', '/inspections/INS-999/results/EQP-004', { condition: 'Working', note: '' }), 404, 'NOT_FOUND')
    await expectError(await call(base, 'PUT', '/inspections/INS-005/results/EQP-001', { condition: 'Working', note: '' }), 409, 'CONFLICT')
    await expectError(await call(base, 'PUT', '/inspections/INS-007/results/EQP-007', { condition: 'Working', note: '' }), 409, 'CONFLICT')
    const { data } = (await (await call(base, 'GET', '/inspections/INS-006')).json()) as InspectionResponse
    expect(data.progress.checked).toBe(2)
  })
})

describe('POST /api/audit/inspections/:id/equipment', () => {
  it('adds equipment found in the room: 201, flagged for review, on the checklist and in the inventory', async () => {
    const { base } = await boot()
    const response = await call(base, 'POST', '/inspections/INS-006/equipment', { equipmentTypeId: 'other', name: 'Visualiser', assetTag: 'AT-NEW1' })
    expect(response.status).toBe(201)
    expect(response.headers.get('location')).toBe('/api/audit/inspections/INS-006')
    const body = (await response.json()) as AddEquipmentResponse
    expect(body.equipmentItemId).toBe('EQP-009')
    expect(body.data.lines.find((line) => line.id === 'EQP-009')).toMatchObject({ reviewStatus: 'Needs review', source: 'Found during inspection', assetTag: 'AT-NEW1' })
    const room = (await (await call(base, 'GET', '/rooms/ROOM-004')).json()) as AuditRoomResponse
    expect(room.data).toMatchObject({ equipmentCount: 4, itemsNeedingReview: 2 })
  })

  it('answers the errors a client can cause', async () => {
    const { base } = await boot()
    await expectError(await call(base, 'POST', '/inspections/INS-006/equipment', { equipmentTypeId: 'other' }), 400, 'VALIDATION_ERROR', 'name')
    await expectError(await call(base, 'POST', '/inspections/INS-006/equipment', { equipmentTypeId: 'phone', assetTag: 'AT-003' }), 409, 'CONFLICT')
    await expectError(await call(base, 'POST', '/inspections/INS-005/equipment', { equipmentTypeId: 'phone' }), 409, 'CONFLICT')
    await expectError(await call(base, 'POST', '/inspections/INS-999/equipment', { equipmentTypeId: 'phone' }), 404, 'NOT_FOUND')
    const room = (await (await call(base, 'GET', '/rooms/ROOM-004')).json()) as AuditRoomResponse
    expect(room.data.equipmentCount).toBe(3)
  })
})

describe('PUT /api/audit/inspections/:id/no-equipment', () => {
  it('confirms a room has none (200), and is rejected (409) when it has active equipment', async () => {
    const { base } = await boot()
    const started = (await (await call(base, 'POST', '/rooms/ROOM-002/inspection', TECH)).json()) as InspectionResponse
    const ok = await call(base, 'PUT', `/inspections/${started.data.id}/no-equipment`, { confirmed: true })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as InspectionResponse).data).toMatchObject({ noEquipmentConfirmed: true, completion: { canComplete: true } })
    const refused = await expectError(await call(base, 'PUT', '/inspections/INS-006/no-equipment', { confirmed: true }), 409, 'CONFLICT')
    expect(refused.message).toMatch(/cannot be confirmed as having none/)
    await expectError(await call(base, 'PUT', '/inspections/INS-006/no-equipment', { confirmed: 'yes' }), 400, 'VALIDATION_ERROR', 'confirmed')
  })
})

describe('POST /api/audit/inspections/:id/unable', () => {
  it('records the reason, inspector and time; the room can be started again afterwards', async () => {
    const { base } = await boot()
    const response = await call(base, 'POST', '/inspections/INS-006/unable', { reason: 'Room locked', inspectorId: 'TECH-002' })
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as InspectionResponse
    expect(data.status).toBe('Unable to inspect')
    expect(data.attempts).toEqual([{ at: expect.stringMatching(/^2026-08-03T/), byId: 'TECH-002', byName: 'Test Technician Two', reason: 'Room locked' }])
    const room = (await (await call(base, 'GET', '/rooms/ROOM-004')).json()) as AuditRoomResponse
    expect(room.data.inspection).toMatchObject({ status: 'Unable to inspect', unableReason: 'Room locked' })
    const again = await call(base, 'POST', '/rooms/ROOM-004/inspection', TECH)
    expect(again.status).toBe(200)
    expect(((await again.json()) as InspectionResponse).data).toMatchObject({ id: 'INS-006', status: 'In progress' })
  })

  it('answers the errors a client can cause', async () => {
    const { base } = await boot()
    await expectError(await call(base, 'POST', '/inspections/INS-006/unable', { reason: 'no' }), 400, 'VALIDATION_ERROR', 'reason')
    await expectError(await call(base, 'POST', '/inspections/INS-006/unable', {}), 400, 'VALIDATION_ERROR', 'reason')
    await expectError(await call(base, 'POST', '/inspections/INS-007/unable', { reason: 'Room locked' }), 409, 'CONFLICT')
    await expectError(await call(base, 'POST', '/inspections/INS-999/unable', { reason: 'Room locked' }), 404, 'NOT_FOUND')
  })
})

describe('POST /api/audit/inspections/:id/complete', () => {
  const finish = async (base: string) => {
    await call(base, 'PUT', '/inspections/INS-006/results/EQP-004', { condition: 'Working', note: '', checks: [{ checkId: 'firmware', condition: 'Not working', note: 'Needs update' }] })
    await call(base, 'PUT', '/inspections/INS-006/results/EQP-005', { condition: 'Not working', note: 'Lens cracked' })
  }

  it('refuses an incomplete checklist with 400 listing every problem, then completes once it is finished', async () => {
    const { base } = await boot()
    const refused = await expectError(await call(base, 'POST', '/inspections/INS-006/complete'), 400, 'VALIDATION_ERROR', 'results.EQP-004', 'results.EQP-005')
    expect(refused.details![0].message).toBe('Panel has not been checked.')
    await finish(base)
    const response = await call(base, 'POST', '/inspections/INS-006/complete')
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as InspectionResponse
    expect(data).toMatchObject({ status: 'Completed', completion: { canComplete: false } })
    expect(data.summary).toMatchObject({ totalItems: 3, counts: { Working: 2, 'Not working': 1 } })
    expect(data.summary!.issues).toEqual([expect.objectContaining({ equipmentItemId: 'EQP-005', kind: 'Fault', note: 'Lens cracked' })])
    expect(data.summary!.checkIssues).toEqual([expect.objectContaining({ equipmentItemId: 'EQP-004', answer: 'Needs update' })])
  })

  it('a second submission is 409 and the completion time does not move', async () => {
    const { base } = await boot()
    await finish(base)
    const first = (await (await call(base, 'POST', '/inspections/INS-006/complete')).json()) as InspectionResponse
    await expectError(await call(base, 'POST', '/inspections/INS-006/complete'), 409, 'CONFLICT')
    const reread = (await (await call(base, 'GET', '/inspections/INS-006')).json()) as InspectionResponse
    expect(reread.data.completedAt).toBe(first.data.completedAt)
  })

  it('completes exactly once when submitted several times at once: one 200, the rest 409', async () => {
    const { base } = await boot()
    await finish(base)
    const responses = await Promise.all(Array.from({ length: 4 }, () => call(base, 'POST', '/inspections/INS-006/complete')))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409, 409, 409])
  })

  it('a completed inspection can no longer be edited through any endpoint', async () => {
    const { base } = await boot()
    await finish(base)
    await call(base, 'POST', '/inspections/INS-006/complete')
    const before = await (await call(base, 'GET', '/inspections/INS-006')).text()
    const attempts = [
      call(base, 'PUT', '/inspections/INS-006/results/EQP-003', { condition: 'Missing', note: 'x' }),
      call(base, 'POST', '/inspections/INS-006/equipment', { equipmentTypeId: 'phone' }),
      call(base, 'PUT', '/inspections/INS-006/no-equipment', { confirmed: false }),
      call(base, 'POST', '/inspections/INS-006/unable', { reason: 'Room locked' }),
      call(base, 'POST', '/rooms/ROOM-004/inspection', TECH),
    ]
    for (const response of await Promise.all(attempts)) await expectError(response, 409, 'CONFLICT')
    expect(await (await call(base, 'GET', '/inspections/INS-006')).text()).toBe(before)
  })

  it('answers not found, and conflict for an unable-to-inspect inspection', async () => {
    const { base } = await boot()
    await expectError(await call(base, 'POST', '/inspections/INS-999/complete'), 404, 'NOT_FOUND')
    await expectError(await call(base, 'POST', '/inspections/INS-007/complete'), 409, 'CONFLICT')
  })
})

describe('a whole inspection, start to finish, over HTTP', () => {
  it('walks a room with equipment: start, answer each line, add found equipment, complete, and read the result', async () => {
    const { base } = await boot()
    const started = (await (await call(base, 'POST', '/rooms/ROOM-005/inspection', { inspectorId: 'TECH-002' })).json()) as InspectionResponse
    expect(started.data.id).toBe('INS-007')
    expect(started.data.progress).toEqual({ total: 1, checked: 0 })
    expect((await call(base, 'POST', `/inspections/${started.data.id}/complete`)).status).toBe(400)
    await call(base, 'PUT', `/inspections/${started.data.id}/results/EQP-007`, { condition: 'Needs replacement', note: 'Cracked handset' })
    const found = (await (await call(base, 'POST', `/inspections/${started.data.id}/equipment`, { equipmentTypeId: 'other', name: 'Whiteboard camera' })).json()) as AddEquipmentResponse
    await call(base, 'PUT', `/inspections/${started.data.id}/results/${found.equipmentItemId}`, { condition: 'Working', note: '' })
    const done = (await (await call(base, 'POST', `/inspections/${started.data.id}/complete`)).json()) as InspectionResponse
    expect(done.data.summary).toMatchObject({ totalItems: 2, foundItems: [{ equipmentItemId: found.equipmentItemId }] })
    expect(done.data.summary!.issues[0]).toMatchObject({ kind: 'Replacement required', note: 'Cracked handset' })
    const cycle = (await (await call(base, 'GET', '/cycles/CYC-002')).json()) as { data: { progress: { completed: number; unableToInspect: number } } }
    expect(cycle.data.progress).toMatchObject({ completed: 2, unableToInspect: 0 })
  })
})

describe('when the data store fails', () => {
  it('answers 500 without leaking the cause, leaves the inspection as it was, and recovers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let fail = false
    const { base, fixture } = await boot({
      wrapInspections: (repository): InspectionRepository => ({
        listByCycle: (id) => repository.listByCycle(id),
        listByRoom: (id) => repository.listByRoom(id),
        findById: (id) => repository.findById(id),
        create: (input) => repository.create(input),
        save: async (record) => {
          if (fail) throw new Error('secret-connection-string')
          return repository.save(record)
        },
      }),
    })
    fail = true
    const response = await call(base, 'PUT', '/inspections/INS-006/results/EQP-004', { condition: 'Working', note: '', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }] })
    const error = await expectError(response, 500, 'INTERNAL_ERROR')
    expect(JSON.stringify(error)).not.toContain('secret-connection-string')
    expect((await fixture.repositories.inspections.findById('INS-006'))!.results[1].condition).toBe('Not checked')
    fail = false
    expect((await call(base, 'PUT', '/inspections/INS-006/results/EQP-004', { condition: 'Working', note: '', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }] })).status).toBe(200)
  })
})

describe('cycle dates over HTTP', () => {
  it('answers 409 CONFLICT outside the cycle window for start, no-equipment and complete, and succeeds inside it', async () => {
    let now = new Date('2026-06-01T09:00:00.000Z')
    const { base } = await boot({ clock: () => now })
    const early = await expectError(await call(base, 'POST', '/rooms/ROOM-002/inspection', TECH), 409, 'CONFLICT')
    expect(early.message).toMatch(/opens on 2026-06-22/)

    now = new Date('2026-07-15T09:00:00.000Z')
    const started = await call(base, 'POST', '/rooms/ROOM-002/inspection', TECH)
    expect(started.status).toBe(201)
    const id = ((await started.json()) as InspectionResponse).data.id

    now = new Date('2026-09-01T09:00:00.000Z')
    const late = await expectError(await call(base, 'PUT', `/inspections/${id}/no-equipment`, { confirmed: true }), 409, 'CONFLICT')
    expect(late.message).toMatch(/ended on 2026-08-28/)
    await expectError(await call(base, 'POST', `/inspections/${id}/complete`), 409, 'CONFLICT')
    expect(((await (await call(base, 'GET', `/inspections/${id}`)).json()) as InspectionResponse).data.noEquipmentConfirmed).toBe(false)
  })

  it('keeps saved answers through unable-to-inspect and a restart of the same inspection', async () => {
    const { base, fixture } = await boot()
    const started = (await (await call(base, 'POST', '/rooms/ROOM-002/inspection', TECH)).json()) as InspectionResponse
    const added = (await (await call(base, 'POST', `/inspections/${started.data.id}/equipment`, { equipmentTypeId: 'phone' })).json()) as AddEquipmentResponse
    await call(base, 'PUT', `/inspections/${started.data.id}/results/${added.equipmentItemId}`, { condition: 'Working', note: '' })
    const unable = await call(base, 'POST', `/inspections/${started.data.id}/unable`, { reason: 'Room locked' })
    expect(unable.status).toBe(200)
    expect(((await unable.json()) as InspectionResponse).data.progress).toEqual({ total: 1, checked: 1 })

    const resumed = await call(base, 'POST', '/rooms/ROOM-002/inspection', TECH)
    expect(resumed.status).toBe(200)
    const body = (await resumed.json()) as InspectionResponse
    expect(body.data).toMatchObject({ id: started.data.id, status: 'In progress', progress: { total: 1, checked: 1 } })
    expect(body.data.lines[0]!.current).toMatchObject({ condition: 'Working' })
    expect((await fixture.repositories.inspections.findById(started.data.id))!.attempts).toHaveLength(1)
  })
})
