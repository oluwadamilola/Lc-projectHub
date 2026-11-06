import type {
  AuditBlockListResponse,
  AuditBlockResponse,
  AuditCycleListResponse,
  AuditRoomListParams,
  AuditRoomListResponse,
  AuditRoomResponse,
} from '@lc-projecthub/shared'
import { getJson } from './http'

/*
  Read-only Audit calls. Every call that describes inspection state takes an optional cycle reference; leaving it
  out asks for the server default, which is the open cycle.
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
