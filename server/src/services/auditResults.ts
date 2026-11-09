import type { EquipmentType, InspectionResult, ResultSummary } from '@lc-projecthub/shared'
import { NOT_CHECKED } from '@lc-projecthub/shared'
import type { InspectionRecord } from '../domain/auditRepository.js'

/*
  Shared by the read model (the room page) and the inspection service (the checklist): how one stored result line
  is shown, and which earlier answer counts as "last time".
*/

export interface ResultNames {
  /** Cycle reference -> name, for example CYC-002 -> "Summer 2026". */
  cycles: ReadonlyMap<string, string>
  /** Technician reference -> name. */
  technicians: ReadonlyMap<string, string>
}

/** One result line as the API shows it, with the extra checks in the type's own words. */
export function summariseResult(inspection: InspectionRecord, result: InspectionResult, type: EquipmentType, names: ResultNames): ResultSummary {
  return {
    inspectionId: inspection.id,
    cycleId: inspection.cycleId,
    cycleName: names.cycles.get(inspection.cycleId) ?? inspection.cycleId,
    condition: result.condition,
    note: result.note,
    checkedAt: result.checkedAt,
    inspectorName: names.technicians.get(inspection.inspectorId) ?? null,
    corrected: result.corrections.length > 0,
    checks: type.checks.map((definition) => {
      const answer = result.checks.find((check) => check.checkId === definition.id)
      return {
        checkId: definition.id,
        label: definition.label,
        okLabel: definition.okLabel,
        notOkLabel: definition.notOkLabel,
        condition: answer?.condition ?? NOT_CHECKED,
        note: answer?.note ?? '',
      }
    }),
  }
}

/**
 * The completed inspections of a room from cycles BEFORE the cycle at `selectedIndex` (an index into the cycles
 * oldest-first), newest first. Unfinished inspections, and ones from the selected or later cycles, never count.
 */
export function earlierCompleted(history: readonly InspectionRecord[], cycleIndex: ReadonlyMap<string, number>, selectedIndex: number): InspectionRecord[] {
  return history
    .filter((inspection) => inspection.status === 'Completed' && (cycleIndex.get(inspection.cycleId) ?? Infinity) < selectedIndex)
    .sort((a, b) => (cycleIndex.get(b.cycleId) ?? 0) - (cycleIndex.get(a.cycleId) ?? 0))
}
