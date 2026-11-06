import type {
  AuditBlockListResponse,
  AuditBlockResponse,
  AuditCycleListResponse,
  AuditCycleResponse,
  AuditFloorListResponse,
  AuditFloorResponse,
  AuditRoomListResponse,
  AuditRoomResponse,
  Block,
  BlockSummary,
  CycleProgress,
  CycleSummary,
  EquipmentItem,
  EquipmentLine,
  EquipmentType,
  EquipmentTypeListResponse,
  Floor,
  FloorSummary,
  InspectionCycle,
  InspectionResult,
  ResultSummary,
  Room,
  RoomInspectionStatus,
  RoomInspectionSummary,
  RoomListItem,
} from '@lc-projecthub/shared'
import { NOT_CHECKED } from '@lc-projecthub/shared'
import type {
  AuditRoomQuery,
  BlockRepository,
  CycleRepository,
  EquipmentItemRepository,
  EquipmentTypeRepository,
  FloorRepository,
  InspectionCycleRecord,
  InspectionRecord,
  InspectionRepository,
  RoomRepository,
} from '../domain/auditRepository.js'
import type { TechnicianRepository } from '../domain/technicianRepository.js'
import { NotFoundError } from '../errors.js'

/** Everything one request needs, loaded once so the figures in a response agree with each other. */
interface Context {
  blocks: Block[]
  floors: Floor[]
  rooms: Room[]
  types: EquipmentType[]
  items: EquipmentItem[]
  /** Oldest first. */
  cycles: InspectionCycleRecord[]
  technicianNames: Map<string, string>
}

/** The selected cycle and what is known about its inspections. `cycle` is null when there are no cycles. */
interface CycleView {
  cycle: InspectionCycleRecord | null
  scope: Set<string>
  byRoom: Map<string, InspectionRecord>
}

const publicCycle = ({ scopeRoomIds: _scope, ...cycle }: InspectionCycleRecord): InspectionCycle => {
  void _scope
  return cycle
}

/**
 * Application logic for the Audit module's read side (Stage 1R-a): joins the room inventory, the equipment, the
 * inspection cycles and the inspections, and works out progress and each room's and item's state. It never
 * changes anything and knows nothing about HTTP.
 */
export class AuditService {
  private readonly blocks: BlockRepository
  private readonly floors: FloorRepository
  private readonly rooms: RoomRepository
  private readonly equipmentTypes: EquipmentTypeRepository
  private readonly equipmentItems: EquipmentItemRepository
  private readonly cycles: CycleRepository
  private readonly inspections: InspectionRepository
  private readonly technicians: TechnicianRepository

  constructor(
    blocks: BlockRepository,
    floors: FloorRepository,
    rooms: RoomRepository,
    equipmentTypes: EquipmentTypeRepository,
    equipmentItems: EquipmentItemRepository,
    cycles: CycleRepository,
    inspections: InspectionRepository,
    technicians: TechnicianRepository,
  ) {
    this.blocks = blocks
    this.floors = floors
    this.rooms = rooms
    this.equipmentTypes = equipmentTypes
    this.equipmentItems = equipmentItems
    this.cycles = cycles
    this.inspections = inspections
    this.technicians = technicians
  }

  /* ---- Cycles ---- */

  async listCycles(): Promise<AuditCycleListResponse> {
    const context = await this.load()
    const newestFirst = [...context.cycles].reverse()
    return { data: await Promise.all(newestFirst.map((cycle) => this.summariseCycle(cycle))) }
  }

  async getCycle(cycleId: string): Promise<AuditCycleResponse> {
    const context = await this.load()
    const cycle = context.cycles.find((candidate) => candidate.id === cycleId)
    if (!cycle) throw new NotFoundError(`Cycle ${cycleId} was not found.`)
    return { data: await this.summariseCycle(cycle) }
  }

  /* ---- Blocks and floors ---- */

  async listBlocks(cycleId?: string): Promise<AuditBlockListResponse> {
    const context = await this.load()
    const view = await this.viewOf(context, cycleId)
    const activeRooms = context.rooms.filter((room) => room.active)
    return {
      data: context.blocks.map((block) => this.summariseBlock(block, context, view)),
      summary: {
        blocks: context.blocks.length,
        floors: context.floors.length,
        rooms: activeRooms.length,
        retiredRooms: context.rooms.length - activeRooms.length,
        progress: this.progress(context.rooms, view),
      },
      cycle: view.cycle && publicCycle(view.cycle),
    }
  }

  async getBlock(blockId: string, cycleId?: string): Promise<AuditBlockResponse> {
    const context = await this.load()
    const block = this.requireBlock(context, blockId)
    const view = await this.viewOf(context, cycleId)
    return {
      data: { ...this.summariseBlock(block, context, view), floors: this.floorsOf(blockId, context, view) },
      cycle: view.cycle && publicCycle(view.cycle),
    }
  }

  async listFloors(blockId: string, cycleId?: string): Promise<AuditFloorListResponse> {
    const context = await this.load()
    this.requireBlock(context, blockId)
    const view = await this.viewOf(context, cycleId)
    return { data: this.floorsOf(blockId, context, view), cycle: view.cycle && publicCycle(view.cycle) }
  }

  async getFloor(blockId: string, floorId: string, cycleId?: string): Promise<AuditFloorResponse> {
    const context = await this.load()
    this.requireBlock(context, blockId)
    const view = await this.viewOf(context, cycleId)
    const floor = this.floorsOf(blockId, context, view).find((candidate) => candidate.id === floorId)
    if (!floor) throw new NotFoundError(`Floor ${floorId} was not found in block ${blockId}.`)
    return { data: floor, cycle: view.cycle && publicCycle(view.cycle) }
  }

  /* ---- Rooms ---- */

  async listRooms(query: AuditRoomQuery): Promise<AuditRoomListResponse> {
    const context = await this.load()
    if (query.blockId) this.requireBlock(context, query.blockId)
    if (query.floorId) {
      const floor = context.floors.find((candidate) => candidate.id === query.floorId)
      if (!floor) throw new NotFoundError(`Floor ${query.floorId} was not found.`)
      // A floor only belongs to its own block, so a floor from another block is not found "in" this one.
      if (query.blockId && floor.blockId !== query.blockId) {
        throw new NotFoundError(`Floor ${query.floorId} was not found in block ${query.blockId}.`)
      }
    }
    const view = await this.viewOf(context, query.cycleId)
    const { cycleId: _cycleId, inspection, ...criteria } = query
    void _cycleId
    const { items, total } = await this.rooms.list({ ...criteria, roomIds: this.roomsMatching(inspection, context, view) })
    return {
      data: items.map((room) => this.toListItem(room, context, view)),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
      cycle: view.cycle && publicCycle(view.cycle),
    }
  }

  async getRoom(roomId: string, cycleId?: string): Promise<AuditRoomResponse> {
    const context = await this.load()
    const room = await this.rooms.findById(roomId)
    if (!room) throw new NotFoundError(`Room ${roomId} was not found.`)
    const view = await this.viewOf(context, cycleId)
    const history = await this.inspections.listByRoom(roomId)

    const typeById = new Map(context.types.map((type) => [type.id, type]))
    const cycleNames = new Map(context.cycles.map((cycle) => [cycle.id, cycle.name]))
    const selectedIndex = view.cycle ? context.cycles.findIndex((cycle) => cycle.id === view.cycle!.id) : -1
    const cycleIndex = new Map(context.cycles.map((cycle, index) => [cycle.id, index]))
    const current = view.byRoom.get(roomId) ?? null

    // The most recent completed inspections from cycles before the selected one, newest first.
    const earlier = history
      .filter((inspection) => inspection.status === 'Completed' && (cycleIndex.get(inspection.cycleId) ?? Infinity) < selectedIndex)
      .sort((a, b) => (cycleIndex.get(b.cycleId) ?? 0) - (cycleIndex.get(a.cycleId) ?? 0))

    const summarise = (inspection: InspectionRecord, result: InspectionResult, type: EquipmentType): ResultSummary => ({
      inspectionId: inspection.id,
      cycleId: inspection.cycleId,
      cycleName: cycleNames.get(inspection.cycleId) ?? inspection.cycleId,
      condition: result.condition,
      note: result.note,
      checkedAt: result.checkedAt,
      inspectorName: context.technicianNames.get(inspection.inspectorId) ?? null,
      corrected: result.corrections.length > 0,
      checks: type.checks.map((definition) => {
        const answer = result.checks.find((check) => check.checkId === definition.id)
        return {
          checkId: definition.id,
          label: definition.label,
          okLabel: definition.okLabel,
          notOkLabel: definition.notOkLabel,
          condition: answer?.condition ?? NOT_CHECKED,
          note: answer?.note ?? '',
        }
      }),
    })

    const equipment: EquipmentLine[] = this.activeItems(room.id, context)
      .sort((a, b) => (typeById.get(a.equipmentTypeId)?.order ?? 0) - (typeById.get(b.equipmentTypeId)?.order ?? 0) || a.id.localeCompare(b.id, 'en', { numeric: true }))
      .map((item) => {
        const type = typeById.get(item.equipmentTypeId)!
        const currentResult = current?.results.find((result) => result.equipmentItemId === item.id)
        const previousSource = earlier.find((inspection) => inspection.results.some((result) => result.equipmentItemId === item.id))
        const previousResult = previousSource?.results.find((result) => result.equipmentItemId === item.id)
        return {
          id: item.id,
          equipmentTypeId: item.equipmentTypeId,
          typeLabel: type.label,
          name: item.name,
          assetTag: item.assetTag,
          serialNumber: item.serialNumber,
          source: item.source,
          reviewStatus: item.reviewStatus,
          checks: type.checks.map((check) => ({ ...check })),
          current: current && currentResult ? summarise(current, currentResult, type) : null,
          previous: previousSource && previousResult ? summarise(previousSource, previousResult, type) : null,
        }
      })

    return {
      data: { ...this.toListItem(room, context, view), equipment, noEquipmentConfirmed: current ? current.noEquipmentConfirmed : null },
      cycle: view.cycle && publicCycle(view.cycle),
    }
  }

  async listEquipmentTypes(): Promise<EquipmentTypeListResponse> {
    return { data: await this.equipmentTypes.list() }
  }

  /* ---- internals ---- */

  private async load(): Promise<Context> {
    const [blocks, floors, rooms, types, items, cycles, technicians] = await Promise.all([
      this.blocks.list(),
      this.floors.list(),
      this.rooms.listAll(),
      this.equipmentTypes.list(),
      this.equipmentItems.listAll(),
      this.cycles.list(),
      this.technicians.list(),
    ])
    return { blocks, floors, rooms, types, items, cycles, technicianNames: new Map(technicians.map((technician) => [technician.id, technician.name])) }
  }

  /**
   * The cycle a request is about: the one asked for (404 if unknown), otherwise the open cycle, otherwise the most
   * recent one, otherwise none. Alongside it, the rooms in its scope and its inspections by room.
   */
  private async viewOf(context: Context, cycleId?: string): Promise<CycleView> {
    let cycle: InspectionCycleRecord | null
    if (cycleId) {
      cycle = context.cycles.find((candidate) => candidate.id === cycleId) ?? null
      if (!cycle) throw new NotFoundError(`Cycle ${cycleId} was not found.`)
    } else {
      cycle = context.cycles.find((candidate) => candidate.status === 'Open') ?? context.cycles.at(-1) ?? null
    }
    if (!cycle) return { cycle: null, scope: new Set(), byRoom: new Map() }
    const inspections = await this.inspections.listByCycle(cycle.id)
    return { cycle, scope: new Set(cycle.scopeRoomIds), byRoom: new Map(inspections.map((inspection) => [inspection.roomId, inspection])) }
  }

  private async summariseCycle(cycle: InspectionCycleRecord): Promise<CycleSummary> {
    const inspections = await this.inspections.listByCycle(cycle.id)
    const view: CycleView = { cycle, scope: new Set(cycle.scopeRoomIds), byRoom: new Map(inspections.map((inspection) => [inspection.roomId, inspection])) }
    return { ...publicCycle(cycle), roomsInScope: cycle.scopeRoomIds.length, progress: this.progress(cycle.scopeRoomIds, view) }
  }

  private requireBlock(context: Context, blockId: string): Block {
    const block = context.blocks.find((candidate) => candidate.id === blockId)
    if (!block) throw new NotFoundError(`Block ${blockId} was not found.`)
    return block
  }

  /** How the rooms (or room references) given that are in the cycle's scope divide between the inspection states. */
  private progress(rooms: readonly (Room | string)[], view: CycleView): CycleProgress {
    let completed = 0
    let inProgress = 0
    let unableToInspect = 0
    let scope = 0
    for (const entry of rooms) {
      const id = typeof entry === 'string' ? entry : entry.id
      if (!view.scope.has(id)) continue
      scope += 1
      const status = view.byRoom.get(id)?.status
      if (status === 'Completed') completed += 1
      else if (status === 'In progress') inProgress += 1
      else if (status === 'Unable to inspect') unableToInspect += 1
    }
    return {
      scope,
      completed,
      inProgress,
      unableToInspect,
      notStarted: scope - completed - inProgress - unableToInspect,
      percentComplete: scope === 0 ? null : Math.round((completed / scope) * 100),
    }
  }

  private summariseBlock(block: Block, context: Context, view: CycleView): BlockSummary {
    const rooms = context.rooms.filter((room) => room.blockId === block.id)
    const roomCount = rooms.filter((room) => room.active).length
    return {
      ...block,
      floorCount: context.floors.filter((floor) => floor.blockId === block.id).length,
      roomCount,
      retiredRoomCount: rooms.length - roomCount,
      progress: this.progress(rooms, view),
    }
  }

  private floorsOf(blockId: string, context: Context, view: CycleView): FloorSummary[] {
    return context.floors
      .filter((floor) => floor.blockId === blockId)
      .map((floor) => {
        const rooms = context.rooms.filter((room) => room.floorId === floor.id)
        const roomCount = rooms.filter((room) => room.active).length
        return { ...floor, roomCount, retiredRoomCount: rooms.length - roomCount, progress: this.progress(rooms, view) }
      })
  }

  /** The state a room is in for the cycle: "Not started" when it has no inspection record. */
  private statusOf(roomId: string, view: CycleView): RoomInspectionStatus {
    return view.byRoom.get(roomId)?.status ?? 'Not started'
  }

  /** The rooms an inspection filter selects, or undefined for "all". Only rooms in the cycle's scope can match. */
  private roomsMatching(filter: AuditRoomQuery['inspection'], context: Context, view: CycleView): string[] | undefined {
    if (filter === 'all') return undefined
    const wanted: Record<Exclude<AuditRoomQuery['inspection'], 'all'>, (status: RoomInspectionStatus) => boolean> = {
      toInspect: (status) => status !== 'Completed',
      notStarted: (status) => status === 'Not started',
      inProgress: (status) => status === 'In progress',
      completed: (status) => status === 'Completed',
      unable: (status) => status === 'Unable to inspect',
    }
    return context.rooms.filter((room) => view.scope.has(room.id) && wanted[filter](this.statusOf(room.id, view))).map((room) => room.id)
  }

  private activeItems(roomId: string, context: Context): EquipmentItem[] {
    return context.items.filter((item) => item.roomId === roomId && item.status === 'Active')
  }

  private toListItem(room: Room, context: Context, view: CycleView): RoomListItem {
    const block = context.blocks.find((candidate) => candidate.id === room.blockId)
    const floor = context.floors.find((candidate) => candidate.id === room.floorId)
    const items = this.activeItems(room.id, context)
    const record = view.byRoom.get(room.id)
    const status = this.statusOf(room.id, view)
    const inspection: RoomInspectionSummary = {
      status,
      inScope: view.scope.has(room.id),
      inspectionId: record?.id ?? null,
      inspectorName: record ? (context.technicianNames.get(record.inspectorId) ?? null) : null,
      startedAt: record?.startedAt ?? null,
      completedAt: record?.completedAt ?? null,
      checkedLines: record ? record.results.filter((result) => result.condition !== NOT_CHECKED).length : 0,
      totalLines: record ? record.results.length : 0,
      unableReason: record && status === 'Unable to inspect' ? (record.attempts.at(-1)?.reason ?? null) : null,
    }
    return {
      ...room,
      blockName: block?.name ?? room.blockId,
      blockCode: block?.code ?? '',
      floorName: floor?.name ?? room.floorId,
      floorLevel: floor?.level ?? 0,
      equipmentCount: items.length,
      itemsNeedingReview: items.filter((item) => item.reviewStatus === 'Needs review').length,
      inspection,
    }
  }
}
