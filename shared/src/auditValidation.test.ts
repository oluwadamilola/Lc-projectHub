import { describe, expect, it } from 'vitest'
import {
  ASSET_TAG_PATTERN,
  CHECK_CONDITIONS,
  CONDITIONS_REQUIRING_NOTE,
  CYCLE_REFERENCE_PATTERN,
  CYCLE_STATUSES,
  EQUIPMENT_CONDITIONS,
  EQUIPMENT_REFERENCE_PATTERN,
  EQUIPMENT_SOURCES,
  EQUIPMENT_STATUSES,
  INSPECTION_FILTERS,
  INSPECTION_REFERENCE_PATTERN,
  ISSUE_KINDS,
  ISSUE_RESOLUTIONS,
  ISSUE_STATUSES,
  NOT_CHECKED,
  NOTE_MAX_LENGTH,
  REVIEW_STATUSES,
  ROOM_CODE_PATTERN,
  ROOM_DISPLAY_NAME_MAX,
  ROOM_INSPECTION_STATUSES,
  ROOM_STATUS_FILTERS,
  SERIAL_NUMBER_MAX,
  UNABLE_REASON_SUGGESTIONS,
  completionProblems,
  correctionBlockedReason,
  isValidRoomCode,
  noteRequired,
  normaliseRoomCode,
  validateNoEquipmentInput,
  validateOptionalInspectorId,
  validateStartInspectionInput,
  roomCodeFloorDigit,
  validateCorrectionReason,
  validateEquipmentItemInput,
  validateResultDraftInput,
  validateRoomInput,
  validateUnableToInspectInput,
  type ChecklistLine,
} from './index.js'

describe('audit vocabulary', () => {
  it('has exactly the five equipment conditions, in order, and Missing is its own condition', () => {
    expect([...EQUIPMENT_CONDITIONS]).toEqual(['Working', 'Not working', 'Needs replacement', 'Missing', 'Not applicable'])
    expect(EQUIPMENT_CONDITIONS).toContain('Missing')
  })

  it('keeps "Not checked" outside the conditions an inspector can complete with', () => {
    expect(NOT_CHECKED).toBe('Not checked')
    expect((EQUIPMENT_CONDITIONS as readonly string[]).includes(NOT_CHECKED)).toBe(false)
  })

  it('has the four room inspection statuses, separate from the equipment conditions', () => {
    expect([...ROOM_INSPECTION_STATUSES]).toEqual(['Not started', 'In progress', 'Completed', 'Unable to inspect'])
    for (const status of ROOM_INSPECTION_STATUSES) expect((EQUIPMENT_CONDITIONS as readonly string[]).includes(status)).toBe(false)
  })

  it('requires a note for Not working, Needs replacement and Missing, and for nothing else', () => {
    expect([...CONDITIONS_REQUIRING_NOTE]).toEqual(['Not working', 'Needs replacement', 'Missing'])
    for (const condition of [...EQUIPMENT_CONDITIONS, NOT_CHECKED]) {
      expect(noteRequired(condition)).toBe(['Not working', 'Needs replacement', 'Missing'].includes(condition))
    }
  })

  it('answers checks with the same stored words, without Needs replacement or Missing', () => {
    expect([...CHECK_CONDITIONS]).toEqual(['Working', 'Not working', 'Not applicable'])
  })

  it('has the cycle, equipment, review and room filters', () => {
    expect([...CYCLE_STATUSES]).toEqual(['Open', 'Closed'])
    expect([...EQUIPMENT_STATUSES]).toEqual(['Active', 'Replaced', 'Removed'])
    expect([...EQUIPMENT_SOURCES]).toEqual(['Inventory', 'Found during inspection'])
    expect([...REVIEW_STATUSES]).toEqual(['Confirmed', 'Needs review'])
    expect([...ROOM_STATUS_FILTERS]).toEqual(['active', 'retired', 'all'])
    expect([...INSPECTION_FILTERS]).toEqual(['all', 'toInspect', 'notStarted', 'inProgress', 'completed', 'unable'])
  })

  it('has the issue vocabulary the issue stage will use', () => {
    expect([...ISSUE_KINDS]).toEqual(['Fault', 'Replacement required', 'Missing'])
    expect([...ISSUE_STATUSES]).toEqual(['Open', 'Resolved'])
    expect([...ISSUE_RESOLUTIONS]).toEqual(['Repaired', 'Replaced', 'Found', 'Removed', 'No fault found', 'Confirmed at inspection'])
  })

  it('has reference patterns for every audit record', () => {
    expect(EQUIPMENT_REFERENCE_PATTERN.test('EQP-001')).toBe(true)
    expect(CYCLE_REFERENCE_PATTERN.test('CYC-003')).toBe(true)
    expect(INSPECTION_REFERENCE_PATTERN.test('INS-0001')).toBe(true)
    expect(EQUIPMENT_REFERENCE_PATTERN.test('EQP-1')).toBe(false)
    expect(CYCLE_REFERENCE_PATTERN.test('INS-001')).toBe(false)
  })
})

describe('room codes', () => {
  it.each(['B001', 'B101', 'B205', 'S021', 'HE061', 'IOT081', 'TLV011', 'X104A', 'L041B'])('accepts %s', (code) => {
    expect(isValidRoomCode(code)).toBe(true)
    expect(ROOM_CODE_PATTERN.test(code)).toBe(true)
  })

  it.each(['', 'B', 'B1', 'B12', 'B1234', 'b101', 'B 101', 'B-101', 'ABCD101', '101', 'B101AB', 'B101:', 'B1O1'])('rejects %j', (code) => {
    expect(isValidRoomCode(code)).toBe(false)
  })

  it('tidies a code as typed: spaces, a trailing colon and letter case', () => {
    expect(normaliseRoomCode('  b101 ')).toBe('B101')
    expect(normaliseRoomCode('x104a:')).toBe('X104A')
    expect(normaliseRoomCode('S205a')).toBe('S205A')
  })

  it('reads the floor digit from a code', () => {
    expect(roomCodeFloorDigit('B001')).toBe(0)
    expect(roomCodeFloorDigit('B205')).toBe(2)
    expect(roomCodeFloorDigit('HE161')).toBe(1)
    expect(roomCodeFloorDigit('X205A')).toBe(2)
    expect(roomCodeFloorDigit('nonsense')).toBeNull()
  })
})

describe('validateRoomInput', () => {
  const valid = { blockId: 'BLK-001', floorId: 'FLR-002', code: 'B101', displayName: 'Seminar room', active: true }

  it('accepts a valid room and returns clean values', () => {
    expect(validateRoomInput(valid)).toEqual({ ok: true, value: valid })
  })

  it('tidies the code and trims the name', () => {
    expect(validateRoomInput({ ...valid, code: ' b102: ', displayName: '  Lab  ' })).toEqual({
      ok: true,
      value: { ...valid, code: 'B102', displayName: 'Lab' },
    })
  })

  it('treats a missing name as empty and a missing active setting as active', () => {
    const { displayName: _name, active: _active, ...minimal } = valid
    void _name
    void _active
    expect(validateRoomInput(minimal)).toEqual({ ok: true, value: { ...minimal, displayName: '', active: true } })
  })

  it.each([null, undefined, 'a room', 42, [], true])('rejects a body that is not an object (%j)', (body) => {
    expect(validateRoomInput(body)).toEqual({ ok: false, errors: [{ field: 'body', message: 'Send the room as a JSON object.' }] })
  })

  it('lists every problem at once, in form order', () => {
    const result = validateRoomInput({ blockId: 'x', floorId: 7, code: 'nope', displayName: 'x'.repeat(ROOM_DISPLAY_NAME_MAX + 1), active: 'yes', extra: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['blockId', 'floorId', 'code', 'displayName', 'active', 'extra'])
  })

  it('rejects unknown fields, including a supplied reference', () => {
    const result = validateRoomInput({ ...valid, id: 'ROOM-999' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['id'])
  })
})

describe('validateEquipmentItemInput', () => {
  const types = [
    { id: 'phone', requiresName: false },
    { id: 'other', requiresName: true },
  ]
  const valid = { roomId: 'ROOM-001', equipmentTypeId: 'phone', name: 'Desk phone', assetTag: 'AT-00012', serialNumber: 'SN-4F9K2' }

  it('accepts a valid item and returns clean values', () => {
    expect(validateEquipmentItemInput(valid, types)).toEqual({ ok: true, value: valid })
  })

  it('makes the asset tag, the serial number and (for most types) the name optional', () => {
    expect(validateEquipmentItemInput({ roomId: 'ROOM-001', equipmentTypeId: 'phone' }, types)).toEqual({
      ok: true,
      value: { roomId: 'ROOM-001', equipmentTypeId: 'phone', name: '', assetTag: null, serialNumber: null },
    })
    expect(validateEquipmentItemInput({ ...valid, assetTag: '', serialNumber: '' }, types)).toMatchObject({ ok: true, value: { assetTag: null, serialNumber: null } })
    expect(validateEquipmentItemInput({ ...valid, assetTag: null, serialNumber: null }, types)).toMatchObject({ ok: true, value: { assetTag: null, serialNumber: null } })
  })

  it('accepts an item with only an asset tag, or only a serial number', () => {
    expect(validateEquipmentItemInput({ ...valid, serialNumber: undefined }, types)).toMatchObject({ ok: true, value: { assetTag: 'AT-00012', serialNumber: null } })
    expect(validateEquipmentItemInput({ ...valid, assetTag: undefined }, types)).toMatchObject({ ok: true, value: { assetTag: null, serialNumber: 'SN-4F9K2' } })
  })

  it('requires a name for a type that asks for one', () => {
    const result = validateEquipmentItemInput({ ...valid, equipmentTypeId: 'other', name: '' }, types)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['name'])
    expect(validateEquipmentItemInput({ ...valid, equipmentTypeId: 'other', name: 'Document camera' }, types).ok).toBe(true)
  })

  it.each(['A', 'AT-00012', 'abc-123', '12345', 'x'.repeat(40)])('accepts the asset tag %j', (assetTag) => {
    expect(ASSET_TAG_PATTERN.test(assetTag)).toBe(true)
    expect(validateEquipmentItemInput({ ...valid, assetTag }, types).ok).toBe(true)
  })

  it.each(['x'.repeat(41), 'AT 00012', 'AT_00012', 'AT/1', 'AT.1', 'tag#1', 'é1', 12345])('rejects the asset tag %j', (assetTag) => {
    const result = validateEquipmentItemInput({ ...valid, assetTag }, types)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['assetTag'])
  })

  it('trims an asset tag and a serial number', () => {
    expect(validateEquipmentItemInput({ ...valid, assetTag: '  AT-1  ', serialNumber: '  SN 1  ' }, types)).toMatchObject({
      ok: true,
      value: { assetTag: 'AT-1', serialNumber: 'SN 1' },
    })
  })

  it('limits a serial number to 60 characters of free text on one line', () => {
    expect(validateEquipmentItemInput({ ...valid, serialNumber: 'S'.repeat(SERIAL_NUMBER_MAX) }, types).ok).toBe(true)
    expect(validateEquipmentItemInput({ ...valid, serialNumber: 'S'.repeat(SERIAL_NUMBER_MAX + 1) }, types).ok).toBe(false)
    expect(validateEquipmentItemInput({ ...valid, serialNumber: 'two\nlines' }, types).ok).toBe(false)
    expect(validateEquipmentItemInput({ ...valid, serialNumber: 'SN/4F9 (rev 2)' }, types).ok).toBe(true)
  })

  it('rejects an unknown or missing type and a bad room reference', () => {
    const result = validateEquipmentItemInput({ ...valid, roomId: 'room-1', equipmentTypeId: 'kettle' }, types)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['roomId', 'equipmentTypeId'])
  })

  it('rejects unknown fields, including a supplied reference, status or review flag', () => {
    for (const extra of ['id', 'status', 'reviewStatus']) {
      const result = validateEquipmentItemInput({ ...valid, [extra]: 'x' }, types)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual([extra])
    }
  })

  it.each([null, undefined, 'item', 7, []])('rejects a body that is not an object (%j)', (body) => {
    expect(validateEquipmentItemInput(body, types)).toEqual({ ok: false, errors: [{ field: 'body', message: 'Send the equipment as a JSON object.' }] })
  })
})

describe('validateResultDraftInput', () => {
  it('accepts a condition with a note and returns clean values', () => {
    expect(validateResultDraftInput({ condition: 'Not working', note: '  Bulb dim  ' })).toEqual({
      ok: true,
      value: { condition: 'Not working', note: 'Bulb dim', checks: [] },
    })
  })

  it.each([...EQUIPMENT_CONDITIONS, NOT_CHECKED])('accepts the condition %s', (condition) => {
    expect(validateResultDraftInput({ condition }).ok).toBe(true)
  })

  it('allows a required note to be left for later while the inspection is a draft', () => {
    for (const condition of CONDITIONS_REQUIRING_NOTE) {
      expect(validateResultDraftInput({ condition, note: '' })).toMatchObject({ ok: true, value: { condition, note: '' } })
    }
  })

  it('rejects an unknown condition, and any other inspection status in its place', () => {
    for (const condition of ['Broken', 'working', 'Completed', 'In progress', '', undefined, 3]) {
      const result = validateResultDraftInput({ condition })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors[0].field).toBe('condition')
    }
  })

  it('limits a note to 500 characters, and allows line breaks in it', () => {
    expect(validateResultDraftInput({ condition: 'Working', note: 'x'.repeat(NOTE_MAX_LENGTH) }).ok).toBe(true)
    expect(validateResultDraftInput({ condition: 'Working', note: 'x'.repeat(NOTE_MAX_LENGTH + 1) }).ok).toBe(false)
    expect(validateResultDraftInput({ condition: 'Working', note: 'two\nlines' }).ok).toBe(true)
  })

  it('validates check answers', () => {
    expect(validateResultDraftInput({ condition: 'Working', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }] })).toMatchObject({
      ok: true,
      value: { checks: [{ checkId: 'firmware', condition: 'Working', note: '' }] },
    })
    expect(validateResultDraftInput({ condition: 'Working', checks: [{ checkId: 'firmware', condition: NOT_CHECKED }] }).ok).toBe(true)
    for (const bad of [[{ checkId: 'firmware', condition: 'Missing' }], [{ checkId: '', condition: 'Working' }], [{ condition: 'Working' }], ['x'], 'firmware']) {
      expect(validateResultDraftInput({ condition: 'Working', checks: bad }).ok).toBe(false)
    }
  })

  it('rejects unknown fields and a body that is not an object', () => {
    const result = validateResultDraftInput({ condition: 'Working', status: 'Completed' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['status'])
    expect(validateResultDraftInput('Working').ok).toBe(false)
  })
})

describe('completionProblems', () => {
  const line = (overrides: Partial<ChecklistLine> = {}): ChecklistLine => ({
    equipmentItemId: 'EQP-001',
    label: 'Projector',
    condition: 'Working',
    note: '',
    checks: [],
    ...overrides,
  })
  const panel = (overrides: Partial<ChecklistLine> = {}) =>
    line({ equipmentItemId: 'EQP-002', label: 'Panel', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }], ...overrides })
  const fields = (lines: ChecklistLine[], confirmed = false) => completionProblems(lines, confirmed).map((problem) => problem.field)

  it('has no problems when every item is checked and every required note is written', () => {
    expect(completionProblems([line(), line({ equipmentItemId: 'EQP-003', condition: 'Not working', note: 'Bulb dim' }), panel()], false)).toEqual([])
  })

  it('treats "Not applicable" as an answer, with no note needed', () => {
    expect(completionProblems([line({ condition: 'Not applicable' })], false)).toEqual([])
  })

  it('refuses an item that is Not checked', () => {
    expect(completionProblems([line({ condition: NOT_CHECKED })], false)).toEqual([{ field: 'results.EQP-001', message: 'Projector has not been checked.' }])
  })

  it.each(['Not working', 'Needs replacement', 'Missing'] as const)('refuses %s without a note, and accepts it with one', (condition) => {
    expect(fields([line({ condition })])).toEqual(['results.EQP-001'])
    expect(fields([line({ condition, note: '   ' })])).toEqual(['results.EQP-001'])
    expect(fields([line({ condition, note: 'Described here' })])).toEqual([])
  })

  it('says which condition the missing note is for', () => {
    expect(completionProblems([line({ condition: 'Missing' })], false)[0].message).toBe('Projector: add a note describing why it is missing.')
    expect(completionProblems([line({ condition: 'Needs replacement' })], false)[0].message).toBe('Projector: add a note describing why it is needs replacement.')
  })

  it('refuses a check that has not been answered', () => {
    expect(completionProblems([panel({ checks: [{ checkId: 'firmware', condition: NOT_CHECKED, note: '' }] })], false)).toEqual([
      { field: 'results.EQP-002.checks.firmware', message: 'Panel: the firmware check has not been answered.' },
    ])
  })

  it('refuses a check that is Not working without a note, and accepts it with one', () => {
    expect(fields([panel({ checks: [{ checkId: 'firmware', condition: 'Not working', note: '' }] })])).toEqual(['results.EQP-002.checks.firmware'])
    expect(fields([panel({ checks: [{ checkId: 'firmware', condition: 'Not working', note: 'Two releases behind' }] })])).toEqual([])
  })

  it.each(['Missing', 'Not applicable'] as const)('does not ask about checks of an item that is %s', (condition) => {
    const checks = [{ checkId: 'firmware', condition: NOT_CHECKED, note: '' }]
    expect(fields([panel({ condition, note: 'Not found in the room', checks })])).toEqual([])
  })

  it('still asks about checks when the item is Not working or Needs replacement', () => {
    const checks = [{ checkId: 'firmware', condition: NOT_CHECKED, note: '' }]
    expect(fields([panel({ condition: 'Not working', note: 'No picture', checks })])).toEqual(['results.EQP-002.checks.firmware'])
  })

  it('does not also complain about checks on an item that is itself Not checked', () => {
    expect(fields([panel({ condition: NOT_CHECKED, checks: [{ checkId: 'firmware', condition: NOT_CHECKED, note: '' }] })])).toEqual(['results.EQP-002'])
  })

  describe('a room with no equipment', () => {
    it('cannot be completed until the inspector confirms there is no equipment to inspect', () => {
      expect(completionProblems([], false)).toEqual([
        { field: 'noEquipmentConfirmed', message: 'Confirm that this room has no equipment to inspect, or add the equipment you find.' },
      ])
    })

    it('can be completed once the inspector has confirmed it', () => {
      expect(completionProblems([], true)).toEqual([])
    })

    it('cannot keep the confirmation when equipment is listed (including equipment the inspector added)', () => {
      expect(completionProblems([line()], true)).toEqual([
        {
          field: 'noEquipmentConfirmed',
          message: 'You confirmed that this room has no equipment, but equipment is listed. Remove the confirmation or the equipment.',
        },
      ])
    })

    it('needs no confirmation when the room has equipment', () => {
      expect(completionProblems([line()], false)).toEqual([])
    })
  })

  it('reports every problem, in checklist order', () => {
    const problems = completionProblems(
      [
        line({ equipmentItemId: 'EQP-010', condition: NOT_CHECKED }),
        line({ equipmentItemId: 'EQP-011', condition: 'Missing' }),
        panel({ equipmentItemId: 'EQP-012', checks: [{ checkId: 'firmware', condition: NOT_CHECKED, note: '' }] }),
      ],
      false,
    )
    expect(problems.map((problem) => problem.field)).toEqual(['results.EQP-010', 'results.EQP-011', 'results.EQP-012.checks.firmware'])
  })

  it('does not change what it is given', () => {
    const lines = [line({ condition: 'Missing' })]
    const copy = JSON.parse(JSON.stringify(lines))
    completionProblems(lines, false)
    expect(lines).toEqual(copy)
  })
})

describe('validateUnableToInspectInput', () => {
  it('accepts a reason and trims it', () => {
    expect(validateUnableToInspectInput({ reason: '  Room locked  ' })).toEqual({ ok: true, value: { reason: 'Room locked' } })
  })

  it('accepts every quick-pick suggestion', () => {
    for (const reason of UNABLE_REASON_SUGGESTIONS) expect(validateUnableToInspectInput({ reason }).ok).toBe(true)
    expect(UNABLE_REASON_SUGGESTIONS.length).toBeGreaterThanOrEqual(3)
  })

  it('accepts any free text of at least 3 characters', () => {
    expect(validateUnableToInspectInput({ reason: 'Key' }).ok).toBe(true)
    expect(validateUnableToInspectInput({ reason: 'x'.repeat(300) }).ok).toBe(true)
  })

  it.each(['', '  ', 'ab', ' a ', undefined, null, 5])('requires a reason, so %j is rejected', (reason) => {
    const result = validateUnableToInspectInput({ reason })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['reason'])
  })

  it('says how short is too short', () => {
    const result = validateUnableToInspectInput({ reason: 'ab' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].message).toBe('The reason must be at least 3 characters.')
  })

  it('limits the reason to 300 characters on one line', () => {
    expect(validateUnableToInspectInput({ reason: 'x'.repeat(301) }).ok).toBe(false)
    expect(validateUnableToInspectInput({ reason: 'two\nlines' }).ok).toBe(false)
  })

  it('rejects unknown fields and a body that is not an object', () => {
    expect(validateUnableToInspectInput({ reason: 'Room locked', status: 'Completed' }).ok).toBe(false)
    expect(validateUnableToInspectInput('Room locked')).toEqual({ ok: false, errors: [{ field: 'body', message: 'Send the reason as a JSON object.' }] })
  })
})

describe('corrections to a completed inspection', () => {
  it('always needs a reason of at least 3 characters', () => {
    expect(validateCorrectionReason('  Re-checked the next day  ')).toEqual({ ok: true, value: 'Re-checked the next day' })
    for (const reason of ['', '  ', 'ab', undefined, null, 7, 'x'.repeat(301), 'a\nb']) expect(validateCorrectionReason(reason).ok).toBe(false)
  })

  it('is possible only for a completed inspection in an open cycle', () => {
    expect(correctionBlockedReason('Open', 'Completed')).toBeNull()
    expect(correctionBlockedReason('Closed', 'Completed')).toBe('This inspection belongs to a closed cycle and can no longer be corrected.')
    expect(correctionBlockedReason('Open', 'In progress')).toBe('Only a completed inspection can be corrected.')
    expect(correctionBlockedReason('Open', 'Unable to inspect')).toBe('Only a completed inspection can be corrected.')
  })

  it('treats a check\'s stored words the same as a condition\'s', () => {
    expect(CHECK_CONDITIONS.every((condition) => (EQUIPMENT_CONDITIONS as readonly string[]).includes(condition))).toBe(true)
  })
})

describe('validateStartInspectionInput', () => {
  it('accepts a technician, with or without a cycle', () => {
    expect(validateStartInspectionInput({ inspectorId: 'TECH-001' })).toEqual({ ok: true, value: { inspectorId: 'TECH-001' } })
    expect(validateStartInspectionInput({ inspectorId: ' TECH-002 ', cycleId: 'CYC-003' })).toEqual({ ok: true, value: { inspectorId: 'TECH-002', cycleId: 'CYC-003' } })
    expect(validateStartInspectionInput({ inspectorId: 'TECH-001', cycleId: null })).toEqual({ ok: true, value: { inspectorId: 'TECH-001' } })
  })
  it('requires a well-formed technician reference', () => {
    for (const bad of [undefined, '', 'Riley Hart', 'tech-001', 'TECH-1', 42, null]) {
      const result = validateStartInspectionInput({ inspectorId: bad })
      expect(result.ok, String(bad)).toBe(false)
      if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['inspectorId'])
    }
  })
  it('rejects a malformed cycle, unknown fields and a body that is not an object, listing every problem in field order', () => {
    const result = validateStartInspectionInput({ cycleId: 'summer', extra: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['inspectorId', 'cycleId', 'extra'])
    for (const body of [null, 'x', 5, [], undefined]) expect(validateStartInspectionInput(body).ok).toBe(false)
  })
})

describe('validateNoEquipmentInput', () => {
  it('accepts true and false only', () => {
    expect(validateNoEquipmentInput({ confirmed: true })).toEqual({ ok: true, value: { confirmed: true } })
    expect(validateNoEquipmentInput({ confirmed: false })).toEqual({ ok: true, value: { confirmed: false } })
    for (const bad of ['true', 1, null, undefined]) expect(validateNoEquipmentInput({ confirmed: bad }).ok, String(bad)).toBe(false)
  })
  it('rejects unknown fields and a body that is not an object', () => {
    const result = validateNoEquipmentInput({ confirmed: true, sure: true })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map((e) => e.field)).toEqual(['sure'])
    expect(validateNoEquipmentInput(null).ok).toBe(false)
  })
})

describe('validateOptionalInspectorId', () => {
  it('treats a missing value as using the inspection own inspector', () => {
    for (const absent of [undefined, null, '']) expect(validateOptionalInspectorId(absent)).toEqual({ ok: true, value: undefined })
  })
  it('accepts a technician reference and rejects anything else', () => {
    expect(validateOptionalInspectorId('TECH-004')).toEqual({ ok: true, value: 'TECH-004' })
    for (const bad of ['Riley', 7, {}, 'TECH-']) expect(validateOptionalInspectorId(bad).ok, String(bad)).toBe(false)
  })
})
