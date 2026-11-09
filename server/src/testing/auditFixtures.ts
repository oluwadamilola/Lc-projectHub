import type { Block, EquipmentItem, EquipmentType, Floor, InspectionResult, Room } from '@lc-projecthub/shared'
import { NOT_CHECKED } from '@lc-projecthub/shared'
import type { InspectionCycleRecord, InspectionRecord, InspectionRepository } from '../domain/auditRepository.js'
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
import { AuditService } from '../services/auditService.js'
import { InspectionService } from '../services/inspectionService.js'
import { fixtureTechnicians } from './taskFixtures.js'

/*
  A tiny, fixed, fictional inventory so audit tests do not depend on the demo seed, and so the expected figures
  can be worked out by hand.

    X Block (BLK-001)  Ground floor (FLR-001): X001, X002, X003 (retired)    First floor (FLR-002): X101, X102
    Y Block (BLK-002)  Ground floor (FLR-003): Y001

  Equipment (types: phone, projector, panel with a firmware check, other):
    X001  EQP-001 phone, EQP-002 projector          X101  EQP-003 phone, EQP-004 panel, EQP-005 "Document camera"
    X102  EQP-006 phone (REPLACED), EQP-007 phone   Y001  EQP-008 projector (REMOVED)
    X002 and X003 have none. EQP-005 was found during an inspection and needs review.

  Cycles: CYC-001 "Summer 2025" (closed, scope: all six rooms), CYC-002 "Summer 2026" (OPEN, scope: the five
  active rooms).

  Inspections (TECH-001 is "Test Technician One", TECH-002 is "Test Technician Two"):
    CYC-001  INS-001 X001 completed   INS-002 X002 completed (no equipment confirmed)   INS-003 X101 completed
             INS-004 X102 unable to inspect.   X003 and Y001: not started.
    CYC-002  INS-005 X001 completed   INS-006 X101 in progress (2 of 3 lines answered)
             INS-007 X102 unable to inspect.   X002 and Y001: not started.

  By hand:
    CYC-001 progress  scope 6: completed 3, in progress 0, unable 1, not started 2 (50%).
    CYC-002 progress  scope 5: completed 1, in progress 1, unable 1, not started 2 (20%).
    CYC-002 by block  X: scope 4 (completed 1, in progress 1, unable 1, not started 1 = 25%)   Y: scope 1 (not started 1 = 0%).
    CYC-002 by floor  FLR-001 scope 2 (1 completed, 1 not started = 50%)   FLR-002 scope 2 (1 in progress, 1 unable = 0%)
                      FLR-003 scope 1 (not started = 0%).
*/

export const fixtureBlocks: Block[] = [
  { id: 'BLK-001', name: 'X Block', code: 'X' },
  { id: 'BLK-002', name: 'Y Block', code: 'Y' },
]

export const fixtureFloors: Floor[] = [
  { id: 'FLR-001', blockId: 'BLK-001', name: 'Ground floor', level: 0 },
  { id: 'FLR-002', blockId: 'BLK-001', name: 'First floor', level: 1 },
  { id: 'FLR-003', blockId: 'BLK-002', name: 'Ground floor', level: 0 },
]

export const fixtureRooms: Room[] = [
  { id: 'ROOM-001', blockId: 'BLK-001', floorId: 'FLR-001', code: 'X001', displayName: 'Seminar room', active: true },
  { id: 'ROOM-002', blockId: 'BLK-001', floorId: 'FLR-001', code: 'X002', displayName: '', active: true },
  { id: 'ROOM-003', blockId: 'BLK-001', floorId: 'FLR-001', code: 'X003', displayName: 'Old store', active: false },
  { id: 'ROOM-004', blockId: 'BLK-001', floorId: 'FLR-002', code: 'X101', displayName: 'Computer lab', active: true },
  { id: 'ROOM-005', blockId: 'BLK-001', floorId: 'FLR-002', code: 'X102', displayName: 'Computer lab', active: true },
  { id: 'ROOM-006', blockId: 'BLK-002', floorId: 'FLR-003', code: 'Y001', displayName: 'Workshop', active: true },
]

export const fixtureEquipmentTypes: EquipmentType[] = [
  { id: 'phone', label: 'Phone', order: 1, requiresName: false, checks: [] },
  { id: 'projector', label: 'Projector', order: 2, requiresName: false, checks: [] },
  {
    id: 'panel',
    label: 'Panel',
    order: 3,
    requiresName: false,
    checks: [{ id: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update' }],
  },
  { id: 'other', label: 'Other', order: 4, requiresName: true, checks: [] },
]

const item = (id: string, roomId: string, equipmentTypeId: string, extra: Partial<EquipmentItem> = {}): EquipmentItem => ({
  id,
  roomId,
  equipmentTypeId,
  name: '',
  assetTag: null,
  serialNumber: null,
  status: 'Active',
  source: 'Inventory',
  reviewStatus: 'Confirmed',
  addedInInspectionId: null,
  replacesItemId: null,
  ...extra,
})

export const fixtureItems: EquipmentItem[] = [
  item('EQP-001', 'ROOM-001', 'phone', { assetTag: 'AT-001' }),
  item('EQP-002', 'ROOM-001', 'projector', { serialNumber: 'SN-A' }),
  item('EQP-003', 'ROOM-004', 'phone', { assetTag: 'AT-003', serialNumber: 'SN-C' }),
  item('EQP-004', 'ROOM-004', 'panel'),
  item('EQP-005', 'ROOM-004', 'other', { name: 'Document camera', source: 'Found during inspection', reviewStatus: 'Needs review', addedInInspectionId: 'INS-006' }),
  item('EQP-006', 'ROOM-005', 'phone', { status: 'Replaced' }),
  item('EQP-007', 'ROOM-005', 'phone', { replacesItemId: 'EQP-006', assetTag: 'AT-007' }),
  item('EQP-008', 'ROOM-006', 'projector', { status: 'Removed' }),
]

export const fixtureCycles: InspectionCycleRecord[] = [
  {
    id: 'CYC-001', name: 'Summer 2025', year: 2025, status: 'Closed', startDate: '2025-06-23', endDate: '2025-08-29',
    closedAt: '2025-09-05T10:00:00.000Z', scopeRoomIds: ['ROOM-001', 'ROOM-002', 'ROOM-003', 'ROOM-004', 'ROOM-005', 'ROOM-006'],
  },
  {
    id: 'CYC-002', name: 'Summer 2026', year: 2026, status: 'Open', startDate: '2026-06-22', endDate: '2026-08-28',
    closedAt: null, scopeRoomIds: ['ROOM-001', 'ROOM-002', 'ROOM-004', 'ROOM-005', 'ROOM-006'],
  },
]

const snapshotOf = (itemId: string) => {
  const source = fixtureItems.find((candidate) => candidate.id === itemId)!
  const type = fixtureEquipmentTypes.find((candidate) => candidate.id === source.equipmentTypeId)!
  return { equipmentTypeId: type.id, equipmentTypeLabel: type.label, name: source.name, assetTag: source.assetTag, serialNumber: source.serialNumber }
}

const line = (
  inspectionId: string,
  equipmentItemId: string,
  condition: InspectionResult['condition'],
  note: string,
  checkedAt: string | null,
  checks: InspectionResult['checks'] = [],
): InspectionResult => ({ inspectionId, equipmentItemId, condition, note, checks, checkedAt, snapshot: snapshotOf(equipmentItemId), corrections: [] })

const inspection = (id: string, cycleId: string, roomId: string, inspectorId: string, extra: Partial<InspectionRecord>): InspectionRecord => ({
  id,
  cycleId,
  roomId,
  status: 'Completed',
  inspectorId,
  startedAt: '2025-07-01T09:00:00.000Z',
  completedAt: '2025-07-01T09:20:00.000Z',
  note: '',
  noEquipmentConfirmed: false,
  attempts: [],
  results: [],
  ...extra,
})

export const fixtureInspections: InspectionRecord[] = [
  inspection('INS-001', 'CYC-001', 'ROOM-001', 'TECH-001', {
    results: [
      line('INS-001', 'EQP-001', 'Working', '', '2025-07-01T09:05:00.000Z'),
      line('INS-001', 'EQP-002', 'Not working', 'Bulb dim', '2025-07-01T09:10:00.000Z'),
    ],
  }),
  inspection('INS-002', 'CYC-001', 'ROOM-002', 'TECH-001', { startedAt: '2025-07-01T10:00:00.000Z', completedAt: '2025-07-01T10:05:00.000Z', noEquipmentConfirmed: true }),
  inspection('INS-003', 'CYC-001', 'ROOM-004', 'TECH-002', {
    startedAt: '2025-07-02T09:00:00.000Z',
    completedAt: '2025-07-02T09:30:00.000Z',
    results: [
      line('INS-003', 'EQP-003', 'Working', '', '2025-07-02T09:05:00.000Z'),
      line('INS-003', 'EQP-004', 'Working', '', '2025-07-02T09:10:00.000Z', [{ checkId: 'firmware', condition: 'Not working', note: 'Needs update' }]),
    ],
  }),
  inspection('INS-004', 'CYC-001', 'ROOM-005', 'TECH-002', {
    status: 'Unable to inspect',
    startedAt: '2025-07-02T11:00:00.000Z',
    completedAt: null,
    attempts: [{ at: '2025-07-02T11:00:00.000Z', byId: 'TECH-002', reason: 'Room locked' }],
  }),
  inspection('INS-005', 'CYC-002', 'ROOM-001', 'TECH-002', {
    startedAt: '2026-07-01T09:00:00.000Z',
    completedAt: '2026-07-01T09:20:00.000Z',
    results: [
      line('INS-005', 'EQP-001', 'Working', '', '2026-07-01T09:05:00.000Z'),
      line('INS-005', 'EQP-002', 'Needs replacement', 'Beyond repair', '2026-07-01T09:10:00.000Z'),
    ],
  }),
  inspection('INS-006', 'CYC-002', 'ROOM-004', 'TECH-001', {
    status: 'In progress',
    startedAt: '2026-07-02T09:00:00.000Z',
    completedAt: null,
    results: [
      line('INS-006', 'EQP-003', 'Working', '', '2026-07-02T09:05:00.000Z'),
      line('INS-006', 'EQP-004', NOT_CHECKED, '', null, [{ checkId: 'firmware', condition: NOT_CHECKED, note: '' }]),
      line('INS-006', 'EQP-005', 'Not working', '', '2026-07-02T09:15:00.000Z'),
    ],
  }),
  inspection('INS-007', 'CYC-002', 'ROOM-005', 'TECH-001', {
    status: 'Unable to inspect',
    startedAt: '2026-07-02T11:00:00.000Z',
    completedAt: null,
    attempts: [{ at: '2026-07-02T11:00:00.000Z', byId: 'TECH-001', reason: 'Room in use for teaching' }],
  }),
]

/** The service over the fixture data, or over a variation of it. */
export function buildFixtureAuditService(
  overrides: { cycles?: InspectionCycleRecord[]; inspections?: InspectionRecord[]; technicians?: typeof fixtureTechnicians } = {},
): AuditService {
  return new AuditService(
    new InMemoryBlockRepository(fixtureBlocks),
    new InMemoryFloorRepository(fixtureFloors),
    new InMemoryRoomRepository(fixtureRooms, fixtureFloors),
    new InMemoryEquipmentTypeRepository(fixtureEquipmentTypes),
    new InMemoryEquipmentItemRepository(fixtureItems),
    new InMemoryCycleRepository(overrides.cycles ?? fixtureCycles),
    new InMemoryInspectionRepository(overrides.inspections ?? fixtureInspections),
    new InMemoryTechnicianRepository(overrides.technicians ?? fixtureTechnicians),
  )
}

/**
 * The read and write services over ONE set of fixture repositories, with a clock that starts at a fixed moment
 * and moves on one minute with every reading, so timestamps are predictable and always increase. The repositories
 * are returned too, for tests that look behind the API or swap one for a failing stand-in.
 */
export function buildFixtureAudit(
  overrides: { cycles?: InspectionCycleRecord[]; inspections?: InspectionRecord[]; items?: EquipmentItem[]; wrapInspections?: (repository: InMemoryInspectionRepository) => InspectionRepository; clock?: () => Date } = {},
) {
  const blocks = new InMemoryBlockRepository(fixtureBlocks)
  const floors = new InMemoryFloorRepository(fixtureFloors)
  const rooms = new InMemoryRoomRepository(fixtureRooms, fixtureFloors)
  const types = new InMemoryEquipmentTypeRepository(fixtureEquipmentTypes)
  const items = new InMemoryEquipmentItemRepository(overrides.items ?? fixtureItems)
  const cycles = new InMemoryCycleRepository(overrides.cycles ?? fixtureCycles)
  const inMemoryInspections = new InMemoryInspectionRepository(overrides.inspections ?? fixtureInspections)
  const inspectionsRepository = overrides.wrapInspections ? overrides.wrapInspections(inMemoryInspections) : inMemoryInspections
  const technicians = new InMemoryTechnicianRepository(fixtureTechnicians)
  let minute = 0
  const clock = overrides.clock ?? (() => new Date(Date.UTC(2026, 7, 3, 10, minute++, 0)))
  return {
    audit: new AuditService(blocks, floors, rooms, types, items, cycles, inspectionsRepository, technicians),
    inspections: new InspectionService(blocks, floors, rooms, types, items, cycles, inspectionsRepository, technicians, clock),
    repositories: { items, cycles, inspections: inspectionsRepository, rooms },
  }
}
