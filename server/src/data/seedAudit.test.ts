import {
  ASSET_TAG_PATTERN,
  EQUIPMENT_CONDITIONS,
  NOT_CHECKED,
  SERIAL_NUMBER_MAX,
  completionProblems,
  isValidRoomCode,
  roomCodeFloorDigit,
  validateEquipmentItemInput,
  validateResultDraftInput,
  validateRoomInput,
  validateUnableToInspectInput,
  type ChecklistLine,
} from '@lc-projecthub/shared'
import { describe, expect, it } from 'vitest'
import type { InspectionRecord } from '../domain/auditRepository.js'
import { buildSeedAudit } from './seedAudit.js'
import { seedTechnicians } from './seedTasks.js'

const seed = buildSeedAudit()
const blockByName = (name: string) => seed.blocks.find((block) => block.name === name)!
const floorsOf = (blockId: string) => seed.floors.filter((floor) => floor.blockId === blockId)
const roomsOf = (floorId: string) => seed.rooms.filter((room) => room.floorId === floorId)
const room = (code: string) => seed.rooms.find((candidate) => candidate.code === code)!
const codeOf = (roomId: string) => seed.rooms.find((candidate) => candidate.id === roomId)!.code
const cycle = (name: string) => seed.cycles.find((candidate) => candidate.name === name)!
const inspectionsOf = (cycleId: string) => seed.inspections.filter((inspection) => inspection.cycleId === cycleId)
const countStatus = (inspections: InspectionRecord[], status: string) => inspections.filter((inspection) => inspection.status === status).length
const activeItems = seed.items.filter((item) => item.status === 'Active')

describe('the fictional audit seed: blocks, floors and rooms', () => {
  it('has the six confirmed blocks, each separate', () => {
    expect(seed.blocks.map((block) => block.name)).toEqual(['B Block', 'S Block', 'L Block', 'HE', 'IOT', 'T-LVL'])
    expect(new Set(seed.blocks.map((block) => block.code)).size).toBe(6)
  })

  it('B Block has three floors numbered B0xx, B1xx and B2xx', () => {
    const [ground, first, second] = floorsOf(blockByName('B Block').id)
    expect([ground, first, second].map((floor) => [floor.name, floor.level])).toEqual([['Ground floor', 0], ['First floor', 1], ['Second floor', 2]])
    expect(roomsOf(ground.id).map((r) => r.code)).toEqual(['B001', 'B002', 'B003', 'B004', 'B005', 'B006'])
    expect(roomsOf(first.id).map((r) => r.code)).toEqual(['B101', 'B102', 'B103', 'B104', 'B105', 'B106'])
    expect(roomsOf(second.id).map((r) => r.code)).toEqual(['B201', 'B202', 'B203', 'B204', 'B205'])
  })

  it('has 67 rooms (65 active, 2 retired) and a floor with no rooms to show the empty case', () => {
    expect(seed.rooms.length).toBe(67)
    expect(seed.rooms.filter((r) => !r.active).map((r) => r.code)).toEqual(['B205', 'L145'])
    expect(seed.floors.filter((floor) => roomsOf(floor.id).length === 0).map((floor) => floor.blockId)).toEqual([blockByName('IOT').id])
  })

  it('uses unique, well-formed references and consistent ownership', () => {
    for (const [list, pattern] of [[seed.blocks, /^BLK-\d{3}$/], [seed.floors, /^FLR-\d{3}$/], [seed.rooms, /^ROOM-\d{3}$/]] as const) {
      expect(new Set(list.map((item) => item.id)).size).toBe(list.length)
      for (const item of list) expect(item.id).toMatch(pattern)
    }
    for (const r of seed.rooms) {
      expect(seed.floors.find((floor) => floor.id === r.floorId)?.blockId).toBe(r.blockId)
      expect(isValidRoomCode(r.code)).toBe(true)
      expect(roomCodeFloorDigit(r.code)).toBe(seed.floors.find((floor) => floor.id === r.floorId)!.level)
      const { id: _id, ...input } = r
      void _id
      expect(validateRoomInput(input).ok).toBe(true)
    }
    expect(new Set(seed.rooms.map((r) => r.code)).size).toBe(seed.rooms.length)
  })

  it('uses generic room descriptions only', () => {
    const allowed = /^(|Training room|Seminar room|Computer lab|Lecture room|Studio|Meeting room|Former store|Workshop|Store|Library desk|Quiet study room|Group study room|IT help point|Old archive|Lecture theatre|Research room|Engineering workshop|Electronics lab)$/
    for (const r of seed.rooms) expect(r.displayName).toMatch(allowed)
  })
})

describe('the fictional audit seed: equipment types', () => {
  it('has eight types in order; only "Other" asks for a name', () => {
    expect(seed.equipmentTypes.map((type) => type.label)).toEqual(['Phone', 'Projector', 'TV', 'Dock', 'Speaker', 'Card Reader', 'Clevertouch Panel', 'Other'])
    expect(seed.equipmentTypes.map((type) => type.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(seed.equipmentTypes.filter((type) => type.requiresName).map((type) => type.id)).toEqual(['other'])
  })

  it('treats Clevertouch firmware as a check on the panel, not as equipment in its own right', () => {
    expect(seed.equipmentTypes.some((type) => /firmware/i.test(type.label) || /firmware/i.test(type.id))).toBe(false)
    const withChecks = seed.equipmentTypes.filter((type) => type.checks.length > 0)
    expect(withChecks.map((type) => type.id)).toEqual(['clevertouch-panel'])
    expect(withChecks[0].checks).toEqual([{ id: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update' }])
  })
})

describe('the fictional audit seed: equipment items', () => {
  const types = seed.equipmentTypes

  it('has 238 items: 236 active, one replaced and one removed', () => {
    expect(seed.items.length).toBe(238)
    expect(countStatus(seed.inspections, 'x')).toBe(0)
    expect(seed.items.filter((item) => item.status === 'Active').length).toBe(236)
    expect(seed.items.filter((item) => item.status === 'Replaced').length).toBe(1)
    expect(seed.items.filter((item) => item.status === 'Removed').length).toBe(1)
  })

  it('uses unique references; every item belongs to a real room and a real type', () => {
    expect(new Set(seed.items.map((item) => item.id)).size).toBe(seed.items.length)
    for (const item of seed.items) {
      expect(item.id).toMatch(/^EQP-\d{3}$/)
      expect(seed.rooms.some((r) => r.id === item.roomId)).toBe(true)
      expect(types.some((type) => type.id === item.equipmentTypeId)).toBe(true)
    }
  })

  it('passes the shared item validator, so names and identifiers follow the rules', () => {
    for (const item of seed.items) {
      const result = validateEquipmentItemInput(
        { roomId: item.roomId, equipmentTypeId: item.equipmentTypeId, name: item.name, assetTag: item.assetTag, serialNumber: item.serialNumber },
        types,
      )
      expect(result.ok, `${item.id}`).toBe(true)
    }
  })

  it('has asset tags that are valid and unique among active items, and serial numbers within the limit', () => {
    const tags = activeItems.map((item) => item.assetTag).filter((tag): tag is string => tag !== null)
    expect(new Set(tags).size).toBe(tags.length)
    for (const tag of tags) expect(ASSET_TAG_PATTERN.test(tag)).toBe(true)
    for (const item of seed.items) if (item.serialNumber) expect(item.serialNumber.length).toBeLessThanOrEqual(SERIAL_NUMBER_MAX)
  })

  it('shows every combination of identifiers: both, a tag only, a serial only, and neither', () => {
    expect(activeItems.filter((item) => item.assetTag && item.serialNumber).length).toBeGreaterThan(0)
    expect(activeItems.filter((item) => item.assetTag && !item.serialNumber).length).toBeGreaterThan(0)
    expect(activeItems.filter((item) => !item.assetTag && item.serialNumber).length).toBeGreaterThan(0)
    expect(activeItems.filter((item) => !item.assetTag && !item.serialNumber).length).toBeGreaterThan(0)
  })

  it('has exactly three active rooms with no equipment in the inventory', () => {
    const empty = seed.rooms.filter((r) => r.active && !activeItems.some((item) => item.roomId === r.id)).map((r) => r.code)
    expect(empty).toEqual(['B005', 'B006', 'S024'])
  })

  it('has rooms with two items of one type, and names them apart', () => {
    const duplicates = seed.rooms.filter((r) => {
      const counts = new Map<string, number>()
      for (const item of activeItems.filter((candidate) => candidate.roomId === r.id)) counts.set(item.equipmentTypeId, (counts.get(item.equipmentTypeId) ?? 0) + 1)
      return [...counts.values()].some((n) => n > 1)
    })
    expect(duplicates.length).toBeGreaterThanOrEqual(4)
    const lectureTheatre = activeItems.filter((item) => item.roomId === room('HE061').id && item.equipmentTypeId === 'projector')
    expect(lectureTheatre.map((item) => item.name)).toEqual(['Projector 1', 'Projector 2'])
  })

  it('requires a name for every item of the Other category', () => {
    for (const item of seed.items.filter((candidate) => candidate.equipmentTypeId === 'other')) expect(item.name.length).toBeGreaterThan(0)
  })

  it('has seven Clevertouch panels', () => {
    expect(seed.items.filter((item) => item.equipmentTypeId === 'clevertouch-panel').length).toBe(7)
  })

  it('records a replacement: the old item is kept as Replaced and the new one links to it', () => {
    const old = seed.items.find((item) => item.status === 'Replaced')!
    const replacement = seed.items.find((item) => item.replacesItemId === old.id)!
    expect(replacement.status).toBe('Active')
    expect(replacement.roomId).toBe(old.roomId)
    expect(replacement.equipmentTypeId).toBe(old.equipmentTypeId)
    expect(codeOf(old.roomId)).toBe('B002')
  })

  it('records an item taken out of a room as Removed', () => {
    const removed = seed.items.find((item) => item.status === 'Removed')!
    expect(codeOf(removed.roomId)).toBe('L043')
    expect(removed.equipmentTypeId).toBe('tv')
  })

  it('flags exactly one item found during an inspection for review, linked to that inspection', () => {
    const found = seed.items.filter((item) => item.source === 'Found during inspection')
    expect(found.length).toBe(1)
    expect(found[0]).toMatchObject({ reviewStatus: 'Needs review', name: 'Document camera', status: 'Active' })
    const inspection = seed.inspections.find((candidate) => candidate.id === found[0].addedInInspectionId)!
    expect(inspection.cycleId).toBe(cycle('Summer 2026').id) // found, and flagged, during a closed cycle: still waiting for review
    expect(inspection.status).toBe('Completed')
    expect(inspection.roomId).toBe(found[0].roomId)
    expect(codeOf(found[0].roomId)).toBe('B103')
    expect(inspection.results.some((result) => result.equipmentItemId === found[0].id)).toBe(true)
    expect(seed.items.filter((item) => item.reviewStatus === 'Needs review').length).toBe(1)
    expect(seed.items.filter((item) => item.source === 'Inventory').every((item) => item.reviewStatus === 'Confirmed' && item.addedInInspectionId === null)).toBe(true)
  })
})

describe('the fictional audit seed: cycles', () => {
  it('has Summer 2025 (closed), Summer 2026 (closed) and Summer 2027 (open), with fixed dates', () => {
    expect(seed.cycles.map((c) => [c.id, c.name, c.year, c.status, c.startDate, c.endDate])).toEqual([
      ['CYC-001', 'Summer 2025', 2025, 'Closed', '2025-06-23', '2025-08-29'],
      ['CYC-002', 'Summer 2026', 2026, 'Closed', '2026-06-22', '2026-08-28'],
      ['CYC-003', 'Summer 2027', 2027, 'Open', '2027-06-21', '2027-08-27'],
    ])
  })

  it('has exactly one open cycle, and only closed cycles have a closing time', () => {
    expect(seed.cycles.filter((c) => c.status === 'Open').map((c) => c.name)).toEqual(['Summer 2027'])
    for (const c of seed.cycles) expect(c.closedAt === null).toBe(c.status === 'Open')
    for (const c of seed.cycles) expect(c.endDate > c.startDate).toBe(true)
  })

  it('has scopes of 67, 67 and 65 rooms: retired rooms are in the earlier cycles but not the open one', () => {
    expect(seed.cycles.map((c) => c.scopeRoomIds.length)).toEqual([67, 67, 65])
    for (const c of seed.cycles) {
      expect(new Set(c.scopeRoomIds).size).toBe(c.scopeRoomIds.length)
      for (const id of c.scopeRoomIds) expect(seed.rooms.some((r) => r.id === id)).toBe(true)
    }
    const retired = seed.rooms.filter((r) => !r.active).map((r) => r.id)
    expect(retired.every((id) => cycle('Summer 2025').scopeRoomIds.includes(id))).toBe(true)
    expect(retired.some((id) => cycle('Summer 2027').scopeRoomIds.includes(id))).toBe(false)
  })
})

describe('the fictional audit seed: inspections', () => {
  const byCycle = (name: string) => inspectionsOf(cycle(name).id)

  it('has the planned mix in each cycle', () => {
    const closed25 = byCycle('Summer 2025')
    const closed26 = byCycle('Summer 2026')
    expect([countStatus(closed25, 'Completed'), countStatus(closed25, 'In progress'), countStatus(closed25, 'Unable to inspect'), 67 - closed25.length]).toEqual([60, 0, 4, 3])
    expect([countStatus(closed26, 'Completed'), countStatus(closed26, 'In progress'), countStatus(closed26, 'Unable to inspect'), 67 - closed26.length]).toEqual([62, 0, 3, 2])
  })

  describe('the open cycle (Summer 2027)', () => {
    it('has NO inspections at all: nothing completed, nothing in progress, nothing unable to inspect', () => {
      expect(byCycle('Summer 2027')).toEqual([])
      expect(seed.inspections.some((inspection) => inspection.cycleId === cycle('Summer 2027').id)).toBe(false)
    })

    it('has all 65 rooms in its scope still to start, so its progress is zero', () => {
      const open = cycle('Summer 2027')
      expect(open.status).toBe('Open')
      expect(open.scopeRoomIds.length).toBe(65)
      const inspected = new Set(seed.inspections.map((inspection) => `${inspection.cycleId}/${inspection.roomId}`))
      expect(open.scopeRoomIds.filter((id) => inspected.has(`${open.id}/${id}`)).length).toBe(0)
    })

    it('dates nothing in the seed after the closed cycles: the only 2027 dates are the open cycle\'s planned window', () => {
      expect(JSON.stringify(seed.inspections)).not.toContain('2027')
      expect(JSON.stringify(seed.items)).not.toContain('2027')
      const latest = seed.inspections.map((inspection) => inspection.completedAt ?? inspection.startedAt).sort().at(-1)!
      expect(latest <= cycle('Summer 2026').closedAt!).toBe(true)
    })
  })

  it('has no draft in a closed cycle', () => {
    for (const name of ['Summer 2025', 'Summer 2026']) expect(countStatus(byCycle(name), 'In progress')).toBe(0)
  })

  it('has unique, sequential references, at most one inspection per room per cycle, and only rooms in scope', () => {
    expect(seed.inspections.map((i) => i.id)).toEqual(seed.inspections.map((_, index) => `INS-${String(index + 1).padStart(3, '0')}`))
    const seen = new Set<string>()
    for (const inspection of seed.inspections) {
      const key = `${inspection.cycleId}/${inspection.roomId}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
      expect(seed.cycles.find((c) => c.id === inspection.cycleId)!.scopeRoomIds).toContain(inspection.roomId)
    }
  })

  it('names a real technician as the inspector of every inspection', () => {
    const technicians = new Set(seedTechnicians.map((technician) => technician.id))
    for (const inspection of seed.inspections) expect(technicians.has(inspection.inspectorId)).toBe(true)
  })

  it('dates every inspection inside its cycle window, and completes nothing before it started', () => {
    for (const inspection of seed.inspections) {
      const c = seed.cycles.find((candidate) => candidate.id === inspection.cycleId)!
      const day = inspection.startedAt.slice(0, 10)
      expect(day >= c.startDate && day <= c.endDate).toBe(true)
      if (inspection.completedAt) expect(inspection.completedAt >= inspection.startedAt).toBe(true)
    }
  })

  it('completes only Completed inspections; drafts and unable rooms have no completion time', () => {
    for (const inspection of seed.inspections) expect(inspection.completedAt !== null).toBe(inspection.status === 'Completed')
  })

  it('gives every unable-to-inspect room a valid reason', () => {
    const unable = seed.inspections.filter((inspection) => inspection.status === 'Unable to inspect')
    expect(unable.length).toBe(7)
    for (const inspection of unable) {
      expect(inspection.attempts.length).toBeGreaterThanOrEqual(1)
      expect(inspection.results).toEqual([])
      for (const attempt of inspection.attempts) expect(validateUnableToInspectInput({ reason: attempt.reason }).ok).toBe(true)
    }
    for (const inspection of seed.inspections.filter((candidate) => candidate.status !== 'Unable to inspect')) expect(inspection.attempts).toEqual([])
  })

  it('records every completed inspection with no problem under the completion rule', () => {
    const asLine = (result: InspectionRecord['results'][number]): ChecklistLine => ({
      equipmentItemId: result.equipmentItemId,
      label: result.snapshot.equipmentTypeLabel,
      condition: result.condition,
      note: result.note,
      checks: result.checks,
    })
    const completed = seed.inspections.filter((inspection) => inspection.status === 'Completed')
    expect(completed.length).toBe(60 + 62)
    for (const inspection of completed) {
      expect(completionProblems(inspection.results.map(asLine), inspection.noEquipmentConfirmed), inspection.id).toEqual([])
    }
  })

  it('never has a "Not checked" line in a completed inspection', () => {
    for (const inspection of seed.inspections.filter((candidate) => candidate.status === 'Completed')) {
      for (const result of inspection.results) {
        expect(result.condition).not.toBe(NOT_CHECKED)
        expect(result.checkedAt).not.toBeNull()
        for (const check of result.checks) expect(check.condition).not.toBe(NOT_CHECKED)
      }
    }
  })

  it('has no draft anywhere in the seed, and so no "Not checked" line (drafts are exercised by the fixture and the shared rules)', () => {
    expect(seed.inspections.filter((inspection) => inspection.status === 'In progress')).toEqual([])
    for (const inspection of seed.inspections) {
      for (const result of inspection.results) {
        expect(result.condition).not.toBe(NOT_CHECKED)
        for (const check of result.checks) expect(check.condition).not.toBe(NOT_CHECKED)
      }
    }
  })

  it('records the explicit "no equipment" confirmation exactly for completed inspections that have no equipment lines', () => {
    for (const inspection of seed.inspections) {
      expect(inspection.noEquipmentConfirmed, inspection.id).toBe(inspection.status === 'Completed' && inspection.results.length === 0)
    }
  })

  it('confirms "no equipment" only for rooms whose inventory kit is empty, and for six completed inspections', () => {
    const confirmed = seed.inspections.filter((inspection) => inspection.noEquipmentConfirmed)
    expect(confirmed.length).toBe(6)
    const emptyKitRooms = new Set(['B005', 'B006', 'S024', 'B205', 'L145'])
    for (const inspection of confirmed) expect(emptyKitRooms.has(codeOf(inspection.roomId)), inspection.id).toBe(true)
  })

  it('uses every equipment condition somewhere in the completed results', () => {
    const used = new Set(seed.inspections.filter((i) => i.status === 'Completed').flatMap((i) => i.results.map((r) => r.condition)))
    for (const condition of EQUIPMENT_CONDITIONS) expect(used.has(condition)).toBe(true)
    expect(used.has('Missing')).toBe(true)
  })

  it('gives every Not working, Needs replacement and Missing result a note', () => {
    for (const inspection of seed.inspections.filter((i) => i.status === 'Completed')) {
      for (const result of inspection.results) {
        if (['Not working', 'Needs replacement', 'Missing'].includes(result.condition)) expect(result.note.trim().length, `${inspection.id}/${result.equipmentItemId}`).toBeGreaterThan(0)
      }
    }
  })

  it('only uses fictional note wording', () => {
    const allowed = new Set([
      '',
      'Picture cuts out after a few minutes', 'No sound from the output', 'Does not power on', 'Handset buzzes and drops calls', 'Reader does not recognise cards',
      'Cracked casing, beyond repair', 'End of life; spares no longer available', 'Burn marks on the power supply',
      'Not in the room; reported to the asset team', 'Mounting bracket empty, unit not found',
      'Cleaned the filter', 'Firmware two releases behind', 'Faulty when re-checked the next day',
    ])
    for (const inspection of seed.inspections) {
      expect(allowed.has(inspection.note)).toBe(true)
      for (const result of inspection.results) {
        expect(allowed.has(result.note)).toBe(true)
        for (const check of result.checks) expect(allowed.has(check.note)).toBe(true)
        for (const correction of result.corrections) expect(correction.reason.length).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('every line belongs to an item in the inspected room, with a snapshot of that item', () => {
    for (const inspection of seed.inspections) {
      for (const result of inspection.results) {
        const item = seed.items.find((candidate) => candidate.id === result.equipmentItemId)!
        expect(item.roomId).toBe(inspection.roomId)
        expect(result.inspectionId).toBe(inspection.id)
        expect(result.snapshot).toEqual({
          equipmentTypeId: item.equipmentTypeId,
          equipmentTypeLabel: seed.equipmentTypes.find((type) => type.id === item.equipmentTypeId)!.label,
          name: item.name,
          assetTag: item.assetTag,
          serialNumber: item.serialNumber,
        })
      }
    }
  })

  it('lists each item at most once per inspection', () => {
    for (const inspection of seed.inspections) expect(new Set(inspection.results.map((r) => r.equipmentItemId)).size).toBe(inspection.results.length)
  })

  it('asks the firmware check of every Clevertouch panel (and of nothing else), and not of a panel that is missing or not applicable', () => {
    for (const inspection of seed.inspections) {
      for (const result of inspection.results) {
        const isPanel = result.snapshot.equipmentTypeId === 'clevertouch-panel'
        expect(result.checks.map((check) => check.checkId)).toEqual(isPanel ? ['firmware'] : [])
        if (isPanel && ['Missing', 'Not applicable'].includes(result.condition)) expect(result.checks[0].condition).toBe('Not applicable')
        if (isPanel && inspection.status === 'Completed' && !['Missing', 'Not applicable'].includes(result.condition)) expect(['Working', 'Not working']).toContain(result.checks[0].condition)
      }
    }
    const answers = new Set(seed.inspections.flatMap((i) => i.results.flatMap((r) => r.checks.map((c) => c.condition))))
    expect(answers.has('Working') && answers.has('Not working')).toBe(true)
  })

  it('keeps a replaced or removed item to the cycles before it went, and the replacement out of every inspection so far', () => {
    const old = seed.items.find((item) => item.status === 'Replaced')!
    const replacement = seed.items.find((item) => item.replacesItemId === old.id)!
    const removed = seed.items.find((item) => item.status === 'Removed')!
    const cyclesWith = (itemId: string) => new Set(seed.inspections.filter((i) => i.results.some((r) => r.equipmentItemId === itemId)).map((i) => i.cycleId))
    expect(cyclesWith(old.id).has('CYC-003')).toBe(false)
    expect(cyclesWith(old.id).size).toBeGreaterThan(0)
    expect(cyclesWith(removed.id).has('CYC-003')).toBe(false)
    expect(cyclesWith(replacement.id).size).toBe(0) // it joins the checklist in Summer 2027, which has not started
  })

  it('records one correction, made during Summer 2026 while that cycle was still open, with a reason and the earlier answer kept', () => {
    const corrected = seed.inspections.flatMap((inspection) => inspection.results.map((result) => ({ inspection, result }))).filter(({ result }) => result.corrections.length > 0)
    expect(corrected.length).toBe(1)
    const { inspection, result } = corrected[0]
    const owner = seed.cycles.find((candidate) => candidate.id === inspection.cycleId)!
    expect(owner.name).toBe('Summer 2026')
    expect(inspection.status).toBe('Completed')
    const [correction] = result.corrections
    expect(correction.from.condition).toBe('Working')
    expect(correction.to.condition).toBe('Not working')
    expect(result.condition).toBe(correction.to.condition)
    expect(result.note).toBe(correction.to.note)
    expect(correction.reason.length).toBeGreaterThanOrEqual(3)
    expect(correction.changedAt > inspection.completedAt!).toBe(true)
    expect(correction.changedAt < owner.closedAt!).toBe(true) // a correction is only possible while the cycle is open
    expect(seedTechnicians.some((technician) => technician.id === correction.changedById)).toBe(true)
  })

  it('records every result line in a form the shared validator accepts', () => {
    for (const inspection of seed.inspections) {
      for (const result of inspection.results) {
        expect(validateResultDraftInput({ condition: result.condition, note: result.note, checks: result.checks }).ok, `${inspection.id}/${result.equipmentItemId}`).toBe(true)
      }
    }
  })

  it('has corrections on that one result only', () => {
    const withCorrections = seed.inspections.flatMap((inspection) => inspection.results).filter((result) => result.corrections.length > 0)
    expect(withCorrections.length).toBe(1)
  })
})

describe('the fictional audit seed: behaviour', () => {
  it('is deterministic: every build is identical, including every date', () => {
    expect(buildSeedAudit()).toEqual(buildSeedAudit())
    expect(seed.inspections[0].startedAt).toBe('2025-06-26T08:17:00.000Z')
    expect(seed.inspections.at(-1)!.startedAt).toBe('2026-08-08T12:33:00.000Z')
  })

  it('does not depend on the clock', () => {
    const real = Date.now
    Date.now = () => new Date('2031-01-01T00:00:00Z').getTime()
    try {
      expect(buildSeedAudit()).toEqual(seed)
    } finally {
      Date.now = real
    }
  })

  it('returns fresh objects each time, so one caller cannot change what another sees', () => {
    const first = buildSeedAudit()
    first.rooms[0].code = 'CHANGED'
    first.items[0].name = 'Changed'
    first.cycles[0].scopeRoomIds.push('ROOM-999')
    first.inspections[0].results[0].note = 'Changed'
    first.equipmentTypes[6].checks[0].label = 'Changed'
    const second = buildSeedAudit()
    expect(second.rooms[0].code).toBe('B001')
    expect(second.items[0].name).toBe('')
    expect(second.cycles[0].scopeRoomIds).not.toContain('ROOM-999')
    expect(second.inspections[0].results[0].note).not.toBe('Changed')
    expect(second.equipmentTypes[6].checks[0].label).toBe('Firmware')
  })

  it('contains no workbook labels: no sheet names, example notes or room labels from the source file', () => {
    const text = JSON.stringify(seed)
    for (const token of ['Test - Examples', 'AUDIT - TEMPLATE', 'water leak', 'Tutors', 'Blinds', 'L104A', 'S113']) expect(text).not.toContain(token)
  })
})
