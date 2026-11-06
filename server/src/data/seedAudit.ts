import type {
  Block,
  CheckResult,
  EquipmentCondition,
  EquipmentItem,
  EquipmentType,
  Floor,
  InspectionResult,
  ResultState,
  Room,
} from '@lc-projecthub/shared'
import { UNABLE_REASON_SUGGESTIONS } from '@lc-projecthub/shared'
import type { InspectionCycleRecord, InspectionRecord } from '../domain/auditRepository.js'

/*
  FICTIONAL DEMONSTRATION DATA ONLY.

  Every block layout, room code, room name, equipment item, identifier, inspection, note and date below is
  invented to demonstrate the Audit module. Nothing is copied from any college workbook, system or record: no
  real room codes, no real observations, no names and no notes. The real inventory will be supplied and approved
  separately.

  The data is DETERMINISTIC. There is no clock and no randomness: every date is a fixed calendar date and every
  pattern (which room is unable to be inspected, which line is faulty) is spelled out below, so building the seed
  twice gives identical data and tests can state exact figures.

  Room numbering is block-specific: code = block letters + floor digit + two-digit sequence, restarting on every
  floor. B Block starts each floor at 01 (B001, B101, B201). The other blocks start at their own offset
  (S 21, L 41, HE 61, IOT 81, T-LVL 11).

  Three inspection cycles are seeded. Summer 2025 and Summer 2026 are CLOSED and fully inspected (with rooms that
  could not be inspected and rooms never reached). Summer 2027 is the one OPEN cycle and has NO inspections yet:
  every room in its scope is Not started. Its progress is zero until inspections can be recorded (a later stage).
*/

export const seedEquipmentTypes: EquipmentType[] = [
  { id: 'phone', label: 'Phone', order: 1, requiresName: false, checks: [] },
  { id: 'projector', label: 'Projector', order: 2, requiresName: false, checks: [] },
  { id: 'tv', label: 'TV', order: 3, requiresName: false, checks: [] },
  { id: 'dock', label: 'Dock', order: 4, requiresName: false, checks: [] },
  { id: 'speaker', label: 'Speaker', order: 5, requiresName: false, checks: [] },
  { id: 'card-reader', label: 'Card Reader', order: 6, requiresName: false, checks: [] },
  {
    id: 'clevertouch-panel',
    label: 'Clevertouch Panel',
    order: 7,
    requiresName: false,
    checks: [{ id: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update' }],
  },
  { id: 'other', label: 'Other', order: 8, requiresName: true, checks: [] },
]

/* ---- Blocks, floors and rooms ---- */

/** [name, retired?]. An empty name means the room has no description. */
type RoomSpec = [displayName: string, retired?: 'retired']
interface FloorSpec {
  name: string
  level: number
  rooms: RoomSpec[]
}
interface BlockSpec {
  name: string
  code: string
  firstSequence: number
  floors: FloorSpec[]
}

const FLOOR_NAMES = ['Ground floor', 'First floor', 'Second floor', 'Third floor']
const floor = (level: number, rooms: RoomSpec[]): FloorSpec => ({ name: FLOOR_NAMES[level], level, rooms })

const blockSpecs: BlockSpec[] = [
  {
    name: 'B Block',
    code: 'B',
    firstSequence: 1,
    floors: [
      floor(0, [['Training room'], ['Seminar room'], ['Seminar room'], ['Computer lab'], [''], ['']]),
      floor(1, [['Lecture room'], ['Lecture room'], ['Computer lab'], ['Seminar room'], [''], ['']]),
      floor(2, [['Computer lab'], ['Seminar room'], ['Studio'], ['Meeting room'], ['Former store', 'retired']]),
    ],
  },
  {
    name: 'S Block',
    code: 'S',
    firstSequence: 21,
    floors: [
      floor(0, [['Workshop'], ['Workshop'], ['Seminar room'], ['Store'], ['']]),
      floor(1, [['Lecture room'], ['Lecture room'], ['Computer lab'], ['Seminar room'], ['']]),
      floor(2, [['Computer lab'], ['Seminar room'], ['Meeting room'], ['']]),
    ],
  },
  {
    name: 'L Block',
    code: 'L',
    firstSequence: 41,
    floors: [
      floor(0, [['Library desk'], ['Quiet study room'], ['Group study room'], ['Group study room'], ['IT help point'], ['']]),
      floor(1, [['Seminar room'], ['Seminar room'], ['Lecture room'], ['Computer lab'], ['Old archive', 'retired'], ['']]),
    ],
  },
  {
    name: 'HE',
    code: 'HE',
    firstSequence: 61,
    floors: [
      floor(0, [['Lecture theatre'], ['Seminar room'], ['Seminar room'], ['Computer lab'], ['']]),
      floor(1, [['Research room'], ['Seminar room'], ['Meeting room'], ['']]),
    ],
  },
  {
    name: 'IOT',
    code: 'IOT',
    firstSequence: 81,
    floors: [
      floor(0, [['Engineering workshop'], ['Electronics lab'], ['Seminar room'], ['']]),
      floor(1, [['Computer lab'], ['Computer lab'], ['Seminar room'], ['']]),
      floor(2, []), // not fitted out yet: a floor that exists but has no rooms
    ],
  },
  {
    name: 'T-LVL',
    code: 'TLV',
    firstSequence: 11,
    floors: [
      floor(0, [['Training room'], ['Training room'], ['Seminar room'], ['']]),
      floor(1, [['Computer lab'], ['Seminar room'], ['']]),
    ],
  },
]

/* ---- Equipment: what each kind of room is fitted with ---- */

/**
 * The equipment in the inventory for each kind of room. An entry is a type id, or "other:Name" for the Other
 * category. A type listed twice gives two items, numbered ("Projector 1", "Projector 2"). An empty list means the
 * inventory records no equipment for that kind of room.
 */
const KITS: Record<string, string[]> = {
  'Training room': ['phone', 'projector', 'dock', 'speaker', 'card-reader'],
  'Seminar room': ['phone', 'projector', 'dock', 'card-reader'],
  'Lecture room': ['phone', 'projector', 'dock', 'speaker', 'card-reader'],
  'Lecture theatre': ['phone', 'projector', 'projector', 'dock', 'speaker', 'speaker', 'card-reader'],
  'Meeting room': ['phone', 'tv', 'dock'],
  'Research room': ['phone', 'tv', 'dock'],
  'Computer lab': ['phone', 'projector', 'projector', 'dock', 'speaker', 'card-reader', 'other:Teaching PCs'],
  Studio: ['phone', 'tv', 'tv', 'dock', 'speaker', 'other:Camera rig'],
  Workshop: ['phone', 'other:Workshop screen'],
  'Engineering workshop': ['phone', 'tv', 'other:Machine status display'],
  'Electronics lab': ['phone', 'projector', 'dock', 'other:Bench PCs'],
  'Library desk': ['phone', 'card-reader'],
  'Quiet study room': ['phone'],
  'Group study room': ['tv', 'dock'],
  'IT help point': ['phone', 'card-reader', 'other:Self-service kiosk'],
  Store: [],
  'Former store': [],
  'Old archive': [],
  '': ['phone', 'dock'],
}

/** Rooms whose equipment differs from their kind's kit: Clevertouch panels, and two unnamed rooms with none. */
const KIT_OVERRIDES: Record<string, string[]> = {
  B101: ['phone', 'clevertouch-panel', 'dock', 'card-reader'],
  B102: ['phone', 'clevertouch-panel', 'speaker'],
  S121: ['phone', 'clevertouch-panel', 'dock'],
  L141: ['phone', 'clevertouch-panel', 'dock', 'speaker'],
  HE062: ['phone', 'clevertouch-panel', 'dock', 'card-reader'],
  IOT081: ['phone', 'clevertouch-panel'],
  TLV111: ['phone', 'clevertouch-panel', 'dock'],
  B005: [],
  B006: [],
}

/* ---- Cycles ---- */

interface CycleSpec {
  id: string
  name: string
  year: number
  startDate: string
  endDate: string
  status: 'Open' | 'Closed'
  closedAt: string | null
  /** Rooms that were retired by the time the cycle opened are left out of its scope. */
  includeRetiredRooms: boolean
}

const cycleSpecs: CycleSpec[] = [
  { id: 'CYC-001', name: 'Summer 2025', year: 2025, startDate: '2025-06-23', endDate: '2025-08-29', status: 'Closed', closedAt: '2025-09-05T10:00:00.000Z', includeRetiredRooms: true },
  { id: 'CYC-002', name: 'Summer 2026', year: 2026, startDate: '2026-06-22', endDate: '2026-08-28', status: 'Closed', closedAt: '2026-09-04T09:30:00.000Z', includeRetiredRooms: true },
  { id: 'CYC-003', name: 'Summer 2027', year: 2027, startDate: '2027-06-21', endDate: '2027-08-27', status: 'Open', closedAt: null, includeRetiredRooms: false },
]

/**
 * Which rooms were not simply "completed" in each CLOSED cycle. Every other room in scope was completed. The open
 * cycle has no entry: nothing has been inspected in it yet.
 */
const PLAN: Record<string, { unable: string[]; notStarted: string[] }> = {
  'CYC-001': { unable: ['S024', 'L044', 'IOT083', 'TLV013'], notStarted: ['B006', 'HE065', 'L046'] },
  'CYC-002': { unable: ['B104', 'S122', 'HE163'], notStarted: ['L145', 'B205'] },
}

/* ---- Notes (fictional) ---- */

const NOTE_POOLS: Partial<Record<EquipmentCondition, string[]>> = {
  'Not working': [
    'Picture cuts out after a few minutes',
    'No sound from the output',
    'Does not power on',
    'Handset buzzes and drops calls',
    'Reader does not recognise cards',
  ],
  'Needs replacement': ['Cracked casing, beyond repair', 'End of life; spares no longer available', 'Burn marks on the power supply'],
  Missing: ['Not in the room; reported to the asset team', 'Mounting bracket empty, unit not found'],
}

/* ---- Builders ---- */

export interface SeedAudit {
  blocks: Block[]
  floors: Floor[]
  rooms: Room[]
  equipmentTypes: EquipmentType[]
  items: EquipmentItem[]
  cycles: InspectionCycleRecord[]
  inspections: InspectionRecord[]
}

const reference = (prefix: string, number: number) => `${prefix}-${String(number).padStart(3, '0')}`

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}
function daysBetween(from: string, to: string): number {
  const utc = (iso: string) => {
    const [year, month, day] = iso.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}
function at(isoDate: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${isoDate}T${hh}:${mm}:00.000Z`
}
const hex8 = (n: number) => ((n * 2654435761) >>> 0).toString(16).toUpperCase().padStart(8, '0')

/** Cycle index 1..3: an item is on the checklist of every cycle from `from` to `to`, inclusive. */
interface Lifecycle {
  from: number
  to: number
}

interface Inventory {
  blocks: Block[]
  floors: Floor[]
  rooms: Room[]
  items: EquipmentItem[]
  lifecycle: Map<string, Lifecycle>
}

function buildInventory(): Inventory {
  const blocks: Block[] = []
  const floors: Floor[] = []
  const rooms: Room[] = []
  for (const spec of blockSpecs) {
    const block: Block = { id: reference('BLK', blocks.length + 1), name: spec.name, code: spec.code }
    blocks.push(block)
    for (const floorSpec of spec.floors) {
      const record: Floor = { id: reference('FLR', floors.length + 1), blockId: block.id, name: floorSpec.name, level: floorSpec.level }
      floors.push(record)
      floorSpec.rooms.forEach(([displayName, retired], index) => {
        rooms.push({
          id: reference('ROOM', rooms.length + 1),
          blockId: block.id,
          floorId: record.id,
          code: `${spec.code}${floorSpec.level}${String(spec.firstSequence + index).padStart(2, '0')}`,
          displayName,
          active: retired !== 'retired',
        })
      })
    }
  }

  const typeById = new Map(seedEquipmentTypes.map((type) => [type.id, type]))
  const items: EquipmentItem[] = []
  const lifecycle = new Map<string, Lifecycle>()

  const addItem = (roomId: string, typeId: string, name: string, span: Lifecycle, extra: Partial<EquipmentItem> = {}): EquipmentItem => {
    const index = items.length + 1
    const item: EquipmentItem = {
      id: reference('EQP', index),
      roomId,
      equipmentTypeId: typeId,
      name,
      // Some items have only a tag, some only a serial number, and one in thirty-five has neither.
      assetTag: index % 7 === 0 ? null : `AT-${String(10000 + index * 3).padStart(5, '0')}`,
      serialNumber: index % 5 === 0 ? null : `SN-${hex8(index)}`,
      status: 'Active',
      source: 'Inventory',
      reviewStatus: 'Confirmed',
      addedInInspectionId: null,
      replacesItemId: null,
      ...extra,
    }
    items.push(item)
    lifecycle.set(item.id, span)
    return item
  }

  for (const room of rooms) {
    const kit = KIT_OVERRIDES[room.code] ?? KITS[room.displayName]
    const occurrences = new Map<string, number>()
    for (const entry of kit) {
      const [typeId, explicitName] = entry.split(':')
      const total = kit.filter((other) => other.split(':')[0] === typeId).length
      const seen = (occurrences.get(typeId) ?? 0) + 1
      occurrences.set(typeId, seen)
      const label = typeById.get(typeId)!.label
      addItem(room.id, typeId, explicitName ?? (total > 1 ? `${label} ${seen}` : ''), { from: 1, to: 3 })
    }
  }

  const roomId = (code: string) => rooms.find((room) => room.code === code)!.id
  const find = (code: string, typeId: string) => items.find((item) => item.roomId === roomId(code) && item.equipmentTypeId === typeId && item.status === 'Active')!

  // A phone that needed replacing in 2026 was replaced afterwards: the old item is kept (Replaced) and a new one links to it.
  const oldPhone = find('B002', 'phone')
  oldPhone.status = 'Replaced'
  lifecycle.set(oldPhone.id, { from: 1, to: 2 })
  addItem(oldPhone.roomId, 'phone', '', { from: 3, to: 3 }, { assetTag: 'AT-90001', serialNumber: 'SN-NEW00001', replacesItemId: oldPhone.id })

  // A television that was taken out of a study room after 2026.
  const removedTv = find('L043', 'tv')
  removedTv.status = 'Removed'
  lifecycle.set(removedTv.id, { from: 1, to: 2 })

  // Equipment an inspector found in a room during the Summer 2026 inspection, which the inventory does not list.
  // It was flagged for review then and has not been reviewed since.
  addItem(roomId('B103'), 'other', 'Document camera', { from: 2, to: 3 }, { source: 'Found during inspection', reviewStatus: 'Needs review' })

  return { blocks, floors, rooms, items, lifecycle }
}

function conditionFor(n: number): EquipmentCondition {
  if (n % 41 === 0) return 'Not applicable'
  if (n % 37 === 0) return 'Missing'
  if (n % 29 === 0) return 'Needs replacement'
  if (n % 13 === 0) return 'Not working'
  return 'Working'
}

export function buildSeedAudit(): SeedAudit {
  const inventory = buildInventory()
  const { rooms, items, lifecycle } = inventory
  const typeById = new Map(seedEquipmentTypes.map((type) => [type.id, type]))
  const technicianIds = ['TECH-001', 'TECH-002', 'TECH-003', 'TECH-004', 'TECH-005', 'TECH-006']
  const codeOf = new Map(rooms.map((room) => [room.id, room.code]))

  const cycles: InspectionCycleRecord[] = []
  const inspections: InspectionRecord[] = []
  let lineCounter = 0
  let visitCounter = 0

  cycleSpecs.forEach((spec, cycleIndex) => {
    const cycleNumber = cycleIndex + 1
    const scope = rooms.filter((room) => spec.includeRetiredRooms || room.active)
    cycles.push({
      id: spec.id,
      name: spec.name,
      year: spec.year,
      status: spec.status,
      startDate: spec.startDate,
      endDate: spec.endDate,
      closedAt: spec.closedAt,
      scopeRoomIds: scope.map((room) => room.id),
    })

    // The open cycle has no inspections: every room in its scope is Not started.
    if (spec.status === 'Open') return

    const plan = PLAN[spec.id]
    const special = new Set([...plan.unable, ...plan.notStarted])
    const completedCodes = new Set(scope.map((room) => room.code).filter((code) => !special.has(code)))

    const windowDays = daysBetween(spec.startDate, spec.endDate)
    for (const room of scope) {
      const isCompleted = completedCodes.has(room.code)
      const isUnable = plan.unable.includes(room.code)
      if (!isCompleted && !isUnable) continue // Not started: no record

      visitCounter += 1
      const date = addDays(spec.startDate, (visitCounter * 3) % (windowDays + 1))
      const minutes = 8 * 60 + ((visitCounter * 17) % (8 * 60))
      const inspectorId = technicianIds[visitCounter % technicianIds.length]
      const inspectionId = reference('INS', inspections.length + 1)
      const startedAt = at(date, minutes)

      const checklist = items
        .filter((item) => item.roomId === room.id && (lifecycle.get(item.id)?.from ?? 1) <= cycleNumber && cycleNumber <= (lifecycle.get(item.id)?.to ?? 3))
        .sort((a, b) => typeById.get(a.equipmentTypeId)!.order - typeById.get(b.equipmentTypeId)!.order || a.id.localeCompare(b.id, 'en', { numeric: true }))

      const results: InspectionResult[] = []
      if (!isUnable) {
        checklist.forEach((item, lineIndex) => {
          const type = typeById.get(item.equipmentTypeId)!
          const snapshot = {
            equipmentTypeId: type.id,
            equipmentTypeLabel: type.label,
            name: item.name,
            assetTag: item.assetTag,
            serialNumber: item.serialNumber,
          }
          lineCounter += 1
          const condition = conditionFor(lineCounter)
          const pool = NOTE_POOLS[condition]
          const note = pool ? pool[lineCounter % pool.length] : lineCounter % 17 === 0 ? 'Cleaned the filter' : ''
          const checks: CheckResult[] = type.checks.map((check) => {
            if (condition === 'Missing' || condition === 'Not applicable') return { checkId: check.id, condition: 'Not applicable', note: '' }
            const behind = lineCounter % 3 === 0
            return { checkId: check.id, condition: behind ? 'Not working' : 'Working', note: behind ? 'Firmware two releases behind' : '' }
          })
          results.push({
            inspectionId,
            equipmentItemId: item.id,
            condition,
            note,
            checks,
            checkedAt: at(date, minutes + 2 * (lineIndex + 1)),
            snapshot,
            corrections: [],
          })
        })
      }

      inspections.push({
        id: inspectionId,
        cycleId: spec.id,
        roomId: room.id,
        status: isCompleted ? 'Completed' : 'Unable to inspect',
        inspectorId,
        startedAt,
        completedAt: isCompleted ? at(date, minutes + 25) : null,
        note: '',
        // A completed inspection of a room with no equipment records the inspector's explicit confirmation.
        noEquipmentConfirmed: isCompleted && checklist.length === 0,
        attempts: isUnable
          ? [{ at: startedAt, byId: inspectorId, reason: UNABLE_REASON_SUGGESTIONS[visitCounter % UNABLE_REASON_SUGGESTIONS.length] }]
          : [],
        results,
      })
    }
  })

  // One result in Summer 2026 was corrected after completion, while that cycle was still open (the day after the
  // inspection, well before the cycle closed). The earlier answer is kept in its history.
  const corrected = inspections.find((inspection) => inspection.cycleId === 'CYC-002' && inspection.status === 'Completed' && inspection.results[0]?.condition === 'Working')
  if (corrected) {
    const result = corrected.results[0]
    const from: ResultState = { condition: result.condition, note: result.note, checks: result.checks.map((check) => ({ ...check })) }
    const to: ResultState = { condition: 'Not working', note: 'Faulty when re-checked the next day', checks: result.checks.map((check) => ({ ...check })) }
    result.condition = to.condition
    result.note = to.note
    result.corrections.push({
      from,
      to,
      reason: 'Re-checked the next day after a staff report',
      changedAt: at(addDays(corrected.completedAt!.slice(0, 10), 1), 9 * 60),
      changedById: corrected.inspectorId,
    })
  }

  // The item found during an inspection records which inspection found it.
  const found = items.find((item) => item.source === 'Found during inspection')!
  found.addedInInspectionId = inspections.find((inspection) => inspection.cycleId === 'CYC-002' && codeOf.get(inspection.roomId) === 'B103')!.id

  return {
    blocks: inventory.blocks,
    floors: inventory.floors,
    rooms: inventory.rooms,
    equipmentTypes: seedEquipmentTypes.map((type) => ({ ...type, checks: type.checks.map((check) => ({ ...check })) })),
    items,
    cycles,
    inspections,
  }
}
