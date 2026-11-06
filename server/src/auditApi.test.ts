import type {
  AuditBlockListResponse,
  AuditBlockResponse,
  AuditCycleListResponse,
  AuditCycleResponse,
  AuditFloorListResponse,
  AuditFloorResponse,
  AuditRoomListResponse,
  AuditRoomResponse,
  EquipmentTypeListResponse,
} from '@lc-projecthub/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InspectionRepository } from './domain/auditRepository.js'
import { buildSeedAudit } from './data/seedAudit.js'
import { seedTechnicians } from './data/seedTasks.js'
import { ConflictError } from './errors.js'
import {
  InMemoryBlockRepository,
  InMemoryCycleRepository,
  InMemoryEquipmentItemRepository,
  InMemoryEquipmentTypeRepository,
  InMemoryFloorRepository,
  InMemoryInspectionRepository,
  InMemoryRoomRepository,
} from './repositories/inMemoryAuditRepositories.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { InMemoryTechnicianRepository } from './repositories/inMemoryTechnicianRepository.js'
import { AuditService } from './services/auditService.js'
import {
  buildFixtureAuditService,
  fixtureBlocks,
  fixtureCycles,
  fixtureEquipmentTypes,
  fixtureFloors,
  fixtureItems,
  fixtureRooms,
} from './testing/auditFixtures.js'
import { fixtureProjects } from './testing/fixtures.js'
import { fixtureTechnicians } from './testing/taskFixtures.js'
import { startTestServer, type RunningApp } from './testing/startTestServer.js'

/* GET /api/audit/... against the hand-checkable fixture (see testing/auditFixtures.ts). */

let running: RunningApp
beforeEach(async () => {
  running = await startTestServer(new InMemoryProjectRepository(fixtureProjects), { audit: buildFixtureAuditService() })
})
afterEach(() => running.close())

const send = (method: string, path: string) => fetch(`${running.baseUrl}${path}`, { method })
const get = (path: string) => send('GET', path)
const json = async <T>(path: string) => (await (await get(path)).json()) as T
const codes = (body: AuditRoomListResponse) => body.data.map((room) => room.code)
const progress = (scope: number, completed: number, inProgress: number, unableToInspect: number, notStarted: number, percentComplete: number | null) => ({
  scope, completed, inProgress, unableToInspect, notStarted, percentComplete,
})

async function expectError(response: Response, status: number, code: string, message?: string, ...fields: string[]) {
  const body = await response.json()
  expect(response.status).toBe(status)
  expect(body.error.code).toBe(code)
  if (message) expect(body.error.message).toBe(message)
  if (fields.length > 0) expect(body.error.details.map((d: { field: string }) => d.field)).toEqual(fields)
}

describe('GET /api/audit/cycles', () => {
  it('lists cycles newest first, with scope size and progress; exactly one is open', async () => {
    const response = await get('/api/audit/cycles')
    expect(response.status).toBe(200)
    const { data } = (await response.json()) as AuditCycleListResponse
    expect(data.map((c) => [c.id, c.name, c.status, c.roomsInScope])).toEqual([
      ['CYC-002', 'Summer 2026', 'Open', 5],
      ['CYC-001', 'Summer 2025', 'Closed', 6],
    ])
    expect(data[0].progress).toEqual(progress(5, 1, 1, 1, 2, 20))
    expect(data.filter((c) => c.status === 'Open').length).toBe(1)
  })

  it('returns one cycle, without its scope list', async () => {
    const { data } = await json<AuditCycleResponse>('/api/audit/cycles/CYC-001')
    expect(data).toMatchObject({ id: 'CYC-001', status: 'Closed', startDate: '2025-06-23', endDate: '2025-08-29', closedAt: '2025-09-05T10:00:00.000Z' })
    expect(data).not.toHaveProperty('scopeRoomIds')
  })

  it('answers an unknown cycle with 404 and a malformed one with 400', async () => {
    await expectError(await get('/api/audit/cycles/CYC-999'), 404, 'NOT_FOUND', 'Cycle CYC-999 was not found.')
    await expectError(await get('/api/audit/cycles/bad%20id'), 400, 'VALIDATION_ERROR', undefined, 'cycleId')
  })

  it('rejects query parameters it does not take', async () => {
    await expectError(await get('/api/audit/cycles?status=Open'), 400, 'VALIDATION_ERROR', undefined, 'status')
  })

  it('works with no cycles at all', async () => {
    const empty = await startTestServer(new InMemoryProjectRepository(fixtureProjects))
    try {
      expect(await (await fetch(`${empty.baseUrl}/api/audit/cycles`)).json()).toEqual({ data: [] })
    } finally {
      await empty.close()
    }
  })
})

describe('GET /api/audit/blocks', () => {
  it('lists the blocks with progress in the OPEN cycle by default, and says which cycle that is', async () => {
    const response = await get('/api/audit/blocks')
    expect(response.status).toBe(200)
    const body = (await response.json()) as AuditBlockListResponse
    expect(body.cycle).toMatchObject({ id: 'CYC-002', name: 'Summer 2026', status: 'Open' })
    expect(body.data.map((b) => [b.id, b.name, b.floorCount, b.roomCount, b.retiredRoomCount])).toEqual([
      ['BLK-001', 'X Block', 2, 4, 1],
      ['BLK-002', 'Y Block', 1, 1, 0],
    ])
    expect(body.data[0].progress).toEqual(progress(4, 1, 1, 1, 1, 25))
    expect(body.summary).toEqual({ blocks: 2, floors: 3, rooms: 5, retiredRooms: 1, progress: progress(5, 1, 1, 1, 2, 20) })
  })

  it('gives the figures of another cycle when asked', async () => {
    const body = await json<AuditBlockListResponse>('/api/audit/blocks?cycle=CYC-001')
    expect(body.cycle?.id).toBe('CYC-001')
    expect(body.data[0].progress).toEqual(progress(5, 3, 0, 1, 1, 60))
    expect(body.summary.progress).toEqual(progress(6, 3, 0, 1, 2, 50))
  })

  it('works on an empty inventory, with no cycle', async () => {
    const empty = await startTestServer(new InMemoryProjectRepository(fixtureProjects))
    try {
      const body = await (await fetch(`${empty.baseUrl}/api/audit/blocks`)).json()
      expect(body).toEqual({ data: [], summary: { blocks: 0, floors: 0, rooms: 0, retiredRooms: 0, progress: progress(0, 0, 0, 0, 0, null) }, cycle: null })
    } finally {
      await empty.close()
    }
  })

  it('rejects an unknown cycle (404), a malformed one (400) and unknown parameters (400)', async () => {
    await expectError(await get('/api/audit/blocks?cycle=CYC-999'), 404, 'NOT_FOUND', 'Cycle CYC-999 was not found.')
    await expectError(await get('/api/audit/blocks?cycle=Summer'), 400, 'VALIDATION_ERROR', undefined, 'cycle')
    await expectError(await get('/api/audit/blocks?year=2026'), 400, 'VALIDATION_ERROR', undefined, 'year')
  })
})

describe('GET /api/audit/blocks/:blockId', () => {
  it('returns the block with its floors and their progress', async () => {
    const body = await json<AuditBlockResponse>('/api/audit/blocks/BLK-001')
    expect(body.data).toMatchObject({ id: 'BLK-001', name: 'X Block', code: 'X', roomCount: 4 })
    expect(body.data.floors.map((f) => [f.id, f.name, f.level, f.roomCount, f.progress.completed, f.progress.inProgress])).toEqual([
      ['FLR-001', 'Ground floor', 0, 2, 1, 0],
      ['FLR-002', 'First floor', 1, 2, 0, 1],
    ])
    expect(body.cycle?.id).toBe('CYC-002')
  })

  it('takes a cycle', async () => {
    const body = await json<AuditBlockResponse>('/api/audit/blocks/BLK-001?cycle=CYC-001')
    expect(body.data.progress).toEqual(progress(5, 3, 0, 1, 1, 60))
  })

  it('answers an unknown block with 404, a malformed reference with 400', async () => {
    await expectError(await get('/api/audit/blocks/BLK-999'), 404, 'NOT_FOUND', 'Block BLK-999 was not found.')
    for (const id of ['BLK%20001', 'x'.repeat(33), 'BLK-001%2Fx']) await expectError(await get(`/api/audit/blocks/${id}`), 400, 'VALIDATION_ERROR', undefined, 'blockId')
  })
})

describe('GET /api/audit/blocks/:blockId/floors[/:floorId]', () => {
  it('lists the floors ground floor first, with room counts and progress', async () => {
    const body = await json<AuditFloorListResponse>('/api/audit/blocks/BLK-001/floors')
    expect(body.data).toEqual([
      { id: 'FLR-001', blockId: 'BLK-001', name: 'Ground floor', level: 0, roomCount: 2, retiredRoomCount: 1, progress: progress(2, 1, 0, 0, 1, 50) },
      { id: 'FLR-002', blockId: 'BLK-001', name: 'First floor', level: 1, roomCount: 2, retiredRoomCount: 0, progress: progress(2, 0, 1, 1, 0, 0) },
    ])
  })

  it('returns one floor, in the cycle asked for', async () => {
    const body = await json<AuditFloorResponse>('/api/audit/blocks/BLK-001/floors/FLR-001?cycle=CYC-001')
    expect(body.data.progress).toEqual(progress(3, 2, 0, 0, 1, 67)) // X003 was in scope in 2025
    expect(body.cycle?.id).toBe('CYC-001')
  })

  it('answers an unknown block or floor, and a floor under the wrong block, with 404', async () => {
    await expectError(await get('/api/audit/blocks/BLK-999/floors'), 404, 'NOT_FOUND', 'Block BLK-999 was not found.')
    await expectError(await get('/api/audit/blocks/BLK-001/floors/FLR-999'), 404, 'NOT_FOUND', 'Floor FLR-999 was not found in block BLK-001.')
    await expectError(await get('/api/audit/blocks/BLK-002/floors/FLR-001'), 404, 'NOT_FOUND', 'Floor FLR-001 was not found in block BLK-002.')
  })

  it('answers a malformed reference with 400', async () => {
    await expectError(await get('/api/audit/blocks/BLK-001/floors/bad%20id'), 400, 'VALIDATION_ERROR', undefined, 'floorId')
  })
})

describe('GET /api/audit/rooms', () => {
  it('lists active rooms of the open cycle by default, with inspection state, paging and the cycle', async () => {
    const response = await get('/api/audit/rooms')
    expect(response.status).toBe(200)
    const body = (await response.json()) as AuditRoomListResponse
    expect(codes(body)).toEqual(['X001', 'X002', 'X101', 'X102', 'Y001'])
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 5, totalPages: 1 })
    expect(body.cycle?.id).toBe('CYC-002')
    expect(body.data.map((r) => r.inspection.status)).toEqual(['Completed', 'Not started', 'In progress', 'Unable to inspect', 'Not started'])
  })

  it('includes the block, floor, equipment counts and the inspection summary of every room', async () => {
    const body = await json<AuditRoomListResponse>('/api/audit/rooms?q=X101')
    expect(body.data).toEqual([
      {
        id: 'ROOM-004', blockId: 'BLK-001', floorId: 'FLR-002', code: 'X101', displayName: 'Computer lab', active: true,
        blockName: 'X Block', blockCode: 'X', floorName: 'First floor', floorLevel: 1, equipmentCount: 3, itemsNeedingReview: 1,
        inspection: {
          status: 'In progress', inScope: true, inspectionId: 'INS-006', inspectorName: 'Test Technician One',
          startedAt: '2026-07-02T09:00:00.000Z', completedAt: null, checkedLines: 2, totalLines: 3, unableReason: null,
        },
      },
    ])
  })

  it('filters by block, floor and status', async () => {
    expect(codes(await json('/api/audit/rooms?block=BLK-002'))).toEqual(['Y001'])
    expect(codes(await json('/api/audit/rooms?floor=FLR-002'))).toEqual(['X101', 'X102'])
    expect(codes(await json('/api/audit/rooms?block=BLK-001&floor=FLR-001'))).toEqual(['X001', 'X002'])
    expect(codes(await json('/api/audit/rooms?status=retired'))).toEqual(['X003'])
    expect(codes(await json('/api/audit/rooms?status=all'))).toEqual(['X001', 'X002', 'X003', 'X101', 'X102', 'Y001'])
  })

  it('filters by inspection state: the "still to inspect" list and each state', async () => {
    expect(codes(await json('/api/audit/rooms?inspection=toInspect'))).toEqual(['X002', 'X101', 'X102', 'Y001'])
    expect(codes(await json('/api/audit/rooms?inspection=completed'))).toEqual(['X001'])
    expect(codes(await json('/api/audit/rooms?inspection=inProgress'))).toEqual(['X101'])
    expect(codes(await json('/api/audit/rooms?inspection=unable'))).toEqual(['X102'])
    expect(codes(await json('/api/audit/rooms?inspection=notStarted'))).toEqual(['X002', 'Y001'])
  })

  it('shows the reason a room could not be inspected', async () => {
    const body = await json<AuditRoomListResponse>('/api/audit/rooms?inspection=unable')
    expect(body.data[0].inspection).toMatchObject({ status: 'Unable to inspect', unableReason: 'Room in use for teaching' })
  })

  it('uses another cycle: a room retired since is still "to inspect" there', async () => {
    const body = await json<AuditRoomListResponse>('/api/audit/rooms?cycle=CYC-001&inspection=toInspect&status=all')
    expect(codes(body)).toEqual(['X003', 'X102', 'Y001'])
    expect(body.cycle?.id).toBe('CYC-001')
  })

  it('combines filters, searches code and name ignoring case, and treats search text literally', async () => {
    expect(codes(await json('/api/audit/rooms?block=BLK-001&floor=FLR-002&q=lab&inspection=toInspect'))).toEqual(['X101', 'X102'])
    expect(codes(await json('/api/audit/rooms?q=SEMINAR'))).toEqual(['X001'])
    for (const q of ['%', '.*', "' OR 1=1 --", '<script>']) expect((await json<AuditRoomListResponse>(`/api/audit/rooms?q=${encodeURIComponent(q)}`)).meta.total).toBe(0)
  })

  it('pages the results', async () => {
    const first = await json<AuditRoomListResponse>('/api/audit/rooms?pageSize=2')
    expect(codes(first)).toEqual(['X001', 'X002'])
    expect(first.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 })
    expect(codes(await json('/api/audit/rooms?pageSize=2&page=3'))).toEqual(['Y001'])
    const beyond = await json<AuditRoomListResponse>('/api/audit/rooms?pageSize=2&page=4')
    expect(beyond.data).toEqual([])
    expect(beyond.meta).toEqual({ page: 4, pageSize: 2, total: 5, totalPages: 3 })
  })

  it('answers an unknown cycle, block or floor with 404, and a floor of another block with 404', async () => {
    await expectError(await get('/api/audit/rooms?cycle=CYC-999'), 404, 'NOT_FOUND', 'Cycle CYC-999 was not found.')
    await expectError(await get('/api/audit/rooms?block=BLK-999'), 404, 'NOT_FOUND', 'Block BLK-999 was not found.')
    await expectError(await get('/api/audit/rooms?floor=FLR-999'), 404, 'NOT_FOUND', 'Floor FLR-999 was not found.')
    await expectError(await get('/api/audit/rooms?block=BLK-002&floor=FLR-001'), 404, 'NOT_FOUND', 'Floor FLR-001 was not found in block BLK-002.')
  })

  describe('validation', () => {
    it.each([
      ['block=FLR-001', 'block'],
      ['floor=BLK-001', 'floor'],
      ['status=Active', 'status'],
      ['cycle=INS-001', 'cycle'],
      ['inspection=Completed', 'inspection'],
      ['inspection=awaiting', 'inspection'],
      ['page=0', 'page'],
      ['page=abc', 'page'],
      ['pageSize=0', 'pageSize'],
      ['pageSize=101', 'pageSize'],
      ['pageSize=1.5', 'pageSize'],
      ['blok=BLK-001', 'blok'],
      ['status=all&status=active', 'status'],
    ])('rejects %s with 400', async (query, field) => {
      await expectError(await get(`/api/audit/rooms?${query}`), 400, 'VALIDATION_ERROR', undefined, field)
    })

    it('rejects search text longer than 100 characters, lists every problem at once, and allows the largest page size', async () => {
      await expectError(await get(`/api/audit/rooms?q=${'x'.repeat(101)}`), 400, 'VALIDATION_ERROR', undefined, 'q')
      await expectError(await get('/api/audit/rooms?block=x&cycle=y&inspection=z&page=0'), 400, 'VALIDATION_ERROR', undefined, 'block', 'cycle', 'inspection', 'page')
      expect((await get('/api/audit/rooms?pageSize=100')).status).toBe(200)
    })
  })
})

describe('GET /api/audit/rooms/:roomId', () => {
  it('returns the room with its equipment, identifiers, flags, and this cycle\'s and the previous answer', async () => {
    const response = await get('/api/audit/rooms/ROOM-004')
    expect(response.status).toBe(200)
    const { data, cycle } = (await response.json()) as AuditRoomResponse
    expect(cycle?.id).toBe('CYC-002')
    expect(data).toMatchObject({ code: 'X101', equipmentCount: 3, itemsNeedingReview: 1, noEquipmentConfirmed: false })
    expect(data.equipment.map((l) => [l.id, l.typeLabel, l.assetTag, l.serialNumber, l.reviewStatus, l.current?.condition ?? null, l.previous?.condition ?? null])).toEqual([
      ['EQP-003', 'Phone', 'AT-003', 'SN-C', 'Confirmed', 'Working', 'Working'],
      ['EQP-004', 'Panel', null, null, 'Confirmed', 'Not checked', 'Working'],
      ['EQP-005', 'Other', null, null, 'Needs review', 'Not working', null],
    ])
  })

  it('gives the panel\'s firmware check with its labels, stored as Working / Not working', async () => {
    const { data } = await json<AuditRoomResponse>('/api/audit/rooms/ROOM-004')
    expect(data.equipment[1].previous?.checks).toEqual([
      { checkId: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update', condition: 'Not working', note: 'Needs update' },
    ])
  })

  it('takes a cycle: the answers of that cycle, and nothing earlier than the first', async () => {
    const { data } = await json<AuditRoomResponse>('/api/audit/rooms/ROOM-004?cycle=CYC-001')
    expect(data.equipment.map((l) => [l.current?.cycleName ?? null, l.previous])).toEqual([['Summer 2025', null], ['Summer 2025', null], [null, null]])
    expect(data.inspection.status).toBe('Completed')
  })

  it('lists only active equipment (a replaced or removed item is history), and a room with none as an empty list', async () => {
    expect((await json<AuditRoomResponse>('/api/audit/rooms/ROOM-005')).data.equipment.map((l) => l.id)).toEqual(['EQP-007'])
    expect((await json<AuditRoomResponse>('/api/audit/rooms/ROOM-006')).data.equipment).toEqual([])
  })

  it('reports the "no equipment" confirmation, or null when there is no inspection', async () => {
    expect((await json<AuditRoomResponse>('/api/audit/rooms/ROOM-002?cycle=CYC-001')).data.noEquipmentConfirmed).toBe(true)
    expect((await json<AuditRoomResponse>('/api/audit/rooms/ROOM-002')).data.noEquipmentConfirmed).toBeNull()
  })

  it('can return a retired room, and answers an unknown one with 404 and a malformed one with 400', async () => {
    expect((await json<AuditRoomResponse>('/api/audit/rooms/ROOM-003')).data.active).toBe(false)
    await expectError(await get('/api/audit/rooms/ROOM-999'), 404, 'NOT_FOUND', 'Room ROOM-999 was not found.')
    await expectError(await get('/api/audit/rooms/bad%20id'), 400, 'VALIDATION_ERROR', undefined, 'roomId')
    await expectError(await get('/api/audit/rooms/ROOM-004?cycle=CYC-999'), 404, 'NOT_FOUND', 'Cycle CYC-999 was not found.')
    await expectError(await get('/api/audit/rooms/ROOM-004?inspection=all'), 400, 'VALIDATION_ERROR', undefined, 'inspection')
  })
})

describe('GET /api/audit/equipment-types', () => {
  it('lists the types in order, with their checks and whether a name is required', async () => {
    const body = await json<EquipmentTypeListResponse>('/api/audit/equipment-types')
    expect(body.data.map((t) => [t.id, t.label, t.order, t.requiresName, t.checks.length])).toEqual([
      ['phone', 'Phone', 1, false, 0],
      ['projector', 'Projector', 2, false, 0],
      ['panel', 'Panel', 3, false, 1],
      ['other', 'Other', 4, true, 0],
    ])
    expect(body.data[2].checks[0]).toEqual({ id: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update' })
  })
})

describe('the audit endpoints are read-only and separate', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s is not available on any audit address', async (method) => {
    for (const path of ['/api/audit/cycles', '/api/audit/cycles/CYC-001', '/api/audit/blocks', '/api/audit/blocks/BLK-001', '/api/audit/rooms', '/api/audit/rooms/ROOM-001', '/api/audit/equipment-types']) {
      expect((await send(method, path)).status, `${method} ${path}`).toBe(404)
    }
  })

  it('an unknown audit address is the standard 404', async () => {
    await expectError(await get('/api/audit/nothing'), 404, 'NOT_FOUND', 'No such API endpoint.')
    await expectError(await get('/api/audit/inspections/INS-001'), 404, 'NOT_FOUND', 'No such API endpoint.')
  })

  it('leaves the project, task and technician endpoints working', async () => {
    for (const path of ['/api/health', '/api/projects', '/api/projects/PRJ-001', '/api/tasks', '/api/technicians']) expect((await get(path)).status).toBe(200)
  })
})

describe('the audit endpoints against the demonstration seed', () => {
  it('serves the seeded inventory and inspections', async () => {
    const seed = buildSeedAudit()
    const seeded = new AuditService(
      new InMemoryBlockRepository(seed.blocks),
      new InMemoryFloorRepository(seed.floors),
      new InMemoryRoomRepository(seed.rooms, seed.floors),
      new InMemoryEquipmentTypeRepository(seed.equipmentTypes),
      new InMemoryEquipmentItemRepository(seed.items),
      new InMemoryCycleRepository(seed.cycles),
      new InMemoryInspectionRepository(seed.inspections),
      new InMemoryTechnicianRepository(seedTechnicians),
    )
    const server = await startTestServer(new InMemoryProjectRepository(fixtureProjects), { audit: seeded })
    try {
      const ask = async <T>(path: string) => (await (await fetch(`${server.baseUrl}${path}`)).json()) as T
      const cycles = await ask<AuditCycleListResponse>('/api/audit/cycles')
      expect(cycles.data.map((c) => [c.name, c.status])).toEqual([['Summer 2027', 'Open'], ['Summer 2026', 'Closed'], ['Summer 2025', 'Closed']])
      const blocks = await ask<AuditBlockListResponse>('/api/audit/blocks')
      expect(blocks.data.map((b) => b.name)).toEqual(['B Block', 'S Block', 'L Block', 'HE', 'IOT', 'T-LVL'])
      expect(blocks.summary.progress).toEqual(progress(65, 0, 0, 0, 65, 0))
      const ground = await ask<AuditRoomListResponse>('/api/audit/rooms?block=BLK-001&floor=FLR-001')
      expect(codes(ground)).toEqual(['B001', 'B002', 'B003', 'B004', 'B005', 'B006'])
      expect((await ask<EquipmentTypeListResponse>('/api/audit/equipment-types')).data).toHaveLength(8)
    } finally {
      await server.close()
    }
  })
})

describe('when something goes wrong', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('answers 500 without leaking details when a repository fails, while unrelated endpoints keep working', async () => {
    const failing: InspectionRepository = {
      listByCycle: () => Promise.reject(new Error('secret-connection-string')),
      listByRoom: () => Promise.reject(new Error('secret-connection-string')),
      findById: () => Promise.reject(new Error('secret-connection-string')),
    }
    const broken = await startTestServer(new InMemoryProjectRepository(fixtureProjects), {
      audit: new AuditService(
        new InMemoryBlockRepository(fixtureBlocks),
        new InMemoryFloorRepository(fixtureFloors),
        new InMemoryRoomRepository(fixtureRooms, fixtureFloors),
        new InMemoryEquipmentTypeRepository(fixtureEquipmentTypes),
        new InMemoryEquipmentItemRepository(fixtureItems),
        new InMemoryCycleRepository(fixtureCycles),
        failing,
        new InMemoryTechnicianRepository(fixtureTechnicians),
      ),
    })
    try {
      for (const path of ['/api/audit/blocks', '/api/audit/cycles', '/api/audit/rooms', '/api/audit/rooms/ROOM-001']) {
        const response = await fetch(`${broken.baseUrl}${path}`)
        const text = await response.text()
        expect(response.status, path).toBe(500)
        expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR')
        expect(text).not.toContain('secret-connection-string')
      }
      expect((await fetch(`${broken.baseUrl}/api/audit/equipment-types`)).status).toBe(200)
      expect((await fetch(`${broken.baseUrl}/api/projects`)).status).toBe(200)
    } finally {
      await broken.close()
    }
  })

  it('still reports bad input as 400, not 500', async () => {
    expect((await get('/api/audit/rooms?status=bogus')).status).toBe(400)
  })

  it('answers a ConflictError with 409 and the standard body (nothing in this stage raises one yet; later stages will)', async () => {
    const conflicting = { listBlocks: () => Promise.reject(new ConflictError('A cycle is already open.')) } as unknown as AuditService
    const server = await startTestServer(new InMemoryProjectRepository(fixtureProjects), { audit: conflicting })
    try {
      const response = await fetch(`${server.baseUrl}/api/audit/blocks`)
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: { code: 'CONFLICT', message: 'A cycle is already open.' } })
    } finally {
      await server.close()
    }
  })

  it('does not treat a conflict as an internal error: nothing is logged as unhandled', async () => {
    const spy = vi.spyOn(console, 'error')
    const conflicting = { listBlocks: () => Promise.reject(new ConflictError('Clash.')) } as unknown as AuditService
    const server = await startTestServer(new InMemoryProjectRepository(fixtureProjects), { audit: conflicting })
    try {
      await fetch(`${server.baseUrl}/api/audit/blocks`)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })
})
