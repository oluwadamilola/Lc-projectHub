import { beforeEach, describe, expect, it } from 'vitest'
import {
  fixtureBlocks,
  fixtureCycles,
  fixtureEquipmentTypes,
  fixtureFloors,
  fixtureInspections,
  fixtureItems,
  fixtureRooms,
} from '../testing/auditFixtures.js'
import {
  InMemoryBlockRepository,
  InMemoryCycleRepository,
  InMemoryEquipmentItemRepository,
  InMemoryEquipmentTypeRepository,
  InMemoryFloorRepository,
  InMemoryInspectionRepository,
  InMemoryRoomRepository,
} from './inMemoryAuditRepositories.js'

const codes = (rooms: { code: string }[]) => rooms.map((room) => room.code)
const all = { status: 'all' as const, page: 1, pageSize: 50 }

describe('InMemoryBlockRepository', () => {
  it('lists blocks in order and finds one by reference', async () => {
    const repo = new InMemoryBlockRepository([...fixtureBlocks].reverse())
    expect((await repo.list()).map((block) => block.id)).toEqual(['BLK-001', 'BLK-002'])
    expect(await repo.findById('BLK-002')).toEqual(fixtureBlocks[1])
    expect(await repo.findById('BLK-999')).toBeNull()
  })

  it('copies data in and out', async () => {
    const source = fixtureBlocks.map((block) => ({ ...block }))
    const repo = new InMemoryBlockRepository(source)
    source[0].name = 'Changed after construction'
    const listed = await repo.list()
    expect(listed[0].name).toBe('X Block')
    listed[0].name = 'Changed after listing'
    ;(await repo.findById('BLK-001'))!.name = 'Changed after find'
    expect((await repo.list())[0].name).toBe('X Block')
  })
})

describe('InMemoryFloorRepository', () => {
  it('lists floors by block and then level, whatever order they were given in', async () => {
    const repo = new InMemoryFloorRepository([...fixtureFloors].reverse())
    expect((await repo.list()).map((floor) => floor.id)).toEqual(['FLR-001', 'FLR-002', 'FLR-003'])
  })

  it('finds a floor by reference, or null, and returns copies', async () => {
    const repo = new InMemoryFloorRepository(fixtureFloors)
    expect((await repo.findById('FLR-003'))?.blockId).toBe('BLK-002')
    expect(await repo.findById('FLR-999')).toBeNull()
    ;(await repo.list())[0].name = 'Changed'
    expect(await repo.findById('FLR-001')).toEqual(fixtureFloors[0])
  })
})

describe('InMemoryRoomRepository', () => {
  let repo: InMemoryRoomRepository
  beforeEach(() => {
    repo = new InMemoryRoomRepository(fixtureRooms, fixtureFloors)
  })

  it('orders rooms by block, then floor level, then code', async () => {
    expect(codes((await repo.list(all)).items)).toEqual(['X001', 'X002', 'X003', 'X101', 'X102', 'Y001'])
  })

  it('puts a higher floor after a lower one even when the references say otherwise', async () => {
    const floors = [
      { id: 'FLR-001', blockId: 'BLK-001', name: 'First floor', level: 1 },
      { id: 'FLR-002', blockId: 'BLK-001', name: 'Ground floor', level: 0 },
    ]
    const rooms = [
      { id: 'ROOM-001', blockId: 'BLK-001', floorId: 'FLR-001', code: 'X101', displayName: '', active: true },
      { id: 'ROOM-002', blockId: 'BLK-001', floorId: 'FLR-002', code: 'X001', displayName: '', active: true },
    ]
    expect(codes(await new InMemoryRoomRepository(rooms, floors).listAll())).toEqual(['X001', 'X101'])
  })

  it('orders codes naturally', async () => {
    const rooms = ['X010', 'X002', 'X100'].map((code, index) => ({ id: `ROOM-00${index + 1}`, blockId: 'BLK-001', floorId: 'FLR-001', code, displayName: '', active: true }))
    expect(codes(await new InMemoryRoomRepository(rooms, fixtureFloors).listAll())).toEqual(['X002', 'X010', 'X100'])
  })

  it('shows only active rooms for "active", only retired for "retired", and everything for "all"', async () => {
    expect(codes((await repo.list({ ...all, status: 'active' })).items)).toEqual(['X001', 'X002', 'X101', 'X102', 'Y001'])
    expect(codes((await repo.list({ ...all, status: 'retired' })).items)).toEqual(['X003'])
    expect((await repo.list({ ...all, status: 'all' })).total).toBe(6)
  })

  it('filters by block and by floor', async () => {
    expect(codes((await repo.list({ ...all, blockId: 'BLK-002' })).items)).toEqual(['Y001'])
    expect(codes((await repo.list({ ...all, floorId: 'FLR-002' })).items)).toEqual(['X101', 'X102'])
    expect((await repo.list({ ...all, blockId: 'BLK-002', floorId: 'FLR-002' })).total).toBe(0)
  })

  it('restricts the list to the rooms given (how the service applies an inspection filter)', async () => {
    expect(codes((await repo.list({ ...all, roomIds: ['ROOM-004', 'ROOM-002', 'ROOM-999'] })).items)).toEqual(['X002', 'X101'])
    expect((await repo.list({ ...all, roomIds: [] })).total).toBe(0)
    expect(codes((await repo.list({ ...all, roomIds: ['ROOM-001', 'ROOM-004'], floorId: 'FLR-002' })).items)).toEqual(['X101'])
  })

  it('searches the code and the name, ignoring case and surrounding spaces, and nothing else', async () => {
    expect(codes((await repo.list({ ...all, search: 'x10' })).items)).toEqual(['X101', 'X102'])
    expect(codes((await repo.list({ ...all, search: ' COMPUTER ' })).items)).toEqual(['X101', 'X102'])
    expect((await repo.list({ ...all, search: 'ROOM-001' })).total).toBe(0)
    expect((await repo.list({ ...all, search: 'x block' })).total).toBe(0)
  })

  it('pages the results and reports the total ignoring paging', async () => {
    const first = await repo.list({ ...all, pageSize: 4 })
    expect(codes(first.items)).toEqual(['X001', 'X002', 'X003', 'X101'])
    expect(first.total).toBe(6)
    expect(codes((await repo.list({ ...all, pageSize: 4, page: 2 })).items)).toEqual(['X102', 'Y001'])
    expect(await repo.list({ ...all, pageSize: 4, page: 3 })).toEqual({ items: [], total: 6 })
  })

  it('finds a room by reference, or null, and copies data in and out', async () => {
    expect((await repo.findById('ROOM-004'))?.code).toBe('X101')
    expect(await repo.findById('ROOM-999')).toBeNull()
    const source = fixtureRooms.map((room) => ({ ...room }))
    const copy = new InMemoryRoomRepository(source, fixtureFloors)
    source[0].code = 'CHANGED'
    ;(await copy.list(all)).items[0].code = 'CHANGED'
    ;(await copy.listAll())[0].active = false
    ;(await copy.findById('ROOM-001'))!.displayName = 'CHANGED'
    expect(await copy.findById('ROOM-001')).toEqual(fixtureRooms[0])
  })
})

describe('InMemoryEquipmentTypeRepository', () => {
  it('lists types in display order and finds one by id', async () => {
    const repo = new InMemoryEquipmentTypeRepository([...fixtureEquipmentTypes].reverse())
    expect((await repo.list()).map((type) => type.id)).toEqual(['phone', 'projector', 'panel', 'other'])
    expect((await repo.findById('other'))?.requiresName).toBe(true)
    expect(await repo.findById('nope')).toBeNull()
  })

  it('copies the checks too, not just the type', async () => {
    const repo = new InMemoryEquipmentTypeRepository(fixtureEquipmentTypes)
    const listed = await repo.list()
    listed[2].checks[0].label = 'Changed'
    listed[2].checks.push({ id: 'x', label: 'x', okLabel: 'x', notOkLabel: 'x' })
    ;(await repo.findById('panel'))!.checks[0].okLabel = 'Changed'
    expect((await repo.findById('panel'))!.checks).toEqual([{ id: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update' }])
  })
})

describe('InMemoryEquipmentItemRepository', () => {
  it('lists every item of every status in reference order, and finds one by reference', async () => {
    const repo = new InMemoryEquipmentItemRepository([...fixtureItems].reverse())
    const items = await repo.listAll()
    expect(items.map((item) => item.id)).toEqual(['EQP-001', 'EQP-002', 'EQP-003', 'EQP-004', 'EQP-005', 'EQP-006', 'EQP-007', 'EQP-008'])
    expect(items.map((item) => item.status)).toEqual(['Active', 'Active', 'Active', 'Active', 'Active', 'Replaced', 'Active', 'Removed'])
    expect((await repo.findById('EQP-007'))?.replacesItemId).toBe('EQP-006')
    expect(await repo.findById('EQP-999')).toBeNull()
  })

  it('copies data in and out', async () => {
    const source = fixtureItems.map((item) => ({ ...item }))
    const repo = new InMemoryEquipmentItemRepository(source)
    source[0].assetTag = 'CHANGED'
    ;(await repo.listAll())[0].name = 'CHANGED'
    ;(await repo.findById('EQP-001'))!.status = 'Removed'
    expect(await repo.findById('EQP-001')).toEqual(fixtureItems[0])
  })
})

describe('InMemoryCycleRepository', () => {
  it('lists cycles oldest first, whatever order they were given in, and finds one by reference', async () => {
    const repo = new InMemoryCycleRepository([...fixtureCycles].reverse())
    expect((await repo.list()).map((cycle) => cycle.id)).toEqual(['CYC-001', 'CYC-002'])
    expect((await repo.findById('CYC-002'))?.status).toBe('Open')
    expect(await repo.findById('CYC-999')).toBeNull()
  })

  it('keeps a cycle\'s scope fixed: nobody can change it through what they were handed', async () => {
    const source = fixtureCycles.map((cycle) => ({ ...cycle, scopeRoomIds: [...cycle.scopeRoomIds] }))
    const repo = new InMemoryCycleRepository(source)
    source[0].scopeRoomIds.push('ROOM-999')
    ;(await repo.list())[0].scopeRoomIds.length = 0
    ;(await repo.findById('CYC-001'))!.scopeRoomIds.push('ROOM-998')
    expect((await repo.findById('CYC-001'))!.scopeRoomIds).toEqual(fixtureCycles[0].scopeRoomIds)
  })
})

describe('InMemoryInspectionRepository', () => {
  let repo: InMemoryInspectionRepository
  beforeEach(() => {
    repo = new InMemoryInspectionRepository(fixtureInspections)
  })

  it('lists a cycle\'s inspections, or a room\'s inspections across cycles', async () => {
    expect((await repo.listByCycle('CYC-001')).map((i) => i.id)).toEqual(['INS-001', 'INS-002', 'INS-003', 'INS-004'])
    expect((await repo.listByCycle('CYC-002')).map((i) => i.id)).toEqual(['INS-005', 'INS-006', 'INS-007'])
    expect((await repo.listByRoom('ROOM-001')).map((i) => i.id)).toEqual(['INS-001', 'INS-005'])
    expect(await repo.listByCycle('CYC-999')).toEqual([])
    expect(await repo.listByRoom('ROOM-006')).toEqual([])
  })

  it('finds an inspection, with its result lines, by reference', async () => {
    const found = (await repo.findById('INS-006'))!
    expect(found.status).toBe('In progress')
    expect(found.results.map((r) => [r.equipmentItemId, r.condition])).toEqual([
      ['EQP-003', 'Working'],
      ['EQP-004', 'Not checked'],
      ['EQP-005', 'Not working'],
    ])
    expect(await repo.findById('INS-999')).toBeNull()
  })

  it('copies the whole record on the way in and out, including lines, checks and attempts', async () => {
    const source = fixtureInspections.map((i) => JSON.parse(JSON.stringify(i)))
    const copy = new InMemoryInspectionRepository(source)
    source[2].results[1].checks[0].note = 'CHANGED'
    source[3].attempts[0].reason = 'CHANGED'
    source[0].results[0].snapshot.name = 'CHANGED'

    const listed = await copy.listByCycle('CYC-001')
    listed[2].results[1].checks[0].condition = 'Working'
    listed[3].attempts.push({ at: 'x', byId: 'x', reason: 'x' })
    listed[0].results[0].corrections.push({ from: { condition: 'Working', note: '', checks: [] }, to: { condition: 'Working', note: '', checks: [] }, reason: 'x', changedAt: 'x', changedById: 'x' })
    ;(await copy.findById('INS-001'))!.results.length = 0

    expect(await copy.listByCycle('CYC-001')).toEqual(fixtureInspections.filter((i) => i.cycleId === 'CYC-001'))
  })
})
