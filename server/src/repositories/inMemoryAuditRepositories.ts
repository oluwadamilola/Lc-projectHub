import type { Block, EquipmentItem, EquipmentType, Floor, InspectionResult, Room } from '@lc-projecthub/shared'
import type {
  BlockRepository,
  CycleRepository,
  EquipmentItemRepository,
  EquipmentTypeRepository,
  FloorRepository,
  InspectionCycleRecord,
  InspectionRecord,
  InspectionRepository,
  RoomPage,
  RoomRepository,
  RoomSearchCriteria,
} from '../domain/auditRepository.js'

/*
  In-memory versions of the Audit repositories. Used for development and tests; they contain only the data they
  are given. Like the project and task repositories they copy data on the way in and on the way out, so callers
  can never change what is stored by changing what they were handed. Copies are deep where records hold lists
  (a cycle's scope, an inspection's attempts and results).
*/

const naturalOrder = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

function copyResult(result: InspectionResult): InspectionResult {
  return {
    ...result,
    checks: result.checks.map((check) => ({ ...check })),
    snapshot: { ...result.snapshot },
    corrections: result.corrections.map((correction) => ({
      ...correction,
      from: { ...correction.from, checks: correction.from.checks.map((check) => ({ ...check })) },
      to: { ...correction.to, checks: correction.to.checks.map((check) => ({ ...check })) },
    })),
  }
}

function copyInspection(inspection: InspectionRecord): InspectionRecord {
  return {
    ...inspection,
    attempts: inspection.attempts.map((attempt) => ({ ...attempt })),
    results: inspection.results.map(copyResult),
  }
}

const copyCycle = (cycle: InspectionCycleRecord): InspectionCycleRecord => ({ ...cycle, scopeRoomIds: [...cycle.scopeRoomIds] })
const copyType = (type: EquipmentType): EquipmentType => ({ ...type, checks: type.checks.map((check) => ({ ...check })) })

export class InMemoryBlockRepository implements BlockRepository {
  private readonly blocks: Block[]

  constructor(blocks: readonly Block[]) {
    this.blocks = blocks.map((block) => ({ ...block })).sort((a, b) => naturalOrder(a.id, b.id))
  }

  async list(): Promise<Block[]> {
    return this.blocks.map((block) => ({ ...block }))
  }

  async findById(id: string): Promise<Block | null> {
    const block = this.blocks.find((candidate) => candidate.id === id)
    return block ? { ...block } : null
  }
}

export class InMemoryFloorRepository implements FloorRepository {
  private readonly floors: Floor[]

  constructor(floors: readonly Floor[]) {
    this.floors = floors.map((floor) => ({ ...floor })).sort((a, b) => naturalOrder(a.blockId, b.blockId) || a.level - b.level)
  }

  async list(): Promise<Floor[]> {
    return this.floors.map((floor) => ({ ...floor }))
  }

  async findById(id: string): Promise<Floor | null> {
    const floor = this.floors.find((candidate) => candidate.id === id)
    return floor ? { ...floor } : null
  }
}

function matchesSearch(room: Room, needle: string): boolean {
  return [room.code, room.displayName].some((value) => value.toLowerCase().includes(needle))
}

export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms: Room[]

  /** Floors are only used to put rooms in floor order (ground floor first); they are not stored or returned. */
  constructor(rooms: readonly Room[], floors: readonly Floor[]) {
    const level = new Map(floors.map((floor) => [floor.id, floor.level]))
    this.rooms = rooms
      .map((room) => ({ ...room }))
      .sort(
        (a, b) =>
          naturalOrder(a.blockId, b.blockId) ||
          (level.get(a.floorId) ?? 0) - (level.get(b.floorId) ?? 0) ||
          naturalOrder(a.code, b.code),
      )
  }

  async list({ blockId, floorId, roomIds, search, status, page, pageSize }: RoomSearchCriteria): Promise<RoomPage> {
    const needle = search?.trim().toLowerCase()
    const allowed = roomIds ? new Set(roomIds) : null
    const matches = this.rooms
      .filter((room) => !blockId || room.blockId === blockId)
      .filter((room) => !floorId || room.floorId === floorId)
      .filter((room) => !allowed || allowed.has(room.id))
      .filter((room) => status === 'all' || (status === 'active' ? room.active : !room.active))
      .filter((room) => !needle || matchesSearch(room, needle))
    const start = (page - 1) * pageSize
    return {
      items: matches.slice(start, start + pageSize).map((room) => ({ ...room })),
      total: matches.length,
    }
  }

  async listAll(): Promise<Room[]> {
    return this.rooms.map((room) => ({ ...room }))
  }

  async findById(id: string): Promise<Room | null> {
    const room = this.rooms.find((candidate) => candidate.id === id)
    return room ? { ...room } : null
  }
}

export class InMemoryEquipmentTypeRepository implements EquipmentTypeRepository {
  private readonly types: EquipmentType[]

  constructor(types: readonly EquipmentType[]) {
    this.types = types.map(copyType).sort((a, b) => a.order - b.order)
  }

  async list(): Promise<EquipmentType[]> {
    return this.types.map(copyType)
  }

  async findById(id: string): Promise<EquipmentType | null> {
    const type = this.types.find((candidate) => candidate.id === id)
    return type ? copyType(type) : null
  }
}

export class InMemoryEquipmentItemRepository implements EquipmentItemRepository {
  private readonly items: EquipmentItem[]

  constructor(items: readonly EquipmentItem[]) {
    this.items = items.map((item) => ({ ...item })).sort((a, b) => naturalOrder(a.id, b.id))
  }

  async listAll(): Promise<EquipmentItem[]> {
    return this.items.map((item) => ({ ...item }))
  }

  async findById(id: string): Promise<EquipmentItem | null> {
    const item = this.items.find((candidate) => candidate.id === id)
    return item ? { ...item } : null
  }
}

export class InMemoryCycleRepository implements CycleRepository {
  private readonly cycles: InspectionCycleRecord[]

  constructor(cycles: readonly InspectionCycleRecord[]) {
    this.cycles = cycles.map(copyCycle).sort((a, b) => a.year - b.year || a.startDate.localeCompare(b.startDate))
  }

  async list(): Promise<InspectionCycleRecord[]> {
    return this.cycles.map(copyCycle)
  }

  async findById(id: string): Promise<InspectionCycleRecord | null> {
    const cycle = this.cycles.find((candidate) => candidate.id === id)
    return cycle ? copyCycle(cycle) : null
  }
}

export class InMemoryInspectionRepository implements InspectionRepository {
  private readonly inspections: InspectionRecord[]

  constructor(inspections: readonly InspectionRecord[]) {
    this.inspections = inspections.map(copyInspection).sort((a, b) => naturalOrder(a.id, b.id))
  }

  async listByCycle(cycleId: string): Promise<InspectionRecord[]> {
    return this.inspections.filter((inspection) => inspection.cycleId === cycleId).map(copyInspection)
  }

  async listByRoom(roomId: string): Promise<InspectionRecord[]> {
    return this.inspections.filter((inspection) => inspection.roomId === roomId).map(copyInspection)
  }

  async findById(id: string): Promise<InspectionRecord | null> {
    const inspection = this.inspections.find((candidate) => candidate.id === id)
    return inspection ? copyInspection(inspection) : null
  }
}
