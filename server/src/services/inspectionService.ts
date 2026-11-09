import type {
  ApiErrorDetail,
  AddEquipmentResponse,
  Block,
  CheckResult,
  ChecklistLine,
  EquipmentCondition,
  EquipmentItem,
  EquipmentLine,
  EquipmentType,
  Floor,
  InspectionCycle,
  InspectionResponse,
  InspectionResult,
  InspectionSummary,
  InspectionView,
  IssueKind,
  Room,
} from '@lc-projecthub/shared'
import {
  EQUIPMENT_CONDITIONS,
  NOT_CHECKED,
  completionProblems,
  isPlainObject,
  validateEquipmentItemInput,
  validateNoEquipmentInput,
  validateOptionalInspectorId,
  validateResultDraftInput,
  validateStartInspectionInput,
  validateUnableToInspectInput,
} from '@lc-projecthub/shared'
import type {
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
import { ConflictError, NotFoundError, ValidationError } from '../errors.js'
import { earlierCompleted, summariseResult } from './auditResults.js'

/** Reads the clock. Injected so tests can fix the time; production uses the real one. */
export type Clock = () => Date

const ISSUE_KINDS_BY_CONDITION: Partial<Record<EquipmentCondition, IssueKind>> = {
  'Not working': 'Fault',
  'Needs replacement': 'Replacement required',
  Missing: 'Missing',
}

const publicCycle = ({ scopeRoomIds: _scope, ...cycle }: InspectionCycleRecord): InspectionCycle => {
  void _scope
  return cycle
}

const naturalOrder = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

/** Everything a request needs besides the inspection itself, loaded once so the response agrees with itself. */
interface Reference {
  blocks: Block[]
  floors: Floor[]
  types: EquipmentType[]
  items: EquipmentItem[]
  cycles: InspectionCycleRecord[]
  technicianNames: Map<string, string>
}

/**
 * Carrying out a room inspection (Stage 2a): start or resume it, save each line as it is answered, add equipment
 * found in the room, say a room has none, record that the room could not be inspected, and complete it.
 *
 * Every change runs one at a time (`exclusive`). In this single-process, in-memory build that is what makes
 * "start" idempotent under concurrent requests and makes a double-submitted "complete" safe: the second request
 * always sees the first one's result. A database version would get the same guarantee from a transaction.
 * Each change replaces the whole inspection record in one repository call, so a failure leaves the old record.
 */
export class InspectionService {
  private readonly blocks: BlockRepository
  private readonly floors: FloorRepository
  private readonly rooms: RoomRepository
  private readonly equipmentTypes: EquipmentTypeRepository
  private readonly equipmentItems: EquipmentItemRepository
  private readonly cycles: CycleRepository
  private readonly inspections: InspectionRepository
  private readonly technicians: TechnicianRepository
  private readonly clock: Clock
  /** The end of the queue of changes: the next change starts when this settles. */
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    blocks: BlockRepository,
    floors: FloorRepository,
    rooms: RoomRepository,
    equipmentTypes: EquipmentTypeRepository,
    equipmentItems: EquipmentItemRepository,
    cycles: CycleRepository,
    inspections: InspectionRepository,
    technicians: TechnicianRepository,
    clock: Clock = () => new Date(),
  ) {
    this.blocks = blocks
    this.floors = floors
    this.rooms = rooms
    this.equipmentTypes = equipmentTypes
    this.equipmentItems = equipmentItems
    this.cycles = cycles
    this.inspections = inspections
    this.technicians = technicians
    this.clock = clock
  }

  /* ---- Reading ---- */

  async get(inspectionId: string): Promise<InspectionResponse> {
    const inspection = await this.requireInspection(inspectionId)
    return { data: await this.view(inspection) }
  }

  /* ---- Starting ---- */

  /**
   * Starts an inspection of the room in the open cycle (or the cycle named), or returns the one already in
   * progress. A room that could not be inspected earlier is picked up again by the same record, keeping the
   * history of attempts. `created` is true only when a new inspection record was made.
   */
  start(roomId: string, rawInput: unknown): Promise<{ data: InspectionView; created: boolean }> {
    return this.exclusive(async () => {
      const parsed = validateStartInspectionInput(rawInput)
      if (!parsed.ok) throw new ValidationError(parsed.errors)
      const { inspectorId, cycleId } = parsed.value
      await this.requireTechnician(inspectorId, 'inspectorId')

      const room = await this.rooms.findById(roomId)
      if (!room) throw new NotFoundError(`Room ${roomId} was not found.`)

      const cycles = await this.cycles.list()
      let cycle: InspectionCycleRecord | undefined
      if (cycleId) {
        cycle = cycles.find((candidate) => candidate.id === cycleId)
        if (!cycle) throw new NotFoundError(`Cycle ${cycleId} was not found.`)
      } else {
        cycle = cycles.find((candidate) => candidate.status === 'Open')
        if (!cycle) throw new ConflictError('There is no open inspection cycle, so no inspection can be started.')
      }
      if (cycle.status !== 'Open') throw new ConflictError(`${cycle.name} is closed, so rooms can no longer be inspected in it.`)
      this.requireWithinWindow(cycle)
      if (!room.active || !cycle.scopeRoomIds.includes(room.id)) {
        throw new ConflictError(`Room ${room.code} is not part of ${cycle.name}, so it cannot be inspected in it.`)
      }

      const existing = (await this.inspections.listByCycle(cycle.id)).find((inspection) => inspection.roomId === room.id)
      if (existing?.status === 'Completed') {
        throw new ConflictError(`Room ${room.code} has already been inspected in ${cycle.name}; a completed inspection cannot be reopened.`)
      }
      if (existing?.status === 'In progress') return { data: await this.view(existing), created: false }

      const results = await this.freshChecklist(room.id)
      if (existing) {
        // Another attempt after "unable to inspect": the same record, now in progress again. The attempts and every
        // answer saved before are kept; only items that have since joined the room's inventory get new lines, and
        // lines for items that are no longer active are dropped (they could never be completed).
        const kept = new Map(existing.results.map((result) => [result.equipmentItemId, result]))
        const resumed: InspectionRecord = {
          ...existing,
          status: 'In progress',
          inspectorId,
          startedAt: this.now(),
          completedAt: null,
          results: results.map((fresh) => kept.get(fresh.equipmentItemId) ?? { ...fresh, inspectionId: existing.id }),
        }
        return { data: await this.view(await this.persist(resumed)), created: false }
      }
      const created = await this.inspections.create({
        cycleId: cycle.id,
        roomId: room.id,
        status: 'In progress',
        inspectorId,
        startedAt: this.now(),
        completedAt: null,
        note: '',
        noEquipmentConfirmed: false,
        attempts: [],
        results,
      })
      return { data: await this.view(created), created: true }
    })
  }

  /* ---- Saving one line ---- */

  /** Replaces one line of an in-progress checklist: its condition, note and the answers to any extra checks. */
  saveResult(inspectionId: string, itemId: string, rawInput: unknown): Promise<InspectionResponse> {
    return this.exclusive(async () => {
      const parsed = validateResultDraftInput(rawInput)
      if (!parsed.ok) throw new ValidationError(parsed.errors)
      const inspection = await this.requireInProgress(inspectionId)
      const line = inspection.results.find((result) => result.equipmentItemId === itemId)
      if (!line) throw new NotFoundError(`Item ${itemId} is not on the checklist of inspection ${inspection.id}.`)

      const type = (await this.equipmentTypes.list()).find((candidate) => candidate.id === line.snapshot.equipmentTypeId)
      if (!type) throw new NotFoundError(`The equipment type of item ${itemId} was not found.`)

      const { condition, note, checks } = parsed.value
      const errors: ApiErrorDetail[] = []
      const seen = new Set<string>()
      checks.forEach((check, index) => {
        if (!type.checks.some((definition) => definition.id === check.checkId)) {
          errors.push({ field: `checks.${index}`, message: `${type.label} has no "${check.checkId}" check.` })
        } else if (seen.has(check.checkId)) {
          errors.push({ field: `checks.${index}`, message: `The "${check.checkId}" check is given more than once.` })
        }
        seen.add(check.checkId)
      })
      if (errors.length > 0) throw new ValidationError(errors)

      // The line always carries one answer per check the type defines; any not sent are "Not checked".
      const answers: CheckResult[] = type.checks.map(
        (definition) => checks.find((check) => check.checkId === definition.id) ?? { checkId: definition.id, condition: NOT_CHECKED, note: '' },
      )
      const updated: InspectionResult = {
        ...line,
        condition,
        note,
        checks: answers,
        checkedAt: condition === NOT_CHECKED ? null : this.now(),
      }
      const saved = await this.persist({ ...inspection, results: inspection.results.map((result) => (result === line ? updated : result)) })
      return { data: await this.view(saved) }
    })
  }

  /* ---- Equipment found in the room ---- */

  /**
   * Adds equipment the inspector found to the inventory (flagged "Needs review") and to this checklist, together.
   * If the checklist cannot be saved the new inventory entry is taken out again.
   */
  addEquipment(inspectionId: string, rawInput: unknown): Promise<AddEquipmentResponse> {
    return this.exclusive(async () => {
      const inspection = await this.requireInProgress(inspectionId)
      const types = await this.equipmentTypes.list()

      if (isPlainObject(rawInput) && rawInput.roomId !== undefined && rawInput.roomId !== inspection.roomId) {
        throw new ValidationError([{ field: 'roomId', message: 'The equipment is added to the room being inspected; leave the room out or use that room.' }])
      }
      const parsed = validateEquipmentItemInput(isPlainObject(rawInput) ? { ...rawInput, roomId: inspection.roomId } : rawInput, types)
      if (!parsed.ok) throw new ValidationError(parsed.errors)
      const { equipmentTypeId, name, assetTag, serialNumber } = parsed.value
      const type = types.find((candidate) => candidate.id === equipmentTypeId)!

      const items = await this.equipmentItems.listAll()
      if (assetTag) {
        const clash = items.find((item) => item.status === 'Active' && item.assetTag?.toLowerCase() === assetTag.toLowerCase())
        if (clash) throw new ConflictError(`Asset tag ${assetTag} is already used by ${clash.id}.`)
      }

      const item = await this.equipmentItems.create({
        roomId: inspection.roomId,
        equipmentTypeId,
        name,
        assetTag,
        serialNumber,
        status: 'Active',
        source: 'Found during inspection',
        reviewStatus: 'Needs review',
        addedInInspectionId: inspection.id,
        replacesItemId: null,
      })
      try {
        const line: InspectionResult = {
          inspectionId: inspection.id,
          equipmentItemId: item.id,
          condition: NOT_CHECKED,
          note: '',
          checks: type.checks.map((definition) => ({ checkId: definition.id, condition: NOT_CHECKED, note: '' })),
          checkedAt: null,
          snapshot: { equipmentTypeId: type.id, equipmentTypeLabel: type.label, name: item.name, assetTag: item.assetTag, serialNumber: item.serialNumber },
          corrections: [],
        }
        // Finding equipment contradicts "this room has no equipment", so that statement is withdrawn.
        const saved = await this.persist({ ...inspection, noEquipmentConfirmed: false, results: [...inspection.results, line] })
        return { data: await this.view(saved), equipmentItemId: item.id }
      } catch (error) {
        await this.equipmentItems.remove(item.id)
        throw error
      }
    })
  }

  /* ---- A room with no equipment ---- */

  /** Confirms (or withdraws the confirmation) that the room has no equipment. Refused while it has active equipment. */
  setNoEquipment(inspectionId: string, rawInput: unknown): Promise<InspectionResponse> {
    return this.exclusive(async () => {
      const parsed = validateNoEquipmentInput(rawInput)
      if (!parsed.ok) throw new ValidationError(parsed.errors)
      const inspection = await this.requireInProgress(inspectionId)
      if (parsed.value.confirmed) {
        const active = (await this.equipmentItems.listAll()).filter((item) => item.roomId === inspection.roomId && item.status === 'Active')
        if (active.length > 0) {
          throw new ConflictError(`This room has ${active.length} ${active.length === 1 ? 'item' : 'items'} of equipment, so it cannot be confirmed as having none.`)
        }
      }
      const saved = await this.persist({ ...inspection, noEquipmentConfirmed: parsed.value.confirmed })
      return { data: await this.view(saved) }
    })
  }

  /* ---- A room that could not be inspected ---- */

  /**
   * Records that the room could not be inspected: the reason, who recorded it and when. Answers already saved
   * (and equipment found) are kept, so starting the inspection again resumes where it stopped.
   */
  markUnable(inspectionId: string, rawInput: unknown): Promise<InspectionResponse> {
    return this.exclusive(async () => {
      if (!isPlainObject(rawInput)) throw new ValidationError([{ field: 'body', message: 'Send the reason as a JSON object.' }])
      const { inspectorId: rawInspector, ...rest } = rawInput
      const reason = validateUnableToInspectInput(rest)
      const inspector = validateOptionalInspectorId(rawInspector)
      const errors = [...(reason.ok ? [] : reason.errors), ...(inspector.ok ? [] : inspector.errors)]
      if (!reason.ok || !inspector.ok) throw new ValidationError(errors)

      const inspection = await this.requireInProgress(inspectionId)
      const byId = inspector.value ?? inspection.inspectorId
      await this.requireTechnician(byId, 'inspectorId')
      const saved = await this.persist({
        ...inspection,
        status: 'Unable to inspect',
        completedAt: null,
        attempts: [...inspection.attempts, { at: this.now(), byId, reason: reason.value.reason }],
      })
      return { data: await this.view(saved) }
    })
  }

  /* ---- Completing ---- */

  /**
   * Completes an in-progress inspection once the shared completion rule is satisfied for every active item in the
   * room. A second request for the same inspection is refused (409) and changes nothing.
   */
  complete(inspectionId: string): Promise<InspectionResponse> {
    return this.exclusive(async () => {
      const inspection = await this.requireInProgress(inspectionId)
      const reference = await this.loadReference()
      const problems = this.problemsOf(inspection, reference)
      if (problems.length > 0) throw new ValidationError(problems)
      const saved = await this.persist({ ...inspection, status: 'Completed', completedAt: this.now() })
      return { data: await this.view(saved) }
    })
  }

  /* ---- internals ---- */

  private now(): string {
    return this.clock().toISOString()
  }

  /** Runs one change at a time, in the order requests arrived. A failure does not block the ones behind it. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work)
    this.tail = run.catch(() => undefined)
    return run
  }

  private async persist(record: InspectionRecord): Promise<InspectionRecord> {
    const saved = await this.inspections.save(record)
    if (!saved) throw new NotFoundError(`Inspection ${record.id} was not found.`)
    return saved
  }

  private async requireInspection(inspectionId: string): Promise<InspectionRecord> {
    const inspection = await this.inspections.findById(inspectionId)
    if (!inspection) throw new NotFoundError(`Inspection ${inspectionId} was not found.`)
    return inspection
  }

  /** The inspection, provided it can still be changed: in progress, in a cycle that is still open. */
  private async requireInProgress(inspectionId: string): Promise<InspectionRecord> {
    const inspection = await this.requireInspection(inspectionId)
    if (inspection.status === 'Completed') {
      throw new ConflictError(`Inspection ${inspection.id} has already been completed and can no longer be changed.`)
    }
    if (inspection.status === 'Unable to inspect') {
      throw new ConflictError(`Inspection ${inspection.id} is recorded as unable to inspect. Start the inspection again to carry on.`)
    }
    const cycle = (await this.cycles.findById(inspection.cycleId)) ?? null
    if (!cycle || cycle.status !== 'Open') {
      throw new ConflictError(`${cycle?.name ?? inspection.cycleId} is closed, so this inspection can no longer be changed.`)
    }
    this.requireWithinWindow(cycle)
    return inspection
  }

  /** Inspections are recorded only from the cycle's start date to its end date (inclusive), by the injected clock. */
  private requireWithinWindow(cycle: InspectionCycle): void {
    const today = this.now().slice(0, 10)
    if (today < cycle.startDate) {
      throw new ConflictError(`${cycle.name} opens on ${cycle.startDate}, so inspections cannot be recorded in it yet.`)
    }
    if (today > cycle.endDate) {
      throw new ConflictError(`${cycle.name} ended on ${cycle.endDate}, so inspections can no longer be recorded in it.`)
    }
  }

  private async requireTechnician(technicianId: string, field: string): Promise<void> {
    if (!(await this.technicians.findById(technicianId))) {
      throw new ValidationError([{ field, message: 'That technician was not found. Choose one from the list.' }])
    }
  }

  /** One "Not checked" line for every active item in the room, in checklist order. */
  private async freshChecklist(roomId: string): Promise<InspectionResult[]> {
    const [types, items] = await Promise.all([this.equipmentTypes.list(), this.equipmentItems.listAll()])
    const typeById = new Map(types.map((type) => [type.id, type]))
    return items
      .filter((item) => item.roomId === roomId && item.status === 'Active')
      .sort((a, b) => (typeById.get(a.equipmentTypeId)?.order ?? 0) - (typeById.get(b.equipmentTypeId)?.order ?? 0) || naturalOrder(a.id, b.id))
      .map((item) => {
        const type = typeById.get(item.equipmentTypeId)!
        return {
          inspectionId: '',
          equipmentItemId: item.id,
          condition: NOT_CHECKED,
          note: '',
          checks: type.checks.map((definition) => ({ checkId: definition.id, condition: NOT_CHECKED, note: '' })),
          checkedAt: null,
          snapshot: { equipmentTypeId: type.id, equipmentTypeLabel: type.label, name: item.name, assetTag: item.assetTag, serialNumber: item.serialNumber },
          corrections: [],
        }
      })
  }

  private async loadReference(): Promise<Reference> {
    const [blocks, floors, types, items, cycles, technicians] = await Promise.all([
      this.blocks.list(),
      this.floors.list(),
      this.equipmentTypes.list(),
      this.equipmentItems.listAll(),
      this.cycles.list(),
      this.technicians.list(),
    ])
    return { blocks, floors, types, items, cycles, technicianNames: new Map(technicians.map((technician) => [technician.id, technician.name])) }
  }

  /** How an item is described in messages and summaries, for example "Projector (AT-00012)". */
  private labelOf(result: InspectionResult): string {
    const { equipmentTypeLabel, name, assetTag } = result.snapshot
    const base = name ? `${equipmentTypeLabel}: ${name}` : equipmentTypeLabel
    return assetTag ? `${base} (${assetTag})` : base
  }

  private checklistOf(inspection: InspectionRecord): ChecklistLine[] {
    return inspection.results.map((result) => ({
      equipmentItemId: result.equipmentItemId,
      label: this.labelOf(result),
      condition: result.condition,
      note: result.note,
      checks: result.checks,
    }))
  }

  /**
   * Everything that still stops this inspection being completed: the shared rule over the checklist, plus any
   * active item in the room that has no line at all (equipment added to the inventory while the visit was open).
   */
  private problemsOf(inspection: InspectionRecord, reference: Reference): ApiErrorDetail[] {
    const problems = completionProblems(this.checklistOf(inspection), inspection.noEquipmentConfirmed)
    const listed = new Set(inspection.results.map((result) => result.equipmentItemId))
    for (const item of reference.items) {
      if (item.roomId !== inspection.roomId || item.status !== 'Active' || listed.has(item.id)) continue
      const type = reference.types.find((candidate) => candidate.id === item.equipmentTypeId)
      const label = `${type?.label ?? 'Equipment'}${item.assetTag ? ` (${item.assetTag})` : ''}`
      problems.push({ field: `results.${item.id}`, message: `${label} has not been checked.` })
    }
    return problems
  }

  private summaryOf(inspection: InspectionRecord): InspectionSummary {
    const counts = Object.fromEntries(EQUIPMENT_CONDITIONS.map((condition) => [condition, 0])) as Record<EquipmentCondition, number>
    const issues: InspectionSummary['issues'] = []
    const checkIssues: InspectionSummary['checkIssues'] = []
    const foundItems: InspectionSummary['foundItems'] = []
    for (const result of inspection.results) {
      if (result.condition === NOT_CHECKED) continue
      counts[result.condition] += 1
      const kind = ISSUE_KINDS_BY_CONDITION[result.condition]
      const label = this.labelOf(result)
      if (kind) issues.push({ equipmentItemId: result.equipmentItemId, label, kind, condition: result.condition, note: result.note })
    }
    return { totalItems: inspection.results.length, counts, issues, checkIssues, foundItems, noEquipmentConfirmed: inspection.noEquipmentConfirmed }
  }

  /** The inspection as an inspector sees it. */
  private async view(inspection: InspectionRecord): Promise<InspectionView> {
    const reference = await this.loadReference()
    const room = await this.rooms.findById(inspection.roomId)
    const cycle = reference.cycles.find((candidate) => candidate.id === inspection.cycleId)
    if (!room || !cycle) throw new NotFoundError(`The room or cycle of inspection ${inspection.id} was not found.`)

    const typeById = new Map(reference.types.map((type) => [type.id, type]))
    const itemById = new Map(reference.items.map((item) => [item.id, item]))
    const names = { cycles: new Map(reference.cycles.map((entry) => [entry.id, entry.name])), technicians: reference.technicianNames }
    const cycleIndex = new Map(reference.cycles.map((entry, index) => [entry.id, index]))
    const earlier = earlierCompleted(await this.inspections.listByRoom(room.id), cycleIndex, cycleIndex.get(cycle.id) ?? -1)

    const lines: EquipmentLine[] = [...inspection.results]
      .sort(
        (a, b) =>
          (typeById.get(a.snapshot.equipmentTypeId)?.order ?? 0) - (typeById.get(b.snapshot.equipmentTypeId)?.order ?? 0) ||
          naturalOrder(a.equipmentItemId, b.equipmentItemId),
      )
      .map((result) => {
        const type = typeById.get(result.snapshot.equipmentTypeId)!
        const item = itemById.get(result.equipmentItemId)
        const previousSource = earlier.find((candidate) => candidate.results.some((entry) => entry.equipmentItemId === result.equipmentItemId))
        const previousResult = previousSource?.results.find((entry) => entry.equipmentItemId === result.equipmentItemId)
        return {
          id: result.equipmentItemId,
          equipmentTypeId: type.id,
          typeLabel: result.snapshot.equipmentTypeLabel,
          name: result.snapshot.name,
          assetTag: result.snapshot.assetTag,
          serialNumber: result.snapshot.serialNumber,
          source: item?.source ?? 'Inventory',
          reviewStatus: item?.reviewStatus ?? 'Confirmed',
          checks: type.checks.map((definition) => ({ ...definition })),
          current: summariseResult(inspection, result, type, names),
          previous: previousSource && previousResult ? summariseResult(previousSource, previousResult, typeById.get(previousResult.snapshot.equipmentTypeId) ?? type, names) : null,
        }
      })

    const problems = inspection.status === 'In progress' ? this.problemsOf(inspection, reference) : []
    const summary = inspection.status === 'Completed' ? this.summaryOf(inspection) : null
    if (summary) {
      for (const result of inspection.results) {
        const item = itemById.get(result.equipmentItemId)
        if (item?.reviewStatus === 'Needs review' && item.addedInInspectionId === inspection.id) {
          summary.foundItems.push({ equipmentItemId: result.equipmentItemId, label: this.labelOf(result) })
        }
        const type = typeById.get(result.snapshot.equipmentTypeId)
        for (const answer of result.checks) {
          const definition = type?.checks.find((check) => check.id === answer.checkId)
          if (definition && answer.condition === 'Not working') {
            summary.checkIssues.push({
              equipmentItemId: result.equipmentItemId,
              label: this.labelOf(result),
              checkId: definition.id,
              checkLabel: definition.label,
              answer: definition.notOkLabel,
              note: answer.note,
            })
          }
        }
      }
    }

    return {
      id: inspection.id,
      cycle: publicCycle(cycle),
      room: this.roomInfo(room, reference),
      status: inspection.status,
      inspectorId: inspection.inspectorId,
      inspectorName: reference.technicianNames.get(inspection.inspectorId) ?? null,
      startedAt: inspection.startedAt,
      completedAt: inspection.completedAt,
      noEquipmentConfirmed: inspection.noEquipmentConfirmed,
      attempts: inspection.attempts.map((attempt) => ({ ...attempt, byName: reference.technicianNames.get(attempt.byId) ?? null })),
      lines,
      progress: { total: lines.length, checked: lines.filter((line) => line.current && line.current.condition !== NOT_CHECKED).length },
      completion: { canComplete: inspection.status === 'In progress' && problems.length === 0, problems },
      summary,
    }
  }

  private roomInfo(room: Room, reference: Reference): InspectionView['room'] {
    return {
      id: room.id,
      code: room.code,
      displayName: room.displayName,
      active: room.active,
      blockId: room.blockId,
      blockName: reference.blocks.find((block) => block.id === room.blockId)?.name ?? room.blockId,
      floorId: room.floorId,
      floorName: reference.floors.find((floor) => floor.id === room.floorId)?.name ?? room.floorId,
    }
  }
}
