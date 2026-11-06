import type {
  AuditBlockListResponse,
  AuditBlockResponse,
  AuditCycleListResponse,
  AuditRoomListResponse,
  AuditRoomResponse,
  CycleProgress,
  CycleSummary,
  EquipmentLine,
  FloorSummary,
  InspectionCycle,
  ResultSummary,
  RoomDetail,
  RoomInspectionSummary,
  RoomListItem,
} from '@lc-projecthub/shared'

/** Fictional audit data for UI tests. */

export const progress = (completed: number, inProgress: number, unable: number, notStarted: number): CycleProgress => {
  const scope = completed + inProgress + unable + notStarted
  return { scope, completed, inProgress, unableToInspect: unable, notStarted, percentComplete: scope === 0 ? null : Math.round((completed / scope) * 100) }
}

export const openCycle: InspectionCycle = { id: 'CYC-003', name: 'Summer 2027', year: 2027, status: 'Open', startDate: '2027-06-21', endDate: '2027-08-27', closedAt: null }
export const closedCycle: InspectionCycle = {
  id: 'CYC-002',
  name: 'Summer 2026',
  year: 2026,
  status: 'Closed',
  startDate: '2026-06-22',
  endDate: '2026-08-28',
  closedAt: '2026-09-04T09:30:00.000Z',
}
const cycleSummary = (cycle: InspectionCycle, p: CycleProgress): CycleSummary => ({ ...cycle, roomsInScope: p.scope, progress: p })
export const cycleList: AuditCycleListResponse = {
  data: [cycleSummary(openCycle, progress(0, 0, 0, 25)), cycleSummary(closedCycle, progress(20, 0, 2, 3))],
}

/* ---- Blocks ---- */

const floorOne: FloorSummary = { id: 'FLR-001', blockId: 'BLK-001', name: 'Ground floor', level: 0, roomCount: 6, retiredRoomCount: 0, progress: progress(0, 0, 0, 6) }
const floorTwo: FloorSummary = { id: 'FLR-002', blockId: 'BLK-001', name: 'First floor', level: 1, roomCount: 9, retiredRoomCount: 1, progress: progress(0, 0, 0, 9) }

export const blockB = {
  id: 'BLK-001',
  name: 'B Block',
  code: 'B',
  floorCount: 2,
  roomCount: 15,
  retiredRoomCount: 1,
  progress: progress(0, 0, 0, 15),
}
export const blockS = { id: 'BLK-002', name: 'S Block', code: 'S', floorCount: 1, roomCount: 10, retiredRoomCount: 0, progress: progress(0, 0, 0, 10) }
export const blockEmpty = { id: 'BLK-005', name: 'IOT', code: 'IOT', floorCount: 1, roomCount: 0, retiredRoomCount: 0, progress: progress(0, 0, 0, 0) }

export const blockList: AuditBlockListResponse = {
  data: [blockB, blockS, blockEmpty],
  summary: { blocks: 3, floors: 4, rooms: 25, retiredRooms: 1, progress: progress(0, 0, 0, 25) },
  cycle: openCycle,
}

/** The same blocks, seen in a closed cycle where work was done. */
export const blockListClosed: AuditBlockListResponse = {
  data: [
    { ...blockB, progress: progress(10, 0, 2, 3) },
    { ...blockS, progress: progress(10, 0, 0, 0) },
    blockEmpty,
  ],
  summary: { blocks: 3, floors: 4, rooms: 25, retiredRooms: 1, progress: progress(20, 0, 2, 3) },
  cycle: closedCycle,
}

export const blockDetailB: AuditBlockResponse = { data: { ...blockB, floors: [floorOne, floorTwo] }, cycle: openCycle }

/* ---- Rooms ---- */

const notStarted: RoomInspectionSummary = {
  status: 'Not started',
  inScope: true,
  inspectionId: null,
  inspectorName: null,
  startedAt: null,
  completedAt: null,
  checkedLines: 0,
  totalLines: 0,
  unableReason: null,
}

const roomBase = { blockId: 'BLK-001', blockName: 'B Block', blockCode: 'B', floorId: 'FLR-001', floorName: 'Ground floor', floorLevel: 0 }

export const roomB001: RoomListItem = { ...roomBase, id: 'ROOM-001', code: 'B001', displayName: 'Training room', active: true, equipmentCount: 3, itemsNeedingReview: 0, inspection: notStarted }
export const roomB002: RoomListItem = { ...roomBase, id: 'ROOM-002', code: 'B002', displayName: 'Seminar room', active: true, equipmentCount: 0, itemsNeedingReview: 0, inspection: notStarted }
export const roomB103: RoomListItem = { ...roomBase, id: 'ROOM-004', code: 'B103', displayName: '', floorId: 'FLR-002', floorName: 'First floor', floorLevel: 1, active: true, equipmentCount: 2, itemsNeedingReview: 1, inspection: notStarted }
export const roomB205: RoomListItem = { ...roomBase, id: 'ROOM-005', code: 'B205', displayName: 'Former store', floorId: 'FLR-002', floorName: 'First floor', floorLevel: 1, active: false, equipmentCount: 0, itemsNeedingReview: 0, inspection: { ...notStarted, inScope: false } }
export const roomDone: RoomListItem = {
  ...roomB001,
  id: 'ROOM-006',
  code: 'B006',
  inspection: { ...notStarted, status: 'Completed', inspectionId: 'INS-001', inspectorName: 'Aisha Rahman', startedAt: '2026-07-01T09:00:00.000Z', completedAt: '2026-07-01T09:30:00.000Z', checkedLines: 3, totalLines: 3 },
}
export const roomUnable: RoomListItem = {
  ...roomB001,
  id: 'ROOM-007',
  code: 'B007',
  inspection: { ...notStarted, status: 'Unable to inspect', inspectionId: 'INS-002', inspectorName: 'Tom Hale', startedAt: '2026-07-02T09:00:00.000Z', unableReason: 'Room locked' },
}

export function roomListResponse(rooms: RoomListItem[], cycle: InspectionCycle = openCycle, meta?: Partial<AuditRoomListResponse['meta']>): AuditRoomListResponse {
  return { data: rooms, meta: { page: 1, pageSize: 10, total: rooms.length, totalPages: rooms.length === 0 ? 0 : 1, ...meta }, cycle }
}

/* ---- Room detail ---- */

const answer = (over: Partial<ResultSummary>): ResultSummary => ({
  inspectionId: 'INS-001',
  cycleId: 'CYC-002',
  cycleName: 'Summer 2026',
  condition: 'Working',
  note: '',
  checkedAt: '2026-07-01T09:10:00.000Z',
  inspectorName: 'Aisha Rahman',
  corrected: false,
  checks: [],
  ...over,
})

export const projectorLine: EquipmentLine = {
  id: 'EQP-001',
  equipmentTypeId: 'projector',
  typeLabel: 'Projector',
  name: '',
  assetTag: 'AT-1001',
  serialNumber: 'SN-9001',
  source: 'Inventory',
  reviewStatus: 'Confirmed',
  checks: [],
  current: null,
  previous: answer({ condition: 'Not working', note: 'Lamp failing' }),
}
export const panelLine: EquipmentLine = {
  id: 'EQP-002',
  equipmentTypeId: 'clevertouch-panel',
  typeLabel: 'Clevertouch panel',
  name: '',
  assetTag: null,
  serialNumber: null,
  source: 'Inventory',
  reviewStatus: 'Confirmed',
  checks: [{ id: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update' }],
  current: null,
  previous: answer({ checks: [{ checkId: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update', condition: 'Not working', note: 'Update due' }] }),
}
export const foundLine: EquipmentLine = {
  id: 'EQP-003',
  equipmentTypeId: 'other',
  typeLabel: 'Other',
  name: 'Document camera',
  assetTag: null,
  serialNumber: null,
  source: 'Found during inspection',
  reviewStatus: 'Needs review',
  checks: [],
  current: null,
  previous: null,
}

export function roomDetail(over: Partial<RoomDetail> = {}, cycle: InspectionCycle = openCycle): AuditRoomResponse {
  return { data: { ...roomB001, equipment: [projectorLine, panelLine, foundLine], noEquipmentConfirmed: null, ...over }, cycle }
}
