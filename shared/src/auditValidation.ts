import {
  CHECK_CONDITIONS,
  CONDITIONS_REQUIRING_NOTE,
  EQUIPMENT_CONDITIONS,
  NOT_CHECKED,
  type CheckResult,
  type CheckResultCondition,
  type CycleStatus,
  type EquipmentType,
  type ResultCondition,
  type RoomInput,
  type RoomInputField,
  type StoredInspectionStatus,
} from './audit.js'
import type { ApiErrorDetail } from './types.js'
import { checkText, isPlainObject, rejectUnknownFields, sortByFieldOrder } from './validationHelpers.js'

/*
  Validation foundations for the Audit module. Like the project and task validators, these are shared by the
  server (authoritative) and the browser (instant feedback). Stage 1R-a only reads data; these rules are what
  later stages use to accept new and changed records, and the seed data is tested against them.
*/

/* ---- References and limits ---- */

/** One to three capital letters, three digits, and an optional capital letter: "B101", "HE061", "S205A". */
export const ROOM_CODE_PATTERN = /^[A-Z]{1,3}\d{3}[A-Z]?$/
export const BLOCK_CODE_PATTERN = /^[A-Z]{1,3}$/
export const BLOCK_REFERENCE_PATTERN = /^BLK-\d{3,6}$/
export const FLOOR_REFERENCE_PATTERN = /^FLR-\d{3,6}$/
export const ROOM_REFERENCE_PATTERN = /^ROOM-\d{3,6}$/
export const EQUIPMENT_REFERENCE_PATTERN = /^EQP-\d{3,6}$/
export const CYCLE_REFERENCE_PATTERN = /^CYC-\d{3,6}$/
export const INSPECTION_REFERENCE_PATTERN = /^INS-\d{3,6}$/

export const ROOM_DISPLAY_NAME_MAX = 60
export const MAX_FLOOR_LEVEL = 9

/** Letters, digits and hyphens, 1 to 40 characters. Unique among active items (the server checks that). */
export const ASSET_TAG_PATTERN = /^[A-Za-z0-9-]{1,40}$/
export const SERIAL_NUMBER_MAX = 60
export const ITEM_NAME_MAX = 80
export const NOTE_MAX_LENGTH = 500
export const UNABLE_REASON_MIN = 3
export const UNABLE_REASON_MAX = 300
export const CORRECTION_REASON_MIN = 3
export const CORRECTION_REASON_MAX = 300

/** Quick-pick reasons offered when a room cannot be inspected. Any text of at least 3 characters is accepted. */
export const UNABLE_REASON_SUGGESTIONS = [
  'Room locked',
  'Room in use for teaching',
  'Closed for building works',
  'No access to the room',
] as const

/* ---- Rooms ---- */

/** Tidies a room code as typed: surrounding spaces and a trailing colon are dropped and letters are capitalised. */
export function normaliseRoomCode(raw: string): string {
  return raw.trim().replace(/:$/, '').trim().toUpperCase()
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code)
}

/** The decimal digit that follows the block letters in a room code ("B101" -> 1), or null for a malformed code. */
export function roomCodeFloorDigit(code: string): number | null {
  const match = /^[A-Z]{1,3}(\d)\d{2}[A-Z]?$/.exec(code)
  return match ? Number(match[1]) : null
}

export const ROOM_INPUT_FIELDS = ['blockId', 'floorId', 'code', 'displayName', 'active'] as const satisfies readonly RoomInputField[]

const ROOM_LABELS: Record<RoomInputField, string> = {
  blockId: 'block',
  floorId: 'floor',
  code: 'room code',
  displayName: 'room name',
  active: 'active setting',
}

export type RoomValidationResult = { ok: true; value: RoomInput } | { ok: false; errors: ApiErrorDetail[] }

/**
 * Checks untrusted room input and returns either clean values or every problem found.
 * The room code is tidied with `normaliseRoomCode` first. `active` may be left out (the room is then active).
 * Whether the block and floor exist, and whether the floor belongs to the block, is checked by the server.
 */
export function validateRoomInput(raw: unknown): RoomValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ field: 'body', message: 'Send the room as a JSON object.' }] }
  }
  const input = raw
  const errors: ApiErrorDetail[] = []

  const reference = (field: 'blockId' | 'floorId', pattern: RegExp, example: string): string => {
    const value = input[field]
    if (typeof value === 'string' && pattern.test(value)) return value
    errors.push({ field, message: `Choose a ${ROOM_LABELS[field]} from the list (a reference such as ${example}).` })
    return ''
  }
  const blockId = reference('blockId', BLOCK_REFERENCE_PATTERN, 'BLK-001')
  const floorId = reference('floorId', FLOOR_REFERENCE_PATTERN, 'FLR-001')

  let code = ''
  if (typeof input.code !== 'string' || input.code.trim() === '') {
    errors.push({ field: 'code', message: 'Enter the room code.' })
  } else {
    code = normaliseRoomCode(input.code)
    if (!isValidRoomCode(code)) {
      errors.push({
        field: 'code',
        message: 'The room code must be one to three letters, three digits and an optional letter, for example B101.',
      })
      code = ''
    }
  }

  const displayName = checkText(
    'displayName',
    ROOM_LABELS.displayName,
    input.displayName,
    { limit: ROOM_DISPLAY_NAME_MAX, required: false, multiline: false },
    errors,
  )

  let active = true
  if (input.active !== undefined) {
    if (typeof input.active === 'boolean') active = input.active
    else errors.push({ field: 'active', message: 'The active setting must be true or false.' })
  }

  rejectUnknownFields(input, ROOM_INPUT_FIELDS, errors)
  sortByFieldOrder(errors, ROOM_INPUT_FIELDS)

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { blockId, floorId, code, displayName, active } }
}

/* ---- Notes ---- */

/** True when a note is required for this condition before an inspection can be completed. */
export function noteRequired(condition: string): boolean {
  return (CONDITIONS_REQUIRING_NOTE as readonly string[]).includes(condition)
}

/* ---- Equipment items ---- */

export interface EquipmentItemInput {
  roomId: string
  equipmentTypeId: string
  name: string
  assetTag: string | null
  serialNumber: string | null
}
type EquipmentItemField = keyof EquipmentItemInput
export const EQUIPMENT_ITEM_FIELDS = ['roomId', 'equipmentTypeId', 'name', 'assetTag', 'serialNumber'] as const satisfies readonly EquipmentItemField[]

export type EquipmentItemValidationResult = { ok: true; value: EquipmentItemInput } | { ok: false; errors: ApiErrorDetail[] }

/**
 * Checks untrusted equipment-item input. The asset tag and serial number are optional (empty means "none").
 * A name is required for types that ask for one (the "Other" category). Whether an asset tag is already in use
 * is checked by the server, which answers 409 for a clash.
 */
export function validateEquipmentItemInput(
  raw: unknown,
  types: readonly Pick<EquipmentType, 'id' | 'requiresName'>[],
): EquipmentItemValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ field: 'body', message: 'Send the equipment as a JSON object.' }] }
  }
  const input = raw
  const errors: ApiErrorDetail[] = []

  const roomId = typeof input.roomId === 'string' && ROOM_REFERENCE_PATTERN.test(input.roomId) ? input.roomId : ''
  if (!roomId) errors.push({ field: 'roomId', message: 'Choose a room from the list (a reference such as ROOM-001).' })

  const type = typeof input.equipmentTypeId === 'string' ? types.find((candidate) => candidate.id === input.equipmentTypeId) : undefined
  if (!type) errors.push({ field: 'equipmentTypeId', message: 'Choose the type of equipment from the list.' })

  const name = checkText(
    'name',
    'name',
    input.name,
    { limit: ITEM_NAME_MAX, required: type?.requiresName === true, multiline: false },
    errors,
  )

  let assetTag: string | null = null
  if (input.assetTag !== undefined && input.assetTag !== null && input.assetTag !== '') {
    const tag = typeof input.assetTag === 'string' ? input.assetTag.trim() : ''
    if (ASSET_TAG_PATTERN.test(tag)) assetTag = tag
    else errors.push({ field: 'assetTag', message: 'The asset tag may use letters, digits and hyphens only, up to 40 characters.' })
  }

  const serial = checkText(
    'serialNumber',
    'serial number',
    input.serialNumber === null ? undefined : input.serialNumber,
    { limit: SERIAL_NUMBER_MAX, required: false, multiline: false },
    errors,
  )

  rejectUnknownFields(input, EQUIPMENT_ITEM_FIELDS, errors)
  sortByFieldOrder(errors, EQUIPMENT_ITEM_FIELDS)

  if (errors.length > 0 || !type) return { ok: false, errors }
  return { ok: true, value: { roomId, equipmentTypeId: type.id, name, assetTag, serialNumber: serial === '' ? null : serial } }
}

/* ---- Saving one line of an inspection (a draft) ---- */

export interface ResultDraftInput {
  condition: ResultCondition
  note: string
  checks: CheckResult[]
}
export type ResultDraftValidationResult = { ok: true; value: ResultDraftInput } | { ok: false; errors: ApiErrorDetail[] }

const RESULT_CONDITIONS: readonly string[] = [...EQUIPMENT_CONDITIONS, NOT_CHECKED]
const CHECK_RESULT_CONDITIONS: readonly string[] = [...CHECK_CONDITIONS, NOT_CHECKED]
const RESULT_FIELDS = ['condition', 'note', 'checks'] as const

/**
 * Checks a line saved while an inspection is still a draft. A note that is required but not written yet is
 * allowed here (the inspector chooses the condition and then types the note); completing the inspection is
 * what insists on it, through `completionProblems`.
 */
export function validateResultDraftInput(raw: unknown): ResultDraftValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ field: 'body', message: 'Send the result as a JSON object.' }] }
  }
  const input = raw
  const errors: ApiErrorDetail[] = []

  let condition: ResultCondition = NOT_CHECKED
  if (typeof input.condition === 'string' && RESULT_CONDITIONS.includes(input.condition)) condition = input.condition as ResultCondition
  else errors.push({ field: 'condition', message: `Choose one of: ${RESULT_CONDITIONS.join(', ')}.` })

  const note = checkText('note', 'note', input.note, { limit: NOTE_MAX_LENGTH, required: false, multiline: true }, errors)

  const checks: CheckResult[] = []
  if (input.checks !== undefined) {
    if (!Array.isArray(input.checks)) {
      errors.push({ field: 'checks', message: 'The checks must be a list.' })
    } else {
      input.checks.forEach((entry: unknown, index: number) => {
        if (
          !isPlainObject(entry) ||
          typeof entry.checkId !== 'string' ||
          entry.checkId === '' ||
          typeof entry.condition !== 'string' ||
          !CHECK_RESULT_CONDITIONS.includes(entry.condition)
        ) {
          errors.push({ field: `checks.${index}`, message: `Each check needs a check and one of: ${CHECK_RESULT_CONDITIONS.join(', ')}.` })
          return
        }
        const checkNote = checkText(`checks.${index}.note`, 'note', entry.note, { limit: NOTE_MAX_LENGTH, required: false, multiline: true }, errors)
        checks.push({ checkId: entry.checkId, condition: entry.condition as CheckResultCondition, note: checkNote })
      })
    }
  }

  rejectUnknownFields(input, RESULT_FIELDS, errors)
  sortByFieldOrder(errors, RESULT_FIELDS)

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { condition, note, checks } }
}

/* ---- Completing an inspection ---- */

/** One line of a checklist, as the completion rule sees it. */
export interface ChecklistLine {
  equipmentItemId: string
  /** How the line is described in messages, for example "Projector (AT-00012)". */
  label: string
  condition: ResultCondition
  note: string
  checks: { checkId: string; condition: CheckResultCondition; note: string }[]
}

/** A condition under which the extra checks no longer apply: an item that is missing or not applicable. */
const CHECKS_EXEMPT: readonly ResultCondition[] = ['Missing', 'Not applicable']

/**
 * Everything that stops a room inspection being completed, or an empty list when it can be.
 *
 *  - Every item must have been checked ("Not checked" never counts as an answer; "Not applicable" does).
 *  - Not working, Needs replacement and Missing each need a note.
 *  - Every check on an item must be answered, and a check that is Not working needs a note too.
 *    An item that is Missing or Not applicable has no checks to answer.
 *  - A room with no equipment can be completed only once the inspector has confirmed there is none to inspect,
 *    and that confirmation cannot stand when equipment is listed.
 */
export function completionProblems(lines: readonly ChecklistLine[], noEquipmentConfirmed: boolean): ApiErrorDetail[] {
  const problems: ApiErrorDetail[] = []

  if (lines.length === 0 && !noEquipmentConfirmed) {
    problems.push({
      field: 'noEquipmentConfirmed',
      message: 'Confirm that this room has no equipment to inspect, or add the equipment you find.',
    })
  }
  if (lines.length > 0 && noEquipmentConfirmed) {
    problems.push({
      field: 'noEquipmentConfirmed',
      message: 'You confirmed that this room has no equipment, but equipment is listed. Remove the confirmation or the equipment.',
    })
  }

  for (const line of lines) {
    const field = `results.${line.equipmentItemId}`
    if (line.condition === NOT_CHECKED) {
      problems.push({ field, message: `${line.label} has not been checked.` })
      continue
    }
    if (noteRequired(line.condition) && line.note.trim() === '') {
      problems.push({ field, message: `${line.label}: add a note describing why it is ${line.condition.toLowerCase()}.` })
    }
    if (CHECKS_EXEMPT.includes(line.condition)) continue
    for (const check of line.checks) {
      if (check.condition === NOT_CHECKED) {
        problems.push({ field: `${field}.checks.${check.checkId}`, message: `${line.label}: the ${check.checkId} check has not been answered.` })
      } else if (noteRequired(check.condition) && check.note.trim() === '') {
        problems.push({ field: `${field}.checks.${check.checkId}`, message: `${line.label}: add a note for the ${check.checkId} check.` })
      }
    }
  }
  return problems
}

/* ---- Rooms that could not be inspected ---- */

export type UnableToInspectValidationResult = { ok: true; value: { reason: string } } | { ok: false; errors: ApiErrorDetail[] }

/** A room that cannot be inspected needs a reason: any text of 3 to 300 characters on one line. */
export function validateUnableToInspectInput(raw: unknown): UnableToInspectValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ field: 'body', message: 'Send the reason as a JSON object.' }] }
  }
  const errors: ApiErrorDetail[] = []
  const reason = checkText('reason', 'reason', raw.reason, { limit: UNABLE_REASON_MAX, required: true, multiline: false }, errors)
  if (reason !== '' && reason.length < UNABLE_REASON_MIN) {
    errors.push({ field: 'reason', message: `The reason must be at least ${UNABLE_REASON_MIN} characters.` })
  }
  rejectUnknownFields(raw, ['reason'], errors)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { reason } }
}

/* ---- Corrections to a completed inspection ---- */

export type CorrectionReasonValidationResult = { ok: true; value: string } | { ok: false; errors: ApiErrorDetail[] }

/** A correction always needs a reason, so the history says why a completed record changed. */
export function validateCorrectionReason(raw: unknown): CorrectionReasonValidationResult {
  const errors: ApiErrorDetail[] = []
  const reason = checkText('reason', 'reason', raw, { limit: CORRECTION_REASON_MAX, required: true, multiline: false }, errors)
  if (reason !== '' && reason.length < CORRECTION_REASON_MIN) {
    errors.push({ field: 'reason', message: `The reason must be at least ${CORRECTION_REASON_MIN} characters.` })
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: reason }
}

/**
 * Why a correction cannot be made, or null when it can: only a completed inspection can be corrected, and only
 * while its cycle is still open. Completed records are never overwritten; a correction adds to their history.
 */
export function correctionBlockedReason(cycleStatus: CycleStatus, inspectionStatus: StoredInspectionStatus): string | null {
  if (inspectionStatus !== 'Completed') return 'Only a completed inspection can be corrected.'
  if (cycleStatus !== 'Open') return 'This inspection belongs to a closed cycle and can no longer be corrected.'
  return null
}
