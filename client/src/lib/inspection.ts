import type { CheckResult, EquipmentLine, InspectionProgress, ResultCondition } from '@lc-projecthub/shared'
import { EQUIPMENT_CONDITIONS, noteRequired } from '@lc-projecthub/shared'

/** What the inspector has entered for one item so far (the same shape the server saves). */
export interface LineDraft {
  condition: ResultCondition
  note: string
  checks: CheckResult[]
}

/** The conditions offered for every item, in the order the buttons appear. */
export const CONDITION_CHOICES = EQUIPMENT_CONDITIONS

/** A draft built from what the server already holds for the line, so a resumed inspection shows earlier answers. */
export function draftFromLine(line: EquipmentLine): LineDraft {
  return {
    condition: line.current?.condition ?? 'Not checked',
    note: line.current?.note ?? '',
    checks: line.checks.map((definition) => {
      const saved = line.current?.checks.find((check) => check.checkId === definition.id)
      return { checkId: definition.id, condition: saved?.condition ?? 'Not checked', note: saved?.note ?? '' }
    }),
  }
}

/** Extra checks (for example firmware) apply to an item that is present; not to one that is missing or not applicable. */
export const checksApply = (condition: ResultCondition): boolean =>
  condition === 'Working' || condition === 'Not working' || condition === 'Needs replacement'

export const conditionNeedsNote = (condition: ResultCondition): boolean => noteRequired(condition)

/** "Projector" or "Projector: Front projector". */
export const itemTitle = (line: Pick<EquipmentLine, 'typeLabel' | 'name'>): string => (line.name ? `${line.typeLabel}: ${line.name}` : line.typeLabel)

/** "3 of 7 items checked". */
export function describeChecked(progress: InspectionProgress): string {
  return `${progress.checked} of ${progress.total} ${progress.total === 1 ? 'item' : 'items'} checked`
}

/** Whole-number percentage of lines checked (0 when there are none). */
export const percentChecked = (progress: InspectionProgress): number => (progress.total === 0 ? 0 : Math.round((progress.checked / progress.total) * 100))

/** The page element a completion problem points at: an item card, or the "no equipment" panel. */
export function problemTarget(field: string): string | null {
  const item = /^results\.([A-Za-z0-9-]+)/.exec(field)
  if (item) return `item-${item[1]}`
  if (field === 'noEquipmentConfirmed') return 'no-equipment'
  return null
}
