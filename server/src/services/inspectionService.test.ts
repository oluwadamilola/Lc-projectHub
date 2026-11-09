import type { ApiErrorDetail, EquipmentItem, InspectionView } from '@lc-projecthub/shared'
import { describe, expect, it } from 'vitest'
import type { InspectionCycleRecord, InspectionRecord, InspectionRepository } from '../domain/auditRepository.js'
import { ConflictError, NotFoundError, ValidationError } from '../errors.js'
import type { InMemoryInspectionRepository } from '../repositories/inMemoryAuditRepositories.js'
import { buildFixtureAudit, fixtureCycles } from '../testing/auditFixtures.js'

/*
  The inspection workflow over the hand-checkable fixture (see testing/auditFixtures.ts). In the open cycle CYC-002:
    X001 ROOM-001  completed (INS-005)                       X002 ROOM-002  no equipment, not started
    X101 ROOM-004  in progress (INS-006): 2 of 3 answered    X102 ROOM-005  unable to inspect (INS-007), one active phone
    Y001 ROOM-006  not started, its only item (EQP-008) removed         X003 ROOM-003  retired, outside the cycle
  X101's lines: EQP-003 phone Working; EQP-004 panel Not checked (firmware Not checked); EQP-005 "Document camera" Not working, no note.
*/

const Y001_EQUIPMENT: EquipmentItem[] = (
  [
    ['EQP-009', 'projector', 'AT-009'],
    ['EQP-010', 'panel', null],
    ['EQP-011', 'phone', null],
  ] as const
).map(([id, equipmentTypeId, assetTag]) => ({
  id, roomId: 'ROOM-006', equipmentTypeId, name: '', assetTag, serialNumber: null, status: 'Active' as const,
  source: 'Inventory' as const, reviewStatus: 'Confirmed' as const, addedInInspectionId: null, replacesItemId: null,
}))

const withY001Equipment = async (clock?: () => Date) => {
  const { fixtureItems } = await import('../testing/auditFixtures.js')
  return buildFixtureAudit({ items: [...fixtureItems, ...Y001_EQUIPMENT], clock })
}

const TECH = { inspectorId: 'TECH-001' }
const closedOpenCycle: InspectionCycleRecord[] = fixtureCycles.map((cycle) => ({ ...cycle, status: 'Closed', closedAt: '2026-09-04T09:30:00.000Z' }))

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected the call to be rejected, but it succeeded.')
}
const fieldsOf = (error: unknown) => (error as ValidationError).details?.map((detail: ApiErrorDetail) => detail.field)

/** A wrapper that can be told to fail the next save, to show that a failed change leaves the old record. */
function flaky(repository: InMemoryInspectionRepository) {
  const state = { failNextSave: false }
  const wrapped: InspectionRepository = {
    listByCycle: (cycleId) => repository.listByCycle(cycleId),
    listByRoom: (roomId) => repository.listByRoom(roomId),
    findById: (id) => repository.findById(id),
    create: (input) => repository.create(input),
    save: async (record) => {
      if (state.failNextSave) {
        state.failNextSave = false
        throw new Error('disk full')
      }
      return repository.save(record)
    },
  }
  return { state, wrapped }
}

const stored = async (fixture: ReturnType<typeof buildFixtureAudit>, id: string): Promise<InspectionRecord> => (await fixture.repositories.inspections.findById(id))!

describe('InspectionService.start', () => {
  it('starts an inspection in the open cycle: in progress, with the chosen inspector, a start time and a not-checked line per active item', async () => {
    const fixture = await withY001Equipment()
    const { data, created } = await fixture.inspections.start('ROOM-006', TECH)
    expect(created).toBe(true)
    expect(data.id).toBe('INS-008')
    expect(data).toMatchObject({ status: 'In progress', inspectorId: 'TECH-001', inspectorName: 'Test Technician One', completedAt: null, noEquipmentConfirmed: false, attempts: [] })
    expect(data.startedAt).toMatch(/^2026-08-03T10:\d\d:00\.000Z$/)
    expect(data.cycle).toMatchObject({ id: 'CYC-002', status: 'Open' })
    expect(data.cycle).not.toHaveProperty('scopeRoomIds')
    expect(data.room).toMatchObject({ code: 'Y001', blockName: 'Y Block', floorName: 'Ground floor', active: true })
    expect(data.lines.map((line) => [line.id, line.typeLabel, line.current?.condition])).toEqual([
      ['EQP-011', 'Phone', 'Not checked'],
      ['EQP-009', 'Projector', 'Not checked'],
      ['EQP-010', 'Panel', 'Not checked'],
    ])
    expect(data.lines[1].assetTag).toBe('AT-009')
    expect(data.lines[2].current?.checks).toEqual([expect.objectContaining({ checkId: 'firmware', condition: 'Not checked', okLabel: 'Up to date', notOkLabel: 'Needs update' })])
    expect(data.progress).toEqual({ total: 3, checked: 0 })
    expect(data.completion.canComplete).toBe(false)
    expect(data.summary).toBeNull()
    const record = await stored(fixture, 'INS-008')
    expect(record.results.every((result) => result.inspectionId === 'INS-008' && result.checkedAt === null)).toBe(true)
  })

  it('is idempotent: starting again returns the same in-progress inspection, creates nothing, and keeps the first inspector', async () => {
    const fixture = await withY001Equipment()
    const first = await fixture.inspections.start('ROOM-006', TECH)
    const second = await fixture.inspections.start('ROOM-006', { inspectorId: 'TECH-002' })
    expect(second.created).toBe(false)
    expect(second.data.id).toBe(first.data.id)
    expect(second.data.inspectorId).toBe('TECH-001')
    expect(second.data.startedAt).toBe(first.data.startedAt)
    expect((await fixture.repositories.inspections.listByCycle('CYC-002')).filter((inspection) => inspection.roomId === 'ROOM-006')).toHaveLength(1)
  })

  it('creates exactly one inspection when many requests arrive at the same moment', async () => {
    const fixture = await withY001Equipment()
    const results = await Promise.all(Array.from({ length: 6 }, () => fixture.inspections.start('ROOM-006', TECH)))
    expect(results.filter((result) => result.created)).toHaveLength(1)
    expect(new Set(results.map((result) => result.data.id)).size).toBe(1)
    expect(await fixture.repositories.inspections.listByCycle('CYC-002')).toHaveLength(4)
  })

  it('resumes an unfinished inspection with its saved answers and progress', async () => {
    const fixture = buildFixtureAudit()
    const { data, created } = await fixture.inspections.start('ROOM-004', TECH)
    expect(created).toBe(false)
    expect(data.id).toBe('INS-006')
    expect(data.lines.map((line) => [line.id, line.current?.condition])).toEqual([['EQP-003', 'Working'], ['EQP-004', 'Not checked'], ['EQP-005', 'Not working']])
    expect(data.progress).toEqual({ total: 3, checked: 2 })
  })

  it('shows last time\'s completed answer beside each line, including the firmware check in its own words', async () => {
    const { data } = await buildFixtureAudit().inspections.start('ROOM-004', TECH)
    const phone = data.lines.find((line) => line.id === 'EQP-003')!
    const panel = data.lines.find((line) => line.id === 'EQP-004')!
    const found = data.lines.find((line) => line.id === 'EQP-005')!
    expect(phone.previous).toMatchObject({ cycleName: 'Summer 2025', condition: 'Working', inspectorName: 'Test Technician Two' })
    expect(panel.previous?.checks[0]).toMatchObject({ label: 'Firmware', condition: 'Not working', notOkLabel: 'Needs update' })
    expect(found.previous).toBeNull()
  })

  it('refuses to reopen a completed inspection', async () => {
    const fixture = buildFixtureAudit()
    const before = await stored(fixture, 'INS-005')
    const error = await rejection(fixture.inspections.start('ROOM-001', TECH))
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as Error).message).toMatch(/already been inspected in Summer 2026/)
    expect(await stored(fixture, 'INS-005')).toEqual(before)
  })

  it('lets a room that could not be inspected be tried again: the same record, in progress, with the attempt history kept', async () => {
    const fixture = buildFixtureAudit()
    const { data, created } = await fixture.inspections.start('ROOM-005', { inspectorId: 'TECH-002' })
    expect(created).toBe(false)
    expect(data).toMatchObject({ id: 'INS-007', status: 'In progress', inspectorId: 'TECH-002', completedAt: null })
    expect(data.attempts).toEqual([{ at: '2026-07-02T11:00:00.000Z', byId: 'TECH-001', byName: 'Test Technician One', reason: 'Room in use for teaching' }])
    expect(data.lines.map((line) => [line.id, line.current?.condition])).toEqual([['EQP-007', 'Not checked']])
    expect(data.startedAt).not.toBe('2026-07-02T11:00:00.000Z')
    expect((await fixture.repositories.inspections.listByRoom('ROOM-005')).filter((inspection) => inspection.cycleId === 'CYC-002')).toHaveLength(1)
  })

  it('refuses a retired room and a room outside the cycle scope', async () => {
    const fixture = buildFixtureAudit()
    const error = await rejection(fixture.inspections.start('ROOM-003', TECH))
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as Error).message).toMatch(/not part of Summer 2026/)
    expect(await fixture.repositories.inspections.listByRoom('ROOM-003')).toEqual([])
  })

  it('refuses a closed cycle, whether named or the only one, and when there is no open cycle at all', async () => {
    const fixture = buildFixtureAudit()
    const named = await rejection(fixture.inspections.start('ROOM-006', { ...TECH, cycleId: 'CYC-001' }))
    expect(named).toBeInstanceOf(ConflictError)
    expect((named as Error).message).toMatch(/Summer 2025 is closed/)
    const none = buildFixtureAudit({ cycles: closedOpenCycle })
    const error = await rejection(none.inspections.start('ROOM-006', TECH))
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as Error).message).toMatch(/no open inspection cycle/)
    expect(await none.repositories.inspections.listByRoom('ROOM-006')).toEqual([])
  })

  it('accepts the open cycle by name', async () => {
    const { data } = await buildFixtureAudit().inspections.start('ROOM-006', { ...TECH, cycleId: 'CYC-002' })
    expect(data.cycle.id).toBe('CYC-002')
  })

  it('answers 404-type errors for an unknown room or cycle, and validation errors for an unknown technician or a bad body', async () => {
    const fixture = buildFixtureAudit()
    expect(await rejection(fixture.inspections.start('ROOM-999', TECH))).toBeInstanceOf(NotFoundError)
    expect(await rejection(fixture.inspections.start('ROOM-006', { ...TECH, cycleId: 'CYC-999' }))).toBeInstanceOf(NotFoundError)
    const unknown = await rejection(fixture.inspections.start('ROOM-006', { inspectorId: 'TECH-099' }))
    expect(unknown).toBeInstanceOf(ValidationError)
    expect(fieldsOf(unknown)).toEqual(['inspectorId'])
    for (const body of [undefined, null, {}, { inspectorId: 'Riley' }, { inspectorId: 'TECH-001', extra: 1 }, { inspectorId: 'TECH-001', cycleId: 'summer' }, 'TECH-001']) {
      expect(await rejection(fixture.inspections.start('ROOM-006', body)), JSON.stringify(body)).toBeInstanceOf(ValidationError)
    }
    expect(await fixture.repositories.inspections.listByRoom('ROOM-006')).toEqual([])
  })
})

describe('InspectionService.saveResult', () => {
  it('saves a condition, stamps the time, and reports the new progress', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    const saved = (await fixture.inspections.saveResult(data.id, 'EQP-009', { condition: 'Working', note: '' })).data
    const line = saved.lines.find((entry) => entry.id === 'EQP-009')!
    expect(line.current).toMatchObject({ condition: 'Working', note: '' })
    expect(line.current?.checkedAt).toMatch(/^2026-08-03T10:/)
    expect(saved.progress).toEqual({ total: 3, checked: 1 })
    const record = await stored(fixture, data.id)
    expect(record.results.find((result) => result.equipmentItemId === 'EQP-009')!.condition).toBe('Working')
    expect(record.results.filter((result) => result.condition === 'Not checked')).toHaveLength(2)
  })

  it('accepts all five conditions, and a note for each', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    for (const [id, condition] of [['EQP-009', 'Not working'], ['EQP-010', 'Needs replacement'], ['EQP-011', 'Missing']] as const) {
      const response = await fixture.inspections.saveResult(data.id, id, { condition, note: `${condition} note` })
      expect(response.data.lines.find((line) => line.id === id)!.current).toMatchObject({ condition, note: `${condition} note` })
    }
    const na = await fixture.inspections.saveResult(data.id, 'EQP-009', { condition: 'Not applicable', note: '' })
    expect(na.data.lines.find((line) => line.id === 'EQP-009')!.current?.condition).toBe('Not applicable')
  })

  it('lets a required note be typed after the condition is chosen, but the inspection cannot complete without it', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    const saved = (await fixture.inspections.saveResult(data.id, 'EQP-011', { condition: 'Missing', note: '' })).data
    expect(saved.progress.checked).toBe(1)
    expect(saved.completion.problems.map((problem) => problem.field)).toContain('results.EQP-011')
    expect(saved.completion.problems.find((problem) => problem.field === 'results.EQP-011')!.message).toMatch(/add a note/)
  })

  it('replaces the line each time: changing the answer overwrites, "Not checked" clears the time', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    await fixture.inspections.saveResult(data.id, 'EQP-011', { condition: 'Not working', note: 'Handset dead' })
    const second = await fixture.inspections.saveResult(data.id, 'EQP-011', { condition: 'Working', note: '' })
    expect(second.data.lines.find((line) => line.id === 'EQP-011')!.current).toMatchObject({ condition: 'Working', note: '' })
    const cleared = await fixture.inspections.saveResult(data.id, 'EQP-011', { condition: 'Not checked', note: '' })
    const line = cleared.data.lines.find((entry) => entry.id === 'EQP-011')!
    expect(line.current).toMatchObject({ condition: 'Not checked', checkedAt: null })
    expect(cleared.data.progress.checked).toBe(0)
  })

  it('stores check answers, and a check that is not sent becomes "Not checked"', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    const answered = await fixture.inspections.saveResult(data.id, 'EQP-010', { condition: 'Working', note: '', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }] })
    expect(answered.data.lines.find((line) => line.id === 'EQP-010')!.current!.checks[0]).toMatchObject({ checkId: 'firmware', condition: 'Working' })
    const replaced = await fixture.inspections.saveResult(data.id, 'EQP-010', { condition: 'Working', note: '' })
    expect(replaced.data.lines.find((line) => line.id === 'EQP-010')!.current!.checks[0].condition).toBe('Not checked')
  })

  it('rejects invalid data and unknown checks without changing anything', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    const before = await stored(fixture, data.id)
    const bad: [string, unknown, string[]][] = [
      ['an unknown condition', { condition: 'Broken', note: '' }, ['condition']],
      ['a missing condition', { note: 'x' }, ['condition']],
      ['a note that is too long', { condition: 'Working', note: 'x'.repeat(501) }, ['note']],
      ['an unknown field', { condition: 'Working', note: '', colour: 'red' }, ['colour']],
      ['a body that is not an object', 'Working', ['body']],
      ['a check the type does not have', { condition: 'Working', note: '', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }] }, ['checks.0']],
    ]
    for (const [name, body, fields] of bad) {
      const target = name === 'a check the type does not have' ? 'EQP-009' : 'EQP-010'
      const error = await rejection(fixture.inspections.saveResult(data.id, target, body))
      expect(error, name).toBeInstanceOf(ValidationError)
      expect(fieldsOf(error), name).toEqual(fields)
    }
    const duplicate = await rejection(
      fixture.inspections.saveResult(data.id, 'EQP-010', { condition: 'Working', note: '', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }, { checkId: 'firmware', condition: 'Not working', note: 'x' }] }),
    )
    expect(fieldsOf(duplicate)).toEqual(['checks.1'])
    expect(await stored(fixture, data.id)).toEqual(before)
  })

  it('answers not found for an unknown inspection, and for an item that is not on this checklist', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    expect(await rejection(fixture.inspections.saveResult('INS-999', 'EQP-009', { condition: 'Working', note: '' }))).toBeInstanceOf(NotFoundError)
    expect(await rejection(fixture.inspections.saveResult(data.id, 'EQP-999', { condition: 'Working', note: '' }))).toBeInstanceOf(NotFoundError)
    expect(await rejection(fixture.inspections.saveResult(data.id, 'EQP-003', { condition: 'Working', note: '' }))).toBeInstanceOf(NotFoundError)
  })

  it('keeps both answers when two lines are saved at the same moment (no lost update)', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    await Promise.all([
      fixture.inspections.saveResult(data.id, 'EQP-009', { condition: 'Working', note: '' }),
      fixture.inspections.saveResult(data.id, 'EQP-010', { condition: 'Not applicable', note: '' }),
      fixture.inspections.saveResult(data.id, 'EQP-011', { condition: 'Missing', note: 'Gone' }),
    ])
    const record = await stored(fixture, data.id)
    expect(record.results.map((result) => [result.equipmentItemId, result.condition])).toEqual([
      ['EQP-011', 'Missing'], ['EQP-009', 'Working'], ['EQP-010', 'Not applicable'],
    ])
  })

  it('cannot change a completed or unable-to-inspect inspection, or one in a closed cycle', async () => {
    const fixture = buildFixtureAudit()
    const completed = await rejection(fixture.inspections.saveResult('INS-005', 'EQP-001', { condition: 'Missing', note: 'x' }))
    expect(completed).toBeInstanceOf(ConflictError)
    expect((completed as Error).message).toMatch(/already been completed/)
    const unable = await rejection(fixture.inspections.saveResult('INS-007', 'EQP-007', { condition: 'Working', note: '' }))
    expect(unable).toBeInstanceOf(ConflictError)
    expect((unable as Error).message).toMatch(/unable to inspect/)
    const closed = buildFixtureAudit({ cycles: closedOpenCycle })
    const closedError = await rejection(closed.inspections.saveResult('INS-006', 'EQP-003', { condition: 'Missing', note: 'x' }))
    expect(closedError).toBeInstanceOf(ConflictError)
    expect((closedError as Error).message).toMatch(/is closed/)
    expect((await stored(closed, 'INS-006')).results[0].condition).toBe('Working')
  })
})

describe('InspectionService.addEquipment', () => {
  const camera = { equipmentTypeId: 'other', name: 'Visualiser', assetTag: ' AT-NEW1 ', serialNumber: 'SN-NEW1' }

  it('adds the equipment to the inventory, flagged "Needs review", and to this checklist as a line still to check', async () => {
    const fixture = buildFixtureAudit()
    const response = await fixture.inspections.addEquipment('INS-006', camera)
    expect(response.equipmentItemId).toBe('EQP-009')
    const line = response.data.lines.find((entry) => entry.id === 'EQP-009')!
    expect(line).toMatchObject({ typeLabel: 'Other', name: 'Visualiser', assetTag: 'AT-NEW1', serialNumber: 'SN-NEW1', source: 'Found during inspection', reviewStatus: 'Needs review' })
    expect(line.current?.condition).toBe('Not checked')
    expect(response.data.progress).toEqual({ total: 4, checked: 2 })
    const item = (await fixture.repositories.items.findById('EQP-009'))!
    expect(item).toMatchObject({ roomId: 'ROOM-004', status: 'Active', source: 'Found during inspection', reviewStatus: 'Needs review', addedInInspectionId: 'INS-006', replacesItemId: null })
    const room = (await fixture.audit.getRoom('ROOM-004')).data
    expect(room.equipmentCount).toBe(4)
    expect(room.itemsNeedingReview).toBe(2)
    expect(room.equipment.find((entry) => entry.id === 'EQP-009')!.reviewStatus).toBe('Needs review')
  })

  it('gives a panel found in the room its firmware check', async () => {
    const fixture = buildFixtureAudit()
    const response = await fixture.inspections.addEquipment('INS-006', { equipmentTypeId: 'panel' })
    expect(response.data.lines.find((line) => line.id === response.equipmentItemId)!.current!.checks).toEqual([expect.objectContaining({ checkId: 'firmware', condition: 'Not checked' })])
  })

  it('withdraws a "no equipment" confirmation, because equipment has now been found', async () => {
    const fixture = buildFixtureAudit()
    const { data } = await fixture.inspections.start('ROOM-002', TECH)
    expect((await fixture.inspections.setNoEquipment(data.id, { confirmed: true })).data.noEquipmentConfirmed).toBe(true)
    const response = await fixture.inspections.addEquipment(data.id, { equipmentTypeId: 'phone' })
    expect(response.data.noEquipmentConfirmed).toBe(false)
    expect(response.data.lines).toHaveLength(1)
  })

  it('rejects invalid equipment without adding anything', async () => {
    const fixture = buildFixtureAudit()
    const before = (await fixture.repositories.items.listAll()).length
    const bad: [unknown, string[]][] = [
      [{ equipmentTypeId: 'other' }, ['name']],
      [{ equipmentTypeId: 'fridge' }, ['equipmentTypeId']],
      [{}, ['equipmentTypeId']],
      [{ equipmentTypeId: 'phone', assetTag: 'has space' }, ['assetTag']],
      [{ equipmentTypeId: 'phone', serialNumber: 'x'.repeat(61) }, ['serialNumber']],
      [{ equipmentTypeId: 'phone', colour: 'red' }, ['colour']],
      [{ equipmentTypeId: 'phone', roomId: 'ROOM-001' }, ['roomId']],
      ['phone', ['body']],
    ]
    for (const [body, fields] of bad) {
      const error = await rejection(fixture.inspections.addEquipment('INS-006', body))
      expect(error, JSON.stringify(body)).toBeInstanceOf(ValidationError)
      expect(fieldsOf(error), JSON.stringify(body)).toEqual(fields)
    }
    expect(await fixture.repositories.items.listAll()).toHaveLength(before)
  })

  it('accepts the room being inspected when it is named', async () => {
    const response = await buildFixtureAudit().inspections.addEquipment('INS-006', { equipmentTypeId: 'phone', roomId: 'ROOM-004' })
    expect(response.data.lines).toHaveLength(4)
  })

  it('refuses an asset tag already used by an active item (any letter case) with a conflict, and adds nothing', async () => {
    const fixture = buildFixtureAudit()
    for (const tag of ['AT-003', 'at-003']) {
      const error = await rejection(fixture.inspections.addEquipment('INS-006', { equipmentTypeId: 'phone', assetTag: tag }))
      expect(error).toBeInstanceOf(ConflictError)
      expect((error as Error).message).toMatch(/already used by EQP-003/)
    }
    expect(await fixture.repositories.items.listAll()).toHaveLength(8)
    expect((await stored(fixture, 'INS-006')).results).toHaveLength(3)
  })

  it('lets only one of two simultaneous requests with the same asset tag succeed', async () => {
    const fixture = buildFixtureAudit()
    const outcomes = await Promise.allSettled([
      fixture.inspections.addEquipment('INS-006', { equipmentTypeId: 'phone', assetTag: 'AT-RACE' }),
      fixture.inspections.addEquipment('INS-006', { equipmentTypeId: 'phone', assetTag: 'AT-RACE' }),
    ])
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
    const failure = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult
    expect(failure.reason).toBeInstanceOf(ConflictError)
    expect((await fixture.repositories.items.listAll()).filter((item) => item.assetTag === 'AT-RACE')).toHaveLength(1)
    expect((await stored(fixture, 'INS-006')).results).toHaveLength(4)
  })

  it('takes the new inventory entry out again if the checklist cannot be saved (nothing is left half-done)', async () => {
    let handle!: ReturnType<typeof flaky>
    const fixture = buildFixtureAudit({ wrapInspections: (repository) => (handle = flaky(repository)).wrapped })
    const before = await stored(fixture, 'INS-006')
    handle.state.failNextSave = true
    await expect(fixture.inspections.addEquipment('INS-006', { equipmentTypeId: 'phone' })).rejects.toThrow('disk full')
    expect(await fixture.repositories.items.listAll()).toHaveLength(8)
    expect(await fixture.repositories.items.findById('EQP-009')).toBeNull()
    expect(await stored(fixture, 'INS-006')).toEqual(before)
    const retry = await fixture.inspections.addEquipment('INS-006', { equipmentTypeId: 'phone' })
    expect(retry.equipmentItemId).toBe('EQP-009')
  })

  it('cannot be done to a completed, unable-to-inspect or unknown inspection', async () => {
    const fixture = buildFixtureAudit()
    expect(await rejection(fixture.inspections.addEquipment('INS-005', { equipmentTypeId: 'phone' }))).toBeInstanceOf(ConflictError)
    expect(await rejection(fixture.inspections.addEquipment('INS-007', { equipmentTypeId: 'phone' }))).toBeInstanceOf(ConflictError)
    expect(await rejection(fixture.inspections.addEquipment('INS-999', { equipmentTypeId: 'phone' }))).toBeInstanceOf(NotFoundError)
    expect(await fixture.repositories.items.listAll()).toHaveLength(8)
  })
})

describe('InspectionService.setNoEquipment', () => {
  it('confirms that a room with no equipment has none, and can take the statement back', async () => {
    const fixture = buildFixtureAudit()
    const { data } = await fixture.inspections.start('ROOM-002', TECH)
    expect(data.completion.problems.map((problem) => problem.field)).toEqual(['noEquipmentConfirmed'])
    const confirmed = await fixture.inspections.setNoEquipment(data.id, { confirmed: true })
    expect(confirmed.data.noEquipmentConfirmed).toBe(true)
    expect(confirmed.data.completion).toEqual({ canComplete: true, problems: [] })
    expect((await fixture.inspections.setNoEquipment(data.id, { confirmed: true })).data.noEquipmentConfirmed).toBe(true)
    expect((await fixture.inspections.setNoEquipment(data.id, { confirmed: false })).data.noEquipmentConfirmed).toBe(false)
  })

  it('does not count removed or replaced items as equipment in the room', async () => {
    const fixture = buildFixtureAudit()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    expect(data.lines).toEqual([])
    expect((await fixture.inspections.setNoEquipment(data.id, { confirmed: true })).data.noEquipmentConfirmed).toBe(true)
  })

  it('is rejected, with a conflict, when the room has active equipment', async () => {
    const fixture = buildFixtureAudit()
    const before = await stored(fixture, 'INS-006')
    const error = await rejection(fixture.inspections.setNoEquipment('INS-006', { confirmed: true }))
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as Error).message).toMatch(/3 items of equipment/)
    expect(await stored(fixture, 'INS-006')).toEqual(before)
  })

  it('is rejected once equipment has been found in a room that had none', async () => {
    const fixture = buildFixtureAudit()
    const { data } = await fixture.inspections.start('ROOM-002', TECH)
    await fixture.inspections.addEquipment(data.id, { equipmentTypeId: 'phone' })
    const error = await rejection(fixture.inspections.setNoEquipment(data.id, { confirmed: true }))
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as Error).message).toMatch(/1 item of equipment/)
  })

  it('rejects a body that is not true/false, and an inspection that cannot be changed', async () => {
    const fixture = buildFixtureAudit()
    for (const body of [{}, { confirmed: 'yes' }, { confirmed: true, extra: 1 }, null]) {
      expect(await rejection(fixture.inspections.setNoEquipment('INS-006', body)), JSON.stringify(body)).toBeInstanceOf(ValidationError)
    }
    expect(await rejection(fixture.inspections.setNoEquipment('INS-999', { confirmed: false }))).toBeInstanceOf(NotFoundError)
    expect(await rejection(fixture.inspections.setNoEquipment('INS-005', { confirmed: false }))).toBeInstanceOf(ConflictError)
  })
})

describe('InspectionService.markUnable', () => {
  it('records the reason, who recorded it and when, and the room can then be started again', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    const response = await fixture.inspections.markUnable(data.id, { reason: 'Room locked' })
    expect(response.data).toMatchObject({ status: 'Unable to inspect', completedAt: null, progress: { total: 3, checked: 0 }, noEquipmentConfirmed: false })
    expect(response.data.lines).toHaveLength(3)
    expect(response.data.attempts).toEqual([{ at: expect.stringMatching(/^2026-08-03T10:/), byId: 'TECH-001', byName: 'Test Technician One', reason: 'Room locked' }])
    expect(response.data.completion).toEqual({ canComplete: false, problems: [] })

    const room = (await fixture.audit.getRoom('ROOM-006')).data
    expect(room.inspection).toMatchObject({ status: 'Unable to inspect', unableReason: 'Room locked' })

    const again = await fixture.inspections.start('ROOM-006', { inspectorId: 'TECH-002' })
    expect(again.created).toBe(false)
    expect(again.data).toMatchObject({ id: data.id, status: 'In progress', inspectorId: 'TECH-002' })
    expect(again.data.lines).toHaveLength(3)
    const second = await fixture.inspections.markUnable(data.id, { reason: 'Room in use for teaching', inspectorId: 'TECH-002' })
    expect(second.data.attempts.map((attempt) => [attempt.byId, attempt.reason])).toEqual([['TECH-001', 'Room locked'], ['TECH-002', 'Room in use for teaching']])
  })

  it('records a different technician when one is named, and keeps the saved results and the equipment found', async () => {
    const fixture = buildFixtureAudit()
    const { data } = await fixture.inspections.start('ROOM-002', TECH)
    const added = await fixture.inspections.addEquipment(data.id, { equipmentTypeId: 'phone' })
    await fixture.inspections.saveResult(data.id, added.equipmentItemId, { condition: 'Working', note: '' })
    const before = (await stored(fixture, data.id)).results
    const response = await fixture.inspections.markUnable(data.id, { reason: 'Closed for building works', inspectorId: 'TECH-002' })
    expect(response.data.attempts[0]).toMatchObject({ byId: 'TECH-002', byName: 'Test Technician Two' })
    expect((await stored(fixture, data.id)).results).toEqual(before)
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ equipmentItemId: added.equipmentItemId, condition: 'Working' })
    expect(await fixture.repositories.items.findById(added.equipmentItemId)).toMatchObject({ reviewStatus: 'Needs review', status: 'Active' })
  })

  it('keeps the answers saved before, and the no-equipment confirmation, so starting again resumes without losing them', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    const [first, second] = data.lines
    await fixture.inspections.saveResult(data.id, first!.id, { condition: 'Not working', note: 'Lamp failed' })
    await fixture.inspections.saveResult(data.id, second!.id, { condition: 'Working', note: '' })
    await fixture.inspections.markUnable(data.id, { reason: 'Room needed for an exam' })

    const resumed = await fixture.inspections.start('ROOM-006', { inspectorId: 'TECH-002' })
    expect(resumed.created).toBe(false)
    expect(resumed.data.id).toBe(data.id)
    expect(resumed.data.status).toBe('In progress')
    expect(resumed.data.progress).toEqual({ total: 3, checked: 2 })
    expect(resumed.data.lines.map((line) => [line.id, line.current?.condition, line.current?.note])).toEqual(
      data.lines.map((line) => [line.id, line.id === first!.id ? 'Not working' : line.id === second!.id ? 'Working' : 'Not checked', line.id === first!.id ? 'Lamp failed' : '']),
    )
    expect(resumed.data.attempts).toHaveLength(1)
  })

  it('on resuming after unable, adds a line for equipment that joined the room meanwhile and drops lines for items no longer active', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    const [first, second] = data.lines
    await fixture.inspections.saveResult(data.id, first!.id, { condition: 'Working', note: '' })
    await fixture.inspections.markUnable(data.id, { reason: 'Room locked' })
    const newcomer = await fixture.repositories.items.create({
      roomId: 'ROOM-006', equipmentTypeId: 'phone', name: '', assetTag: null, serialNumber: null, status: 'Active', source: 'Inventory',
      reviewStatus: 'Confirmed', addedInInspectionId: null, replacesItemId: null,
    })
    await fixture.repositories.items.remove(second!.id)

    const resumed = await fixture.inspections.start('ROOM-006', TECH)
    const ids = resumed.data.lines.map((line) => line.id)
    expect(ids).toContain(newcomer.id)
    expect(ids).not.toContain(second!.id)
    expect(resumed.data.lines.find((line) => line.id === first!.id)?.current?.condition).toBe('Working')
    expect(resumed.data.lines.find((line) => line.id === newcomer.id)?.current?.condition).toBe('Not checked')
    expect((await stored(fixture, data.id)).results.every((result) => result.inspectionId === data.id)).toBe(true)
  })

  it('resuming an inspection that is already in progress keeps every answer and the original inspector', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    await fixture.inspections.saveResult(data.id, data.lines[0]!.id, { condition: 'Needs replacement', note: 'Cracked' })
    const again = await fixture.inspections.start('ROOM-006', { inspectorId: 'TECH-002' })
    expect(again.created).toBe(false)
    expect(again.data.inspectorId).toBe('TECH-001')
    expect(again.data.progress.checked).toBe(1)
    expect(again.data.lines[0]!.current).toMatchObject({ condition: 'Needs replacement', note: 'Cracked' })
  })

  it('rejects a missing or too short reason, an unknown technician and unknown fields', async () => {
    const fixture = buildFixtureAudit()
    const before = await stored(fixture, 'INS-006')
    const bad: [unknown, string[]][] = [
      [{}, ['reason']],
      [{ reason: '' }, ['reason']],
      [{ reason: 'no' }, ['reason']],
      [{ reason: 'x'.repeat(301) }, ['reason']],
      [{ reason: 'Room locked', colour: 'red' }, ['colour']],
      [{ reason: 'Room locked', inspectorId: 'Riley' }, ['inspectorId']],
      [{ reason: 'no', inspectorId: 'Riley' }, ['reason', 'inspectorId']],
      ['Room locked', ['body']],
    ]
    for (const [body, fields] of bad) {
      const error = await rejection(fixture.inspections.markUnable('INS-006', body))
      expect(error, JSON.stringify(body)).toBeInstanceOf(ValidationError)
      expect(fieldsOf(error), JSON.stringify(body)).toEqual(fields)
    }
    const unknown = await rejection(fixture.inspections.markUnable('INS-006', { reason: 'Room locked', inspectorId: 'TECH-099' }))
    expect(unknown).toBeInstanceOf(ValidationError)
    expect(await stored(fixture, 'INS-006')).toEqual(before)
  })

  it('cannot be recorded twice, or for a completed or unknown inspection', async () => {
    const fixture = buildFixtureAudit()
    expect(await rejection(fixture.inspections.markUnable('INS-007', { reason: 'Room locked' }))).toBeInstanceOf(ConflictError)
    expect(await rejection(fixture.inspections.markUnable('INS-005', { reason: 'Room locked' }))).toBeInstanceOf(ConflictError)
    expect(await rejection(fixture.inspections.markUnable('INS-999', { reason: 'Room locked' }))).toBeInstanceOf(NotFoundError)
    expect((await stored(fixture, 'INS-007')).attempts).toHaveLength(1)
  })
})

describe('InspectionService.complete', () => {
  /** Everything INS-006 needs: the panel answered with its firmware check, and the found camera given its note. */
  async function finishX101(fixture: ReturnType<typeof buildFixtureAudit>) {
    await fixture.inspections.saveResult('INS-006', 'EQP-004', { condition: 'Working', note: '', checks: [{ checkId: 'firmware', condition: 'Not working', note: 'Needs update' }] })
    return fixture.inspections.saveResult('INS-006', 'EQP-005', { condition: 'Not working', note: 'Lens cracked' })
  }

  it('refuses an incomplete checklist and lists every problem: unchecked items, missing notes and unanswered firmware checks', async () => {
    const fixture = buildFixtureAudit()
    const before = await stored(fixture, 'INS-006')
    const error = await rejection(fixture.inspections.complete('INS-006'))
    expect(error).toBeInstanceOf(ValidationError)
    expect(fieldsOf(error)).toEqual(['results.EQP-004', 'results.EQP-005'])
    expect((error as ValidationError).details![0].message).toBe('Panel has not been checked.')
    expect((error as ValidationError).details![1].message).toMatch(/Other: Document camera.*add a note/)
    expect(await stored(fixture, 'INS-006')).toEqual(before)

    await fixture.inspections.saveResult('INS-006', 'EQP-004', { condition: 'Working', note: '' })
    const firmware = await rejection(fixture.inspections.complete('INS-006'))
    expect(fieldsOf(firmware)).toEqual(['results.EQP-004.checks.firmware', 'results.EQP-005'])
    await fixture.inspections.saveResult('INS-006', 'EQP-004', { condition: 'Working', note: '', checks: [{ checkId: 'firmware', condition: 'Not working', note: '' }] })
    const note = await rejection(fixture.inspections.complete('INS-006'))
    expect(fieldsOf(note)).toEqual(['results.EQP-004.checks.firmware', 'results.EQP-005'])
    expect((await stored(fixture, 'INS-006')).status).toBe('In progress')
  })

  it('reports what is missing before completion is attempted, using the same rule', async () => {
    const fixture = buildFixtureAudit()
    const before = (await fixture.inspections.get('INS-006')).data
    expect(before.completion.canComplete).toBe(false)
    expect(before.completion.problems).toHaveLength(2)
    const after = (await finishX101(fixture)).data
    expect(after.completion).toEqual({ canComplete: true, problems: [] })
    expect(after.progress).toEqual({ total: 3, checked: 3 })
  })

  it('completes a finished checklist and returns the summary of what was found', async () => {
    const fixture = buildFixtureAudit()
    await finishX101(fixture)
    const { data } = await fixture.inspections.complete('INS-006')
    expect(data.status).toBe('Completed')
    expect(data.completedAt).toMatch(/^2026-08-03T10:/)
    expect(data.completion).toEqual({ canComplete: false, problems: [] })
    expect(data.summary).toEqual({
      totalItems: 3,
      counts: { Working: 2, 'Not working': 1, 'Needs replacement': 0, Missing: 0, 'Not applicable': 0 },
      issues: [{ equipmentItemId: 'EQP-005', label: 'Other: Document camera', kind: 'Fault', condition: 'Not working', note: 'Lens cracked' }],
      checkIssues: [{ equipmentItemId: 'EQP-004', label: 'Panel', checkId: 'firmware', checkLabel: 'Firmware', answer: 'Needs update', note: 'Needs update' }],
      foundItems: [{ equipmentItemId: 'EQP-005', label: 'Other: Document camera' }],
      noEquipmentConfirmed: false,
    })
    expect((await stored(fixture, 'INS-006')).completedAt).toBe(data.completedAt)
  })

  it('turns Not working, Needs replacement and Missing into Fault, Replacement required and Missing issues; Not applicable is only counted', async () => {
    const fixture = await withY001Equipment()
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    await fixture.inspections.saveResult(data.id, 'EQP-011', { condition: 'Needs replacement', note: 'Cracked handset' })
    await fixture.inspections.saveResult(data.id, 'EQP-009', { condition: 'Missing', note: 'Taken for repair' })
    await fixture.inspections.saveResult(data.id, 'EQP-010', { condition: 'Not applicable', note: '' })
    const { data: done } = await fixture.inspections.complete(data.id)
    expect(done.summary!.issues.map((issue) => [issue.equipmentItemId, issue.kind, issue.condition, issue.note])).toEqual([
      ['EQP-011', 'Replacement required', 'Needs replacement', 'Cracked handset'],
      ['EQP-009', 'Missing', 'Missing', 'Taken for repair'],
    ])
    expect(done.summary!.counts).toEqual({ Working: 0, 'Not working': 0, 'Needs replacement': 1, Missing: 1, 'Not applicable': 1 })
    expect(done.summary!.checkIssues).toEqual([])
  })

  it('needs the explicit confirmation to complete a room with no equipment, and records it in the summary', async () => {
    const fixture = buildFixtureAudit()
    const { data } = await fixture.inspections.start('ROOM-002', TECH)
    expect(fieldsOf(await rejection(fixture.inspections.complete(data.id)))).toEqual(['noEquipmentConfirmed'])
    await fixture.inspections.setNoEquipment(data.id, { confirmed: true })
    const { data: done } = await fixture.inspections.complete(data.id)
    expect(done.status).toBe('Completed')
    expect(done.summary).toMatchObject({ totalItems: 0, noEquipmentConfirmed: true, issues: [] })
  })

  it('refuses a second submission with a conflict and changes nothing', async () => {
    const fixture = buildFixtureAudit()
    await finishX101(fixture)
    const first = (await fixture.inspections.complete('INS-006')).data
    const recorded = await stored(fixture, 'INS-006')
    const error = await rejection(fixture.inspections.complete('INS-006'))
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as Error).message).toMatch(/already been completed/)
    expect(await stored(fixture, 'INS-006')).toEqual(recorded)
    expect(recorded.completedAt).toBe(first.completedAt)
  })

  it('completes exactly once when the same request is submitted twice at the same moment', async () => {
    const fixture = buildFixtureAudit()
    await finishX101(fixture)
    const outcomes = await Promise.allSettled([fixture.inspections.complete('INS-006'), fixture.inspections.complete('INS-006'), fixture.inspections.complete('INS-006')])
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled') as PromiseFulfilledResult<{ data: InspectionView }>[]
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected') as PromiseRejectedResult[]
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(2)
    expect(rejected.every((outcome) => outcome.reason instanceof ConflictError)).toBe(true)
    expect((await stored(fixture, 'INS-006')).completedAt).toBe(fulfilled[0].value.data.completedAt)
  })

  it('does not let a late save slip in behind a completion', async () => {
    const fixture = buildFixtureAudit()
    await finishX101(fixture)
    const [completion, late] = await Promise.allSettled([
      fixture.inspections.complete('INS-006'),
      fixture.inspections.saveResult('INS-006', 'EQP-003', { condition: 'Missing', note: 'Gone' }),
    ])
    expect(completion.status).toBe('fulfilled')
    expect(late.status).toBe('rejected')
    expect((await stored(fixture, 'INS-006')).results[0].condition).toBe('Working')
  })

  it('leaves a completed inspection untouched by every other change', async () => {
    const fixture = buildFixtureAudit()
    await finishX101(fixture)
    await fixture.inspections.complete('INS-006')
    const recorded = await stored(fixture, 'INS-006')
    const items = await fixture.repositories.items.listAll()
    const attempts = [
      fixture.inspections.saveResult('INS-006', 'EQP-003', { condition: 'Missing', note: 'x' }),
      fixture.inspections.addEquipment('INS-006', { equipmentTypeId: 'phone' }),
      fixture.inspections.setNoEquipment('INS-006', { confirmed: false }),
      fixture.inspections.markUnable('INS-006', { reason: 'Room locked' }),
      fixture.inspections.start('ROOM-004', TECH),
    ]
    for (const attempt of attempts) expect(await rejection(attempt)).toBeInstanceOf(ConflictError)
    expect(await stored(fixture, 'INS-006')).toEqual(recorded)
    expect(await fixture.repositories.items.listAll()).toEqual(items)
  })

  it('is all-or-nothing: if the record cannot be saved the inspection is still in progress, and completing again works', async () => {
    let handle!: ReturnType<typeof flaky>
    const fixture = buildFixtureAudit({ wrapInspections: (repository) => (handle = flaky(repository)).wrapped })
    await finishX101(fixture)
    const before = await stored(fixture, 'INS-006')
    handle.state.failNextSave = true
    await expect(fixture.inspections.complete('INS-006')).rejects.toThrow('disk full')
    expect(await stored(fixture, 'INS-006')).toEqual(before)
    expect((await fixture.inspections.get('INS-006')).data.status).toBe('In progress')
    expect((await fixture.inspections.complete('INS-006')).data.status).toBe('Completed')
  })

  it('also requires a line for equipment added to the inventory behind the inspector\'s back', async () => {
    const fixture = buildFixtureAudit()
    await finishX101(fixture)
    const added = await fixture.repositories.items.create({
      roomId: 'ROOM-004', equipmentTypeId: 'projector', name: '', assetTag: 'AT-LATE', serialNumber: null, status: 'Active',
      source: 'Inventory', reviewStatus: 'Confirmed', addedInInspectionId: null, replacesItemId: null,
    })
    const error = await rejection(fixture.inspections.complete('INS-006'))
    expect(error).toBeInstanceOf(ValidationError)
    expect(fieldsOf(error)).toEqual([`results.${added.id}`])
    expect((await fixture.inspections.get('INS-006')).data.completion.canComplete).toBe(false)
  })

  it('cannot complete an unable-to-inspect inspection, one in a closed cycle, or an unknown one', async () => {
    const fixture = buildFixtureAudit()
    expect(await rejection(fixture.inspections.complete('INS-007'))).toBeInstanceOf(ConflictError)
    expect(await rejection(fixture.inspections.complete('INS-999'))).toBeInstanceOf(NotFoundError)
    const closed = buildFixtureAudit({ cycles: closedOpenCycle })
    await finishX101(buildFixtureAudit())
    const error = await rejection(closed.inspections.complete('INS-006'))
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as Error).message).toMatch(/is closed/)
  })

  it('shows up in the room page and the cycle progress as soon as it is completed', async () => {
    const fixture = buildFixtureAudit()
    const before = (await fixture.audit.getCycle('CYC-002')).data.progress
    await finishX101(fixture)
    await fixture.inspections.complete('INS-006')
    const after = (await fixture.audit.getCycle('CYC-002')).data.progress
    expect([after.completed - before.completed, after.inProgress - before.inProgress]).toEqual([1, -1])
    const room = (await fixture.audit.getRoom('ROOM-004')).data
    expect(room.inspection).toMatchObject({ status: 'Completed', checkedLines: 3, totalLines: 3, inspectorName: 'Test Technician One' })
    expect(room.equipment.map((line) => line.current?.condition)).toEqual(['Working', 'Working', 'Not working'])
  })
})

describe('InspectionService.get', () => {
  it('shows a completed inspection from the seed with its summary, described as it was when inspected', async () => {
    const { data } = await buildFixtureAudit().inspections.get('INS-005')
    expect(data).toMatchObject({ status: 'Completed', inspectorName: 'Test Technician Two', progress: { total: 2, checked: 2 } })
    expect(data.summary!.issues).toEqual([{ equipmentItemId: 'EQP-002', label: 'Projector', kind: 'Replacement required', condition: 'Needs replacement', note: 'Beyond repair' }])
    expect(data.summary!.counts.Working).toBe(1)
    expect(data.lines[0].previous).toMatchObject({ cycleName: 'Summer 2025', condition: 'Working' })
  })

  it('shows an unable-to-inspect inspection with its attempts and no lines', async () => {
    const { data } = await buildFixtureAudit().inspections.get('INS-007')
    expect(data).toMatchObject({ status: 'Unable to inspect', lines: [], summary: null })
    expect(data.attempts).toEqual([{ at: '2026-07-02T11:00:00.000Z', byId: 'TECH-001', byName: 'Test Technician One', reason: 'Room in use for teaching' }])
  })

  it('answers not found for an unknown inspection', async () => {
    expect(await rejection(buildFixtureAudit().inspections.get('INS-999'))).toBeInstanceOf(NotFoundError)
  })

  it('does not hand out anything the caller can use to change the stored record', async () => {
    const fixture = buildFixtureAudit()
    const first = (await fixture.inspections.get('INS-006')).data
    first.lines[0].current!.condition = 'Missing'
    first.attempts.push({ at: 'x', byId: 'y', byName: null, reason: 'z' })
    expect((await fixture.inspections.get('INS-006')).data.lines[0].current!.condition).toBe('Working')
  })
})

describe('InspectionService cycle dates (injectable clock)', () => {
  // The open fixture cycle, CYC-002, runs from 2026-06-22 to 2026-08-28 inclusive.
  const at = (iso: string) => {
    const state = { now: new Date(iso) }
    return { state, clock: () => state.now }
  }

  it('refuses to start before the cycle opens and after it ends, with a message naming the date', async () => {
    const { state, clock } = at('2026-06-21T23:59:59.000Z')
    const fixture = buildFixtureAudit({ clock })
    const countBefore = (await fixture.repositories.inspections.listByCycle('CYC-002')).length
    const early = await rejection(fixture.inspections.start('ROOM-006', TECH))
    expect(early).toBeInstanceOf(ConflictError)
    expect((early as Error).message).toMatch(/opens on 2026-06-22/)

    state.now = new Date('2026-08-29T00:00:00.000Z')
    const late = await rejection(fixture.inspections.start('ROOM-006', TECH))
    expect(late).toBeInstanceOf(ConflictError)
    expect((late as Error).message).toMatch(/ended on 2026-08-28/)
    expect(await fixture.repositories.inspections.listByCycle('CYC-002')).toHaveLength(countBefore)
  })

  it('allows the first and the last day of the cycle', async () => {
    const { state, clock } = at('2026-06-22T00:00:00.000Z')
    const fixture = buildFixtureAudit({ clock })
    const first = await fixture.inspections.start('ROOM-006', TECH)
    expect(first.created).toBe(true)
    state.now = new Date('2026-08-28T23:59:59.000Z')
    expect((await fixture.inspections.start('ROOM-006', TECH)).created).toBe(false)
  })

  it('freezes every change to an in-progress inspection once the window has ended, and leaves it untouched', async () => {
    const { state, clock } = at('2026-08-10T09:00:00.000Z')
    const fixture = await withY001Equipment(clock)
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    const itemId = data.lines[0]!.id
    const before = await fixture.repositories.inspections.findById(data.id)

    state.now = new Date('2026-08-29T09:00:00.000Z')
    const attempts: Promise<unknown>[] = [
      fixture.inspections.saveResult(data.id, itemId, { condition: 'Working', note: '' }),
      fixture.inspections.addEquipment(data.id, { equipmentTypeId: 'phone' }),
      fixture.inspections.setNoEquipment(data.id, { confirmed: false }),
      fixture.inspections.markUnable(data.id, { reason: 'Room locked' }),
      fixture.inspections.complete(data.id),
    ]
    for (const attempt of attempts) {
      const error = await rejection(attempt)
      expect(error).toBeInstanceOf(ConflictError)
      expect((error as Error).message).toMatch(/ended on 2026-08-28/)
    }
    expect(await fixture.repositories.inspections.findById(data.id)).toEqual(before)
    // Reading is still allowed.
    expect((await fixture.inspections.get(data.id)).data.status).toBe('In progress')
  })

  it('refuses writes before the window opens too, and a closed cycle is still reported as closed', async () => {
    const { state, clock } = at('2026-08-10T09:00:00.000Z')
    const fixture = buildFixtureAudit({ clock })
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    state.now = new Date('2026-06-01T00:00:00.000Z')
    const error = await rejection(fixture.inspections.complete(data.id))
    expect((error as Error).message).toMatch(/opens on 2026-06-22/)
    const closed = await rejection(fixture.inspections.start('ROOM-002', { inspectorId: 'TECH-001', cycleId: 'CYC-001' }))
    expect((closed as Error).message).toMatch(/closed/)
  })

  it('uses the clock for timestamps and for the window, so a moving clock behaves consistently', async () => {
    const { state, clock } = at('2026-07-01T08:00:00.000Z')
    const fixture = await withY001Equipment(clock)
    const { data } = await fixture.inspections.start('ROOM-006', TECH)
    expect(data.startedAt).toBe('2026-07-01T08:00:00.000Z')
    state.now = new Date('2026-07-02T08:30:00.000Z')
    const saved = await fixture.inspections.saveResult(data.id, data.lines[0]!.id, { condition: 'Working', note: '' })
    expect((await fixture.repositories.inspections.findById(data.id))!.results[0]!.checkedAt).toBe('2026-07-02T08:30:00.000Z')
    expect(saved.data.progress.checked).toBe(1)
  })
})
