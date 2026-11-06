import {
  BLOCK_REFERENCE_PATTERN,
  CYCLE_REFERENCE_PATTERN,
  DEFAULT_PAGE_SIZE,
  FLOOR_REFERENCE_PATTERN,
  INSPECTION_FILTERS,
  MAX_PAGE_SIZE,
  ROOM_STATUS_FILTERS,
  type ApiErrorDetail,
  type InspectionFilter,
  type RoomStatusFilter,
} from '@lc-projecthub/shared'
import type { AuditRoomQuery } from '../domain/auditRepository.js'
import { ValidationError } from '../errors.js'
import { MAX_PAGE, readInteger, readSearch, readText, rejectUnknownParameters } from './queryParsing.js'

const KNOWN_PARAMETERS = ['q', 'block', 'floor', 'status', 'cycle', 'inspection', 'page', 'pageSize']

/** Turns raw query-string values into trusted criteria for GET /api/audit/rooms, or throws listing every problem. */
export function parseRoomQuery(query: Record<string, unknown>): AuditRoomQuery {
  const errors: ApiErrorDetail[] = []

  rejectUnknownParameters(query, KNOWN_PARAMETERS, errors)
  const search = readSearch(query, errors)

  const blockId = readText(query, 'block', errors)
  if (blockId !== undefined && !BLOCK_REFERENCE_PATTERN.test(blockId)) {
    errors.push({ field: 'block', message: 'Must be a block reference such as BLK-001.' })
  }

  const floorId = readText(query, 'floor', errors)
  if (floorId !== undefined && !FLOOR_REFERENCE_PATTERN.test(floorId)) {
    errors.push({ field: 'floor', message: 'Must be a floor reference such as FLR-001.' })
  }

  const statusText = readText(query, 'status', errors)
  let status: RoomStatusFilter = 'active'
  if (statusText !== undefined) {
    const match = ROOM_STATUS_FILTERS.find((option) => option === statusText)
    if (match) status = match
    else errors.push({ field: 'status', message: `Must be one of: ${ROOM_STATUS_FILTERS.join(', ')}.` })
  }

  const cycleId = readText(query, 'cycle', errors)
  if (cycleId !== undefined && !CYCLE_REFERENCE_PATTERN.test(cycleId)) {
    errors.push({ field: 'cycle', message: 'Must be a cycle reference such as CYC-001.' })
  }

  const inspectionText = readText(query, 'inspection', errors)
  let inspection: InspectionFilter = 'all'
  if (inspectionText !== undefined) {
    const match = INSPECTION_FILTERS.find((option) => option === inspectionText)
    if (match) inspection = match
    else errors.push({ field: 'inspection', message: `Must be one of: ${INSPECTION_FILTERS.join(', ')}.` })
  }

  const page = readInteger(query, 'page', { min: 1, max: MAX_PAGE, fallback: 1 }, errors)
  const pageSize = readInteger(query, 'pageSize', { min: 1, max: MAX_PAGE_SIZE, fallback: DEFAULT_PAGE_SIZE }, errors)

  if (errors.length > 0) throw new ValidationError(errors)
  return { blockId, floorId, search, status, cycleId, inspection, page, pageSize }
}
