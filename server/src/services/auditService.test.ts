import type { InspectionFilter, RoomStatusFilter } from '@lc-projecthub/shared'
import { describe, expect, it } from 'vitest'
import { buildSeedAudit } from '../data/seedAudit.js'
import { seedTechnicians } from '../data/seedTasks.js'
import { NotFoundError } from '../errors.js'
import {
  InMemoryBlockRepository,
  InMemoryCycleRepository,
  InMemoryEquipmentItemRepository,
  InMemoryEquipmentTypeRepository,
  InMemoryFloorRepository,
  InMemoryInspectionRepository,
  InMemoryRoomRepository,
} from '../repositories/inMemoryAuditRepositories.js'
import { InMemoryTechnicianRepository } from '../repositories/inMemoryTechnicianRepository.js'
import { buildFixtureAuditService, fixtureCycles, fixtureInspections } from '../testing/auditFixtures.js'
import { AuditService } from './auditService.js'

const service = buildFixtureAuditService()
const query: { status: RoomStatusFilter; inspection: InspectionFilter; page: number; pageSize: number } = { status: 'all', inspection: 'all', page: 1, pageSize: 50 }
const codes = (rooms: { code: string }[]) => rooms.map((r) => r.code)
const progress = (scope: number, completed: number, inProgress: number, unableToInspect: number, notStarted: number, percentComplete: number | null) => ({
  scope, completed, inProgress, unableToInspect, notStarted, percentComplete,
})

/* Expected figures are worked out by hand in testing/auditFixtures.ts. */

describe('AuditService: which cycle a request is about', () => {
  it('defaults to the open cycle', async () => {
    expect((await service.listBlocks()).cycle).toMatchObject({ id: 'CYC-002', status: 'Open' })
    expect((await service.listRooms(query)).cycle?.id).toBe('CYC-002')
  })

  it('uses the cycle asked for, whether open or closed', async () => {
    expect((await service.listBlocks('CYC-001')).cycle).toMatchObject({ id: 'CYC-001', status: 'Closed' })
  })

  it('falls back to the most recent cycle when none is open', async () => {
    const closed = buildFixtureAuditService({ cycles: fixtureCycles.map((c) => ({ ...c, status: 'Closed', closedAt: '2026-09-01T00:00:00.000Z' })) })
    expect((await closed.listBlocks()).cycle?.id).toBe('CYC-002')
  })

  it('has no cycle, and no progress, when there are no cycles at all', async () => {
    const none = buildFixtureAuditService({ cycles: [], inspections: [] })
    const blocks = await none.listBlocks()
    expect(blocks.cycle).toBeNull()
    expect(blocks.summary.progress).toEqual(progress(0, 0, 0, 0, 0, null))
    const rooms = await none.listRooms(query)
    expect(rooms.cycle).toBeNull()
    expect(rooms.data[0].inspection).toMatchObject({ status: 'Not started', inScope: false })
    expect((await none.getRoom('ROOM-001')).data.equipment.every((line) => line.current === null && line.previous === null)).toBe(true)
  })

  it('reports an unknown cycle as not found, on every endpoint that takes one', async () => {
    const missing = new NotFoundError('Cycle CYC-999 was not found.')
    await expect(service.getCycle('CYC-999')).rejects.toThrow(missing)
    await expect(service.listBlocks('CYC-999')).rejects.toThrow(missing)
    await expect(service.getBlock('BLK-001', 'CYC-999')).rejects.toThrow(missing)
    await expect(service.listFloors('BLK-001', 'CYC-999')).rejects.toThrow(missing)
    await expect(service.getFloor('BLK-001', 'FLR-001', 'CYC-999')).rejects.toThrow(missing)
    await expect(service.listRooms({ ...query, cycleId: 'CYC-999' })).rejects.toThrow(missing)
    await expect(service.getRoom('ROOM-001', 'CYC-999')).rejects.toThrow(missing)
  })
})

describe('AuditService: cycles', () => {
  it('lists cycles newest first, each with its scope size and progress', async () => {
    const { data } = await service.listCycles()
    expect(data.map((c) => [c.id, c.name, c.status, c.roomsInScope])).toEqual([
      ['CYC-002', 'Summer 2026', 'Open', 5],
      ['CYC-001', 'Summer 2025', 'Closed', 6],
    ])
    expect(data[0].progress).toEqual(progress(5, 1, 1, 1, 2, 20))
    expect(data[1].progress).toEqual(progress(6, 3, 0, 1, 2, 50))
  })

  it('never exposes the scope list itself', async () => {
    const { data } = await service.getCycle('CYC-001')
    expect(Object.keys(data)).not.toContain('scopeRoomIds')
    expect(data).toMatchObject({ id: 'CYC-001', year: 2025, startDate: '2025-06-23', closedAt: '2025-09-05T10:00:00.000Z' })
  })

  it('always divides the scope between the four states (they add up)', async () => {
    for (const { progress: p } of (await service.listCycles()).data) {
      expect(p.completed + p.inProgress + p.unableToInspect + p.notStarted).toBe(p.scope)
    }
  })

  it('reports an unknown cycle as not found', async () => {
    await expect(service.getCycle('CYC-999')).rejects.toThrow('Cycle CYC-999 was not found.')
  })
})

describe('AuditService: blocks and floors', () => {
  it('summarises each block with progress in the open cycle', async () => {
    const { data, summary } = await service.listBlocks()
    expect(data).toEqual([
      { id: 'BLK-001', name: 'X Block', code: 'X', floorCount: 2, roomCount: 4, retiredRoomCount: 1, progress: progress(4, 1, 1, 1, 1, 25) },
      { id: 'BLK-002', name: 'Y Block', code: 'Y', floorCount: 1, roomCount: 1, retiredRoomCount: 0, progress: progress(1, 0, 0, 0, 1, 0) },
    ])
    expect(summary).toEqual({ blocks: 2, floors: 3, rooms: 5, retiredRooms: 1, progress: progress(5, 1, 1, 1, 2, 20) })
  })

  it('gives the figures of a closed cycle when asked, including a room that was retired since', async () => {
    const { data, summary } = await service.listBlocks('CYC-001')
    expect(data[0].progress).toEqual(progress(5, 3, 0, 1, 1, 60)) // X003 was in scope then
    expect(data[1].progress).toEqual(progress(1, 0, 0, 0, 1, 0))
    expect(summary.progress).toEqual(progress(6, 3, 0, 1, 2, 50))
  })

  it('returns a block with its floors, each with progress', async () => {
    const { data } = await service.getBlock('BLK-001')
    expect(data.floors).toEqual([
      { id: 'FLR-001', blockId: 'BLK-001', name: 'Ground floor', level: 0, roomCount: 2, retiredRoomCount: 1, progress: progress(2, 1, 0, 0, 1, 50) },
      { id: 'FLR-002', blockId: 'BLK-001', name: 'First floor', level: 1, roomCount: 2, retiredRoomCount: 0, progress: progress(2, 0, 1, 1, 0, 0) },
    ])
  })

  it('lists and finds floors; a floor of another block is not found in this one', async () => {
    expect((await service.listFloors('BLK-002')).data.map((f) => f.id)).toEqual(['FLR-003'])
    expect((await service.getFloor('BLK-002', 'FLR-003')).data.progress).toEqual(progress(1, 0, 0, 0, 1, 0))
    await expect(service.getFloor('BLK-002', 'FLR-001')).rejects.toThrow('Floor FLR-001 was not found in block BLK-002.')
    await expect(service.getFloor('BLK-001', 'FLR-999')).rejects.toThrow('Floor FLR-999 was not found in block BLK-001.')
  })

  it('reports an unknown block before anything else', async () => {
    await expect(service.getBlock('BLK-999')).rejects.toThrow(new NotFoundError('Block BLK-999 was not found.'))
    await expect(service.listFloors('BLK-999', 'CYC-999')).rejects.toThrow('Block BLK-999 was not found.')
  })
})

describe('AuditService: the room list', () => {
  it('lists rooms in order with the inspection state for the open cycle', async () => {
    const { data, meta } = await service.listRooms({ ...query, status: 'active' })
    expect(codes(data)).toEqual(['X001', 'X002', 'X101', 'X102', 'Y001'])
    expect(meta).toEqual({ page: 1, pageSize: 50, total: 5, totalPages: 1 })
    expect(data.map((r) => r.inspection.status)).toEqual(['Completed', 'Not started', 'In progress', 'Unable to inspect', 'Not started'])
  })

  it('describes a completed inspection: who, when, and how many lines', async () => {
    const { inspection } = (await service.listRooms({ ...query, search: 'X001' })).data[0]
    expect(inspection).toEqual({
      status: 'Completed', inScope: true, inspectionId: 'INS-005', inspectorName: 'Test Technician Two',
      startedAt: '2026-07-01T09:00:00.000Z', completedAt: '2026-07-01T09:20:00.000Z',
      checkedLines: 2, totalLines: 2, unableReason: null,
    })
  })

  it('describes a draft by how much of it is answered', async () => {
    const { inspection } = (await service.listRooms({ ...query, search: 'X101' })).data[0]
    expect(inspection).toMatchObject({ status: 'In progress', inspectionId: 'INS-006', completedAt: null, checkedLines: 2, totalLines: 3, unableReason: null })
  })

  it('gives the reason a room could not be inspected', async () => {
    const { inspection } = (await service.listRooms({ ...query, search: 'X102' })).data[0]
    expect(inspection).toMatchObject({ status: 'Unable to inspect', unableReason: 'Room in use for teaching', completedAt: null, checkedLines: 0, totalLines: 0 })
  })

  it('shows "Not started" for a room with no inspection record, with no inspector', async () => {
    const { inspection } = (await service.listRooms({ ...query, search: 'Y001' })).data[0]
    expect(inspection).toEqual({
      status: 'Not started', inScope: true, inspectionId: null, inspectorName: null, startedAt: null, completedAt: null,
      checkedLines: 0, totalLines: 0, unableReason: null,
    })
  })

  it('counts a room\'s active equipment and the items needing review; replaced and removed items are not counted', async () => {
    const { data } = await service.listRooms(query)
    const by = Object.fromEntries(data.map((r) => [r.code, [r.equipmentCount, r.itemsNeedingReview]]))
    expect(by).toEqual({ X001: [2, 0], X002: [0, 0], X003: [0, 0], X101: [3, 1], X102: [1, 0], Y001: [0, 0] })
  })

  it('selects rooms by inspection state', async () => {
    const pick = async (inspection: typeof query.inspection) => codes((await service.listRooms({ ...query, status: 'active', inspection })).data)
    expect(await pick('completed')).toEqual(['X001'])
    expect(await pick('inProgress')).toEqual(['X101'])
    expect(await pick('unable')).toEqual(['X102'])
    expect(await pick('notStarted')).toEqual(['X002', 'Y001'])
    expect(await pick('toInspect')).toEqual(['X002', 'X101', 'X102', 'Y001'])
    expect(await pick('all')).toEqual(['X001', 'X002', 'X101', 'X102', 'Y001'])
  })

  it('"toInspect" is every in-scope room that is not completed, so the filters add up to the progress figures', async () => {
    const total = (await service.listRooms({ ...query, status: 'active', inspection: 'all' })).meta.total
    const sum = async (filters: (typeof query.inspection)[]) => (await Promise.all(filters.map((f) => service.listRooms({ ...query, status: 'active', inspection: f })))).reduce((n, r) => n + r.meta.total, 0)
    expect(await sum(['completed', 'inProgress', 'unable', 'notStarted'])).toBe(total)
  })

  it('uses another cycle\'s state when asked, and then a retired room that was in scope shows up', async () => {
    const { data } = await service.listRooms({ ...query, cycleId: 'CYC-001', inspection: 'toInspect' })
    expect(codes(data)).toEqual(['X003', 'X102', 'Y001'])
    expect(data.map((r) => r.inspection.status)).toEqual(['Not started', 'Unable to inspect', 'Not started'])
    expect(data[1].inspection.unableReason).toBe('Room locked')
  })

  it('marks a room outside the cycle\'s scope, and never lists it as "to inspect"', async () => {
    const x003 = (await service.listRooms({ ...query, search: 'X003' })).data[0]
    expect(x003.inspection).toMatchObject({ status: 'Not started', inScope: false, inspectionId: null })
    expect(codes((await service.listRooms({ ...query, inspection: 'toInspect' })).data)).not.toContain('X003')
    expect(codes((await service.listRooms({ ...query, inspection: 'notStarted' })).data)).not.toContain('X003')
  })

  it('combines the inspection filter with the other filters and with paging', async () => {
    const floor = await service.listRooms({ ...query, floorId: 'FLR-002', inspection: 'toInspect' })
    expect(codes(floor.data)).toEqual(['X101', 'X102'])
    const paged = await service.listRooms({ ...query, status: 'active', inspection: 'toInspect', pageSize: 3 })
    expect(codes(paged.data)).toEqual(['X002', 'X101', 'X102'])
    expect(paged.meta).toEqual({ page: 1, pageSize: 3, total: 4, totalPages: 2 })
    expect(codes((await service.listRooms({ ...query, status: 'active', inspection: 'toInspect', pageSize: 3, page: 2 })).data)).toEqual(['Y001'])
  })

  it('reports an unknown block or floor, and a floor of another block, as not found', async () => {
    await expect(service.listRooms({ ...query, blockId: 'BLK-999' })).rejects.toThrow('Block BLK-999 was not found.')
    await expect(service.listRooms({ ...query, floorId: 'FLR-999' })).rejects.toThrow('Floor FLR-999 was not found.')
    await expect(service.listRooms({ ...query, blockId: 'BLK-002', floorId: 'FLR-001' })).rejects.toThrow('Floor FLR-001 was not found in block BLK-002.')
  })

  it('names no inspector it cannot find', async () => {
    const strangers = buildFixtureAuditService({ technicians: [] })
    expect((await strangers.listRooms({ ...query, search: 'X001' })).data[0].inspection.inspectorName).toBeNull()
  })
})

describe('AuditService: one room and its equipment', () => {
  it('lists active equipment in checklist order, with identifiers, source and review flag', async () => {
    const { data } = await service.getRoom('ROOM-004')
    expect(data.equipment.map((l) => [l.id, l.typeLabel, l.name, l.assetTag, l.serialNumber, l.source, l.reviewStatus])).toEqual([
      ['EQP-003', 'Phone', '', 'AT-003', 'SN-C', 'Inventory', 'Confirmed'],
      ['EQP-004', 'Panel', '', null, null, 'Inventory', 'Confirmed'],
      ['EQP-005', 'Other', 'Document camera', null, null, 'Found during inspection', 'Needs review'],
    ])
  })

  it('leaves out replaced and removed items, and lists the replacement', async () => {
    expect((await service.getRoom('ROOM-005')).data.equipment.map((l) => l.id)).toEqual(['EQP-007'])
    expect((await service.getRoom('ROOM-006')).data.equipment).toEqual([])
  })

  it('gives each item its answer in this cycle (including Not checked in a draft)', async () => {
    const lines = (await service.getRoom('ROOM-004')).data.equipment
    expect(lines.map((l) => [l.id, l.current?.condition, l.current?.inspectionId, l.current?.cycleName])).toEqual([
      ['EQP-003', 'Working', 'INS-006', 'Summer 2026'],
      ['EQP-004', 'Not checked', 'INS-006', 'Summer 2026'],
      ['EQP-005', 'Not working', 'INS-006', 'Summer 2026'],
    ])
    expect(lines[2].current).toMatchObject({ note: '', checkedAt: '2026-07-02T09:15:00.000Z', inspectorName: 'Test Technician One', corrected: false })
    expect(lines[1].current?.checkedAt).toBeNull()
  })

  it('gives each item its most recent completed answer from an EARLIER cycle', async () => {
    const lines = (await service.getRoom('ROOM-004')).data.equipment
    expect(lines[0].previous).toMatchObject({ inspectionId: 'INS-003', cycleName: 'Summer 2025', condition: 'Working', inspectorName: 'Test Technician Two' })
    expect(lines[2].previous).toBeNull() // found this cycle: no earlier answer
    const x001 = (await service.getRoom('ROOM-001')).data.equipment
    expect(x001[1].previous).toMatchObject({ condition: 'Not working', note: 'Bulb dim' })
    expect(x001[1].current).toMatchObject({ condition: 'Needs replacement', note: 'Beyond repair' })
  })

  it('ignores an inspection that was never completed when looking for the earlier answer', async () => {
    // INS-003 (X101, Summer 2025) becomes an unfinished draft: its answers must not be offered as "last time".
    const drafts = fixtureInspections.map((inspection) =>
      inspection.id === 'INS-003' ? { ...inspection, status: 'In progress' as const, completedAt: null } : inspection,
    )
    const variant = buildFixtureAuditService({ inspections: drafts })
    const lines = (await variant.getRoom('ROOM-004')).data.equipment
    expect(lines[0].previous).toBeNull()
    expect(lines[1].previous).toBeNull()
    expect(lines[0].current?.condition).toBe('Working') // this cycle's own draft is unaffected
  })

  it('shows the checks of an item with their stored answer and their friendly wording', async () => {
    const panel = (await service.getRoom('ROOM-004')).data.equipment[1]
    expect(panel.checks).toEqual([{ id: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update' }])
    expect(panel.previous?.checks).toEqual([
      { checkId: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update', condition: 'Not working', note: 'Needs update' },
    ])
    expect(panel.current?.checks).toEqual([
      { checkId: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update', condition: 'Not checked', note: '' },
    ])
    const phone = (await service.getRoom('ROOM-004')).data.equipment[0]
    expect(phone.checks).toEqual([])
    expect(phone.current?.checks).toEqual([])
  })

  it('shows a room whose inspection could not happen: equipment listed, no answers', async () => {
    const { data } = await service.getRoom('ROOM-005')
    expect(data.inspection).toMatchObject({ status: 'Unable to inspect', unableReason: 'Room in use for teaching' })
    expect(data.equipment[0]).toMatchObject({ id: 'EQP-007', current: null, previous: null })
    expect(data.noEquipmentConfirmed).toBe(false)
  })

  it('reports the "no equipment" confirmation of a room with none, and null when there is no inspection', async () => {
    expect((await service.getRoom('ROOM-002', 'CYC-001')).data).toMatchObject({ equipment: [], noEquipmentConfirmed: true })
    expect((await service.getRoom('ROOM-002')).data.noEquipmentConfirmed).toBeNull()
    expect((await service.getRoom('ROOM-001')).data.noEquipmentConfirmed).toBe(false)
  })

  it('has no earlier answer when the earliest cycle is selected, and shows that cycle\'s own answers', async () => {
    const lines = (await service.getRoom('ROOM-004', 'CYC-001')).data.equipment
    expect(lines.map((l) => l.previous)).toEqual([null, null, null])
    expect(lines[0].current).toMatchObject({ inspectionId: 'INS-003', condition: 'Working' })
    expect(lines[2].current).toBeNull() // the camera was found later
  })

  it('includes a retired room and its inspection state', async () => {
    expect((await service.getRoom('ROOM-003', 'CYC-001')).data).toMatchObject({ code: 'X003', active: false, inspection: { status: 'Not started', inScope: true } })
  })

  it('reports an unknown room as not found', async () => {
    await expect(service.getRoom('ROOM-999')).rejects.toThrow(new NotFoundError('Room ROOM-999 was not found.'))
  })

  it('lists the equipment types, with their checks', async () => {
    const { data } = await service.listEquipmentTypes()
    expect(data.map((t) => t.label)).toEqual(['Phone', 'Projector', 'Panel', 'Other'])
    expect(data[2].checks[0].id).toBe('firmware')
    expect(data[3].requiresName).toBe(true)
  })

  it('marks a corrected answer as corrected', async () => {
    const corrected = fixtureInspections.map((inspection) =>
      inspection.id === 'INS-005'
        ? {
            ...inspection,
            results: inspection.results.map((result) =>
              result.equipmentItemId === 'EQP-001'
                ? { ...result, corrections: [{ from: { condition: 'Working' as const, note: '', checks: [] }, to: { condition: 'Working' as const, note: 'ok', checks: [] }, reason: 'Fixed a typo', changedAt: '2026-07-02T09:00:00.000Z', changedById: 'TECH-001' }] }
                : result,
            ),
          }
        : inspection,
    )
    const variant = buildFixtureAuditService({ inspections: corrected })
    const lines = (await variant.getRoom('ROOM-001')).data.equipment
    expect(lines[0].current?.corrected).toBe(true)
    expect(lines[1].current?.corrected).toBe(false)
  })
})

describe('AuditService: the demonstration seed', () => {
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

  /** Worked out from the raw inspection records, separately from the service. */
  function independent(cycleId: string, roomIds?: string[]) {
    const cycle = seed.cycles.find((c) => c.id === cycleId)!
    const scope = cycle.scopeRoomIds.filter((id) => !roomIds || roomIds.includes(id))
    const records = seed.inspections.filter((i) => i.cycleId === cycleId && scope.includes(i.roomId))
    const completed = records.filter((i) => i.status === 'Completed').length
    return {
      scope: scope.length,
      completed,
      inProgress: records.filter((i) => i.status === 'In progress').length,
      unableToInspect: records.filter((i) => i.status === 'Unable to inspect').length,
      notStarted: scope.length - records.length,
      percentComplete: scope.length === 0 ? null : Math.round((completed / scope.length) * 100),
    }
  }

  it('reports the open cycle by default, and its progress equal to an independent count', async () => {
    const { cycle, summary } = await seeded.listBlocks()
    expect(cycle).toMatchObject({ id: 'CYC-003', name: 'Summer 2027', status: 'Open' })
    expect(summary.progress).toEqual({ scope: 65, completed: 0, inProgress: 0, unableToInspect: 0, notStarted: 65, percentComplete: 0 })
    expect(summary.progress).toEqual(independent('CYC-003'))
  })

  it('reports every cycle\'s progress equal to an independent count', async () => {
    for (const { id, progress: p } of (await seeded.listCycles()).data) expect(p).toEqual(independent(id))
  })

  it('reports every block\'s and floor\'s progress, in every cycle, equal to an independent count', async () => {
    for (const cycle of seed.cycles) {
      for (const block of (await seeded.listBlocks(cycle.id)).data) {
        const rooms = seed.rooms.filter((r) => r.blockId === block.id).map((r) => r.id)
        expect(block.progress, `${cycle.id} ${block.name}`).toEqual(independent(cycle.id, rooms))
        for (const floor of (await seeded.getBlock(block.id, cycle.id)).data.floors) {
          expect(floor.progress, `${cycle.id} ${floor.name}`).toEqual(independent(cycle.id, seed.rooms.filter((r) => r.floorId === floor.id).map((r) => r.id)))
        }
      }
    }
  })

  it('lists every inspection state\'s rooms so that their counts equal the progress figures', async () => {
    const counts = async (inspection: typeof query.inspection) => (await seeded.listRooms({ ...query, status: 'all', inspection })).meta.total
    expect(await counts('completed')).toBe(0)
    expect(await counts('inProgress')).toBe(0)
    expect(await counts('unable')).toBe(0)
    expect(await counts('notStarted')).toBe(65)
    expect(await counts('toInspect')).toBe(65)
  })

  it('shows the equipment of the room with a replaced phone: only the replacement', async () => {
    const b002 = seed.rooms.find((r) => r.code === 'B002')!
    const { data } = await seeded.getRoom(b002.id)
    const phones = data.equipment.filter((l) => l.typeLabel === 'Phone')
    expect(phones.length).toBe(1)
    expect(phones[0]).toMatchObject({ assetTag: 'AT-90001', previous: null })
  })

  it('shows the equipment found in a Summer 2026 inspection, still flagged for review, with that answer as "last time"', async () => {
    const b103 = seed.rooms.find((r) => r.code === 'B103')!
    const { data } = await seeded.getRoom(b103.id)
    expect(data.itemsNeedingReview).toBe(1)
    const camera = data.equipment.find((l) => l.name === 'Document camera')!
    expect(camera).toMatchObject({ source: 'Found during inspection', reviewStatus: 'Needs review', current: null })
    expect(camera.previous).toMatchObject({ cycleName: 'Summer 2026' })
  })

  it('has no inspection activity in the open cycle: every room is Not started, in scope, with no inspector or lines', async () => {
    const { data, meta } = await seeded.listRooms({ ...query, status: 'active' })
    expect(meta.total).toBe(65)
    for (const room of data) {
      expect(room.inspection).toEqual({
        status: 'Not started', inScope: true, inspectionId: null, inspectorName: null, startedAt: null, completedAt: null,
        checkedLines: 0, totalLines: 0, unableReason: null,
      })
    }
  })

  it('gives no room an answer in the open cycle, but shows last time\'s answer from the most recent completed cycle', async () => {
    const b001 = seed.rooms.find((r) => r.code === 'B001')!
    const { data } = await seeded.getRoom(b001.id)
    expect(data.inspection.status).toBe('Not started')
    expect(data.equipment.length).toBeGreaterThan(0)
    for (const line of data.equipment) {
      expect(line.current).toBeNull()
      expect(line.previous?.cycleName).toBe('Summer 2026')
    }
  })

  it('falls back to Summer 2025 when a room could not be inspected in Summer 2026', async () => {
    const b104 = seed.rooms.find((r) => r.code === 'B104')! // unable to inspect in 2026, completed in 2025
    const { data } = await seeded.getRoom(b104.id)
    for (const line of data.equipment) expect(line.previous?.cycleName).toBe('Summer 2025')
  })
})
