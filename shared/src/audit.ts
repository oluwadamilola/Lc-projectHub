/*
  Types and constants for the Audit module, shared by the API (server) and the web app (client).

  The Audit module is an annual physical equipment inspection. In each inspection CYCLE (for example
  "Summer 2027") an inspector visits every room, checks each item of equipment expected there, and records its
  condition. This file defines the vocabulary and shapes for that:

    Block 1-* Floor 1-* Room 1-* EquipmentItem *-1 EquipmentType (which may define CHECKS)
    InspectionCycle 1-* RoomInspection *-1 Room        (room status is separate from equipment condition)
    RoomInspection 1-* InspectionResult *-1 EquipmentItem

  Stage 1R-a is read-only. The pieces that later stages use (issues, corrections) are defined here now so
  every stage speaks the same language.
*/

import type { PageMeta } from './types.js'

/* ---- Vocabulary ---- */

/** What an inspector records for one item. No answer yet is "Not checked" (see `NOT_CHECKED`). */
export const EQUIPMENT_CONDITIONS = ['Working', 'Not working', 'Needs replacement', 'Missing', 'Not applicable'] as const
export type EquipmentCondition = (typeof EQUIPMENT_CONDITIONS)[number]

/** An item that has not been looked at yet. It is shown as text and can never be completed over. */
export const NOT_CHECKED = 'Not checked' as const
export type ResultCondition = EquipmentCondition | typeof NOT_CHECKED

/** Conditions that need a note describing the problem before an inspection can be completed. */
export const CONDITIONS_REQUIRING_NOTE: readonly ResultCondition[] = ['Not working', 'Needs replacement', 'Missing']

/**
 * A check is an extra question about an item (for example "firmware" on a Clevertouch panel). Its answer uses the
 * same stored words as a condition, so "Up to date" is stored as Working and "Needs update" as Not working.
 */
export const CHECK_CONDITIONS = ['Working', 'Not working', 'Not applicable'] as const
export type CheckCondition = (typeof CHECK_CONDITIONS)[number]
export type CheckResultCondition = CheckCondition | typeof NOT_CHECKED

/** The status of a room's inspection in a cycle. Kept separate from the condition of any equipment in it. */
export const ROOM_INSPECTION_STATUSES = ['Not started', 'In progress', 'Completed', 'Unable to inspect'] as const
export type RoomInspectionStatus = (typeof ROOM_INSPECTION_STATUSES)[number]
/** An inspection record exists only once a room has been started or attempted; "Not started" means no record. */
export type StoredInspectionStatus = Exclude<RoomInspectionStatus, 'Not started'>

/** Which rooms a room listing returns for a cycle. "toInspect" is everything not yet completed. */
export const INSPECTION_FILTERS = ['all', 'toInspect', 'notStarted', 'inProgress', 'completed', 'unable'] as const
export type InspectionFilter = (typeof INSPECTION_FILTERS)[number]

export const CYCLE_STATUSES = ['Open', 'Closed'] as const
export type CycleStatus = (typeof CYCLE_STATUSES)[number]

export const EQUIPMENT_STATUSES = ['Active', 'Replaced', 'Removed'] as const
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number]

export const EQUIPMENT_SOURCES = ['Inventory', 'Found during inspection'] as const
export type EquipmentSource = (typeof EQUIPMENT_SOURCES)[number]

/** Equipment an inspector adds during a visit is flagged "Needs review" until the inventory is updated. */
export const REVIEW_STATUSES = ['Confirmed', 'Needs review'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** Which rooms a room listing returns. Retired rooms stay on record but are not normally shown. */
export const ROOM_STATUS_FILTERS = ['active', 'retired', 'all'] as const
export type RoomStatusFilter = (typeof ROOM_STATUS_FILTERS)[number]

/* Used by the issue-tracking stage (vocabulary only for now). */
export const ISSUE_KINDS = ['Fault', 'Replacement required', 'Missing'] as const
export type IssueKind = (typeof ISSUE_KINDS)[number]
export const ISSUE_STATUSES = ['Open', 'Resolved'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]
export const ISSUE_RESOLUTIONS = ['Repaired', 'Replaced', 'Found', 'Removed', 'No fault found', 'Confirmed at inspection'] as const
export type IssueResolution = (typeof ISSUE_RESOLUTIONS)[number]

/* ---- Inventory ---- */

export interface Block {
  /** Reference such as "BLK-001". */
  id: string
  /** For example "B Block". */
  name: string
  /** One to three capital letters, used as the prefix of the block's room codes. */
  code: string
}

export interface Floor {
  /** Reference such as "FLR-001". */
  id: string
  blockId: string
  /** For example "Ground floor". */
  name: string
  /** 0 for the ground floor, 1 for the first floor, and so on. Floors are listed in this order. */
  level: number
}

export interface Room {
  /** Reference such as "ROOM-001". */
  id: string
  blockId: string
  floorId: string
  /** The label on the door, normalised: capital letters, three digits, optional letter (for example "B101"). */
  code: string
  /** A short description such as "Seminar room". May be an empty string. */
  displayName: string
  /** Retired rooms are kept on record but are not audited. */
  active: boolean
}

/** What a caller may send to create or replace a room. The reference is always assigned by the server. */
export type RoomInput = Omit<Room, 'id'>
export type RoomInputField = keyof RoomInput

export interface CheckDefinition {
  /** For example "firmware". */
  id: string
  label: string
  /** What the stored value Working is called for this check, for example "Up to date". */
  okLabel: string
  /** What the stored value Not working is called for this check, for example "Needs update". */
  notOkLabel: string
}

export interface EquipmentType {
  /** A short reference such as "projector" or "card-reader". */
  id: string
  label: string
  /** Display order in checklists. */
  order: number
  /** True when each item needs a name of its own (the "Other" category). */
  requiresName: boolean
  /** Extra checks asked about every item of this type. Empty for most types. */
  checks: CheckDefinition[]
}

/** One physical item in a room. Identifiers are optional. */
export interface EquipmentItem {
  /** Reference such as "EQP-001". */
  id: string
  roomId: string
  equipmentTypeId: string
  /** For example "Front projector". An empty string when the item has no name of its own. */
  name: string
  /** Letters, digits and hyphens, at most 40 characters, unique among active items. */
  assetTag: string | null
  /** Free text, at most 60 characters. */
  serialNumber: string | null
  status: EquipmentStatus
  source: EquipmentSource
  reviewStatus: ReviewStatus
  /** The inspection in which an inspector found and added the item, if it was not in the inventory. */
  addedInInspectionId: string | null
  /** The item this one replaced, if it is a replacement. */
  replacesItemId: string | null
}

/* ---- Cycles and inspections ---- */

export interface InspectionCycle {
  /** Reference such as "CYC-001". */
  id: string
  /** For example "Summer 2027". */
  name: string
  year: number
  /** Only one cycle is open at a time. */
  status: CycleStatus
  /** ISO calendar dates (YYYY-MM-DD): the window the inspections are planned for. */
  startDate: string
  endDate: string
  /** ISO date and time the cycle was closed, or null while open. */
  closedAt: string | null
}

/** A visit that did not result in an inspection, with the reason. */
export interface Attempt {
  /** ISO date and time. */
  at: string
  /** The technician who recorded it. */
  byId: string
  reason: string
}

export interface RoomInspection {
  /** Reference such as "INS-001". */
  id: string
  cycleId: string
  roomId: string
  status: StoredInspectionStatus
  /** The technician carrying out (or who carried out) the inspection. */
  inspectorId: string
  /** ISO date and time. */
  startedAt: string
  /** ISO date and time, or null until it is completed. */
  completedAt: string | null
  /** A note about the room as a whole. May be an empty string. */
  note: string
  /** The inspector's explicit confirmation that the room has no equipment to inspect. */
  noEquipmentConfirmed: boolean
  attempts: Attempt[]
}

/** What an item was (type, name, identifiers) when it was inspected, so old inspections stay readable. */
export interface ItemSnapshot {
  equipmentTypeId: string
  equipmentTypeLabel: string
  name: string
  assetTag: string | null
  serialNumber: string | null
}

export interface CheckResult {
  checkId: string
  condition: CheckResultCondition
  note: string
}

/** The answer for one item: its condition, a note, and the answers to any checks. */
export interface ResultState {
  condition: ResultCondition
  note: string
  checks: CheckResult[]
}

/** A change made after an inspection was completed. The earlier answer is kept here, never overwritten. */
export interface ResultCorrection {
  from: ResultState
  to: ResultState
  /** Why the change was made. Always required. */
  reason: string
  /** ISO date and time. */
  changedAt: string
  changedById: string
}

export interface InspectionResult extends ResultState {
  inspectionId: string
  equipmentItemId: string
  /** ISO date and time the line was answered, or null while Not checked. */
  checkedAt: string | null
  snapshot: ItemSnapshot
  /** Empty unless the result was corrected. Newest last. */
  corrections: ResultCorrection[]
}

/* ---- Read-API shapes ---- */

/** How many rooms are in each inspection state. The four counts always add up to `scope`. */
export interface CycleProgress {
  /** Rooms in the cycle's scope. */
  scope: number
  completed: number
  inProgress: number
  unableToInspect: number
  notStarted: number
  /** Completed as a whole-number percentage of scope, or null when scope is empty. */
  percentComplete: number | null
}

export interface CycleSummary extends InspectionCycle {
  roomsInScope: number
  progress: CycleProgress
}

export interface BlockSummary extends Block {
  floorCount: number
  /** Active rooms. */
  roomCount: number
  retiredRoomCount: number
  /** Progress over this block's rooms that are in the cycle's scope. */
  progress: CycleProgress
}

export interface FloorSummary extends Floor {
  /** Active rooms. */
  roomCount: number
  retiredRoomCount: number
  progress: CycleProgress
}

export interface BlockDetail extends BlockSummary {
  floors: FloorSummary[]
}

export interface AuditOverviewSummary {
  blocks: number
  floors: number
  /** Active rooms. */
  rooms: number
  retiredRooms: number
  progress: CycleProgress
}

export interface RoomInspectionSummary {
  /** "Not started" when the room has no inspection record in the cycle. */
  status: RoomInspectionStatus
  /** False for a room that was not in the cycle's scope (for example one added or retired since). */
  inScope: boolean
  inspectionId: string | null
  inspectorName: string | null
  startedAt: string | null
  completedAt: string | null
  /** Lines answered, and lines in total, in this inspection. Both 0 when there is no checklist yet. */
  checkedLines: number
  totalLines: number
  /** The reason from the latest attempt when the status is "Unable to inspect". */
  unableReason: string | null
}

export interface RoomListItem extends Room {
  blockName: string
  blockCode: string
  floorName: string
  floorLevel: number
  /** Active equipment items in the room. */
  equipmentCount: number
  /** Of those, how many were found during an inspection and still need inventory review. */
  itemsNeedingReview: number
  inspection: RoomInspectionSummary
}

export interface CheckResultLine {
  checkId: string
  label: string
  okLabel: string
  notOkLabel: string
  condition: CheckResultCondition
  note: string
}

/** One answer for one item, with where and when it was given. */
export interface ResultSummary {
  inspectionId: string
  cycleId: string
  cycleName: string
  condition: ResultCondition
  note: string
  /** ISO date and time, or null while Not checked. */
  checkedAt: string | null
  inspectorName: string | null
  /** True when the answer was changed after the inspection was completed. */
  corrected: boolean
  checks: CheckResultLine[]
}

export interface EquipmentLine {
  id: string
  equipmentTypeId: string
  typeLabel: string
  name: string
  assetTag: string | null
  serialNumber: string | null
  source: EquipmentSource
  reviewStatus: ReviewStatus
  /** The checks asked about this item. */
  checks: CheckDefinition[]
  /** The answer in the selected cycle (including "Not checked" in a draft), or null if there is none. */
  current: ResultSummary | null
  /** The most recent completed answer from an EARLIER cycle, or null. */
  previous: ResultSummary | null
}

export interface RoomDetail extends RoomListItem {
  /** Active equipment, in checklist order. Replaced and removed items are not listed. */
  equipment: EquipmentLine[]
  /** True/false from the selected cycle's inspection; null when the room has no inspection in the cycle. */
  noEquipmentConfirmed: boolean | null
}

/** Query parameters accepted by GET /api/audit/rooms (all optional on the wire). */
export interface AuditRoomListParams {
  q?: string
  /** A block reference such as "BLK-001". */
  block?: string
  /** A floor reference such as "FLR-001". */
  floor?: string
  status?: RoomStatusFilter
  /** A cycle reference such as "CYC-003". Defaults to the open cycle. */
  cycle?: string
  inspection?: InspectionFilter
  page?: number
  pageSize?: number
}

/* ---- API response shapes. `cycle` is the cycle the figures describe, or null if there are no cycles. ---- */

export interface AuditCycleListResponse {
  data: CycleSummary[]
}
export interface AuditCycleResponse {
  data: CycleSummary
}
export interface AuditBlockListResponse {
  data: BlockSummary[]
  summary: AuditOverviewSummary
  cycle: InspectionCycle | null
}
export interface AuditBlockResponse {
  data: BlockDetail
  cycle: InspectionCycle | null
}
export interface AuditFloorListResponse {
  data: FloorSummary[]
  cycle: InspectionCycle | null
}
export interface AuditFloorResponse {
  data: FloorSummary
  cycle: InspectionCycle | null
}
export interface AuditRoomListResponse {
  data: RoomListItem[]
  meta: PageMeta
  cycle: InspectionCycle | null
}
export interface AuditRoomResponse {
  data: RoomDetail
  cycle: InspectionCycle | null
}
export interface EquipmentTypeListResponse {
  data: EquipmentType[]
}
