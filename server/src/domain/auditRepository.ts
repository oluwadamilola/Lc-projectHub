import type {
  Block,
  EquipmentItem,
  EquipmentType,
  Floor,
  InspectionCycle,
  InspectionFilter,
  InspectionResult,
  Room,
  RoomInspection,
  RoomStatusFilter,
} from '@lc-projecthub/shared'

/*
  The persistence boundary for the Audit module (Stage 1R-a: read-only).

  Like the project and task repositories these are asynchronous, so a database-backed version (for example
  SQL Server) can replace the in-memory ones without changing any caller, and they always return copies,
  never objects they keep internally. Whether a referenced block, floor or cycle exists is the service's job.
*/

/** A cycle together with the rooms that were in scope when it opened. The scope never changes afterwards. */
export interface InspectionCycleRecord extends InspectionCycle {
  scopeRoomIds: string[]
}

/**
 * A room inspection together with its result lines, kept as one unit: when later stages complete or correct an
 * inspection, that is a single change to a single record, so it can become one database transaction.
 */
export interface InspectionRecord extends RoomInspection {
  results: InspectionResult[]
}

export interface BlockRepository {
  /** Every block, in the order they should be shown. */
  list(): Promise<Block[]>
  findById(id: string): Promise<Block | null>
}

export interface FloorRepository {
  /** Every floor, ordered by block and then by level. */
  list(): Promise<Floor[]>
  findById(id: string): Promise<Floor | null>
}

export interface RoomSearchCriteria {
  blockId?: string
  floorId?: string
  /** Only these rooms. The service uses it to apply an inspection filter before paging. */
  roomIds?: readonly string[]
  /** Case-insensitive text matched against the room code and name. */
  search?: string
  status: RoomStatusFilter
  /** 1-based page number. */
  page: number
  pageSize: number
}

/** A room listing as the service receives it: the repository criteria plus the cycle and inspection filter. */
export interface AuditRoomQuery extends Omit<RoomSearchCriteria, 'roomIds'> {
  /** The cycle to show inspection state for. Defaults to the open cycle. */
  cycleId?: string
  inspection: InspectionFilter
}

export interface RoomPage {
  items: Room[]
  /** Number of rooms matching the filters, ignoring paging. */
  total: number
}

export interface RoomRepository {
  /** Rooms ordered by block, then floor level, then room code. */
  list(criteria: RoomSearchCriteria): Promise<RoomPage>
  /** Every room, in the same order, for totals. */
  listAll(): Promise<Room[]>
  findById(id: string): Promise<Room | null>
}

export interface EquipmentTypeRepository {
  /** In display order. */
  list(): Promise<EquipmentType[]>
  findById(id: string): Promise<EquipmentType | null>
}

export interface EquipmentItemRepository {
  /** Every item of every status, ordered by reference. */
  listAll(): Promise<EquipmentItem[]>
  findById(id: string): Promise<EquipmentItem | null>
}

export interface CycleRepository {
  /** Oldest first (by year, then start date). */
  list(): Promise<InspectionCycleRecord[]>
  findById(id: string): Promise<InspectionCycleRecord | null>
}

export interface InspectionRepository {
  /** Every inspection in the cycle: at most one per room. */
  listByCycle(cycleId: string): Promise<InspectionRecord[]>
  /** Every inspection of one room, across cycles. */
  listByRoom(roomId: string): Promise<InspectionRecord[]>
  findById(id: string): Promise<InspectionRecord | null>
}
