import type {
  AddEquipmentResponse,
  AuditBlockListResponse,
  AuditBlockResponse,
  AuditCycleListResponse,
  AuditRoomListParams,
  AuditRoomListResponse,
  AuditRoomResponse,
  EquipmentTypeListResponse,
  InspectionResponse,
  NoEquipmentInput,
  ResultDraftInput,
  StartInspectionInput,
} from '@lc-projecthub/shared'
import { getJson, sendJson } from './http'

/*
  Audit calls. The reads that describe inspection state take an optional cycle reference; leaving it out asks for
  the server default, which is the open cycle. The writes at the end carry out an inspection.
*/

const cycleQuery = (cycleId?: string) => (cycleId ? `?cycle=${encodeURIComponent(cycleId)}` : '')

export function getAuditCycles(signal?: AbortSignal): Promise<AuditCycleListResponse> {
  return getJson<AuditCycleListResponse>('/api/audit/cycles', signal)
}

/** Every block with its counts and progress, plus totals for the whole inventory. */
export function getAuditBlocks(cycleId?: string, signal?: AbortSignal): Promise<AuditBlockListResponse> {
  return getJson<AuditBlockListResponse>(`/api/audit/blocks${cycleQuery(cycleId)}`, signal)
}

/** One block with its floors (each with a room count and progress). */
export function getAuditBlock(blockId: string, cycleId?: string, signal?: AbortSignal): Promise<AuditBlockResponse> {
  return getJson<AuditBlockResponse>(`/api/audit/blocks/${encodeURIComponent(blockId)}${cycleQuery(cycleId)}`, signal)
}

export function getAuditRooms(params: AuditRoomListParams = {}, signal?: AbortSignal): Promise<AuditRoomListResponse> {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.block) search.set('block', params.block)
  if (params.floor) search.set('floor', params.floor)
  if (params.status) search.set('status', params.status)
  if (params.cycle) search.set('cycle', params.cycle)
  if (params.inspection) search.set('inspection', params.inspection)
  if (params.page) search.set('page', String(params.page))
  if (params.pageSize) search.set('pageSize', String(params.pageSize))
  const query = search.toString()
  return getJson<AuditRoomListResponse>(`/api/audit/rooms${query ? `?${query}` : ''}`, signal)
}

/** One room with its equipment checklist: this cycle answers and the previous ones. */
export function getAuditRoom(roomId: string, cycleId?: string, signal?: AbortSignal): Promise<AuditRoomResponse> {
  return getJson<AuditRoomResponse>(`/api/audit/rooms/${encodeURIComponent(roomId)}${cycleQuery(cycleId)}`, signal)
}

/* ---- Carrying out an inspection (the write API of stage 2a). Every rule is the server's; these only send. ---- */

const inspectionPath = (inspectionId: string) => `/api/audit/inspections/${encodeURIComponent(inspectionId)}`

/** The equipment types an inspector can choose from when adding equipment found in a room. */
export function getEquipmentTypes(signal?: AbortSignal): Promise<EquipmentTypeListResponse> {
  return getJson<EquipmentTypeListResponse>('/api/audit/equipment-types', signal)
}

/**
 * Starts the room's inspection in the open cycle, or returns the one already in progress (idempotent), or picks up a
 * room that was unable to be inspected. Answered with the inspection either way.
 */
export function startInspection(roomId: string, input: StartInspectionInput, signal?: AbortSignal): Promise<InspectionResponse> {
  return sendJson<InspectionResponse>('POST', `/api/audit/rooms/${encodeURIComponent(roomId)}/inspection`, input, signal)
}

export function getInspection(inspectionId: string, signal?: AbortSignal): Promise<InspectionResponse> {
  return getJson<InspectionResponse>(inspectionPath(inspectionId), signal)
}

/** Saves one line of the checklist: its condition, note and answers to any extra checks. */
export function saveInspectionResult(inspectionId: string, itemId: string, input: ResultDraftInput, signal?: AbortSignal): Promise<InspectionResponse> {
  return sendJson<InspectionResponse>('PUT', `${inspectionPath(inspectionId)}/results/${encodeURIComponent(itemId)}`, input, signal)
}

export function addInspectionEquipment(
  inspectionId: string,
  input: { equipmentTypeId: string; name?: string; assetTag?: string | null; serialNumber?: string | null },
  signal?: AbortSignal,
): Promise<AddEquipmentResponse> {
  return sendJson<AddEquipmentResponse>('POST', `${inspectionPath(inspectionId)}/equipment`, input, signal)
}

export function setInspectionNoEquipment(inspectionId: string, confirmed: boolean, signal?: AbortSignal): Promise<InspectionResponse> {
  return sendJson<InspectionResponse>('PUT', `${inspectionPath(inspectionId)}/no-equipment`, { confirmed } satisfies NoEquipmentInput, signal)
}

export function markInspectionUnable(inspectionId: string, input: { reason: string; inspectorId?: string }, signal?: AbortSignal): Promise<InspectionResponse> {
  return sendJson<InspectionResponse>('POST', `${inspectionPath(inspectionId)}/unable`, input, signal)
}

export function completeInspection(inspectionId: string, signal?: AbortSignal): Promise<InspectionResponse> {
  return sendJson<InspectionResponse>('POST', `${inspectionPath(inspectionId)}/complete`, {}, signal)
}
