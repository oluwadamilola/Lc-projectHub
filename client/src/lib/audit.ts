import type { CheckResultLine, CycleProgress, InspectionFilter, ResultCondition, RoomInspectionSummary } from '@lc-projecthub/shared'

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** A cycle reference as found in an address, or undefined. Anything that is not a plain reference is ignored. */
const CYCLE_REFERENCE = /^[A-Za-z0-9-]{1,32}$/
export const readCycle = (value: string | null): string | undefined => (value && CYCLE_REFERENCE.test(value) ? value : undefined)

/** Adds the chosen cycle to an Audit address, so moving around keeps looking at the same cycle. */
export function withCycle(path: string, cycleId: string | undefined): string {
  if (!cycleId) return path
  return `${path}${path.includes('?') ? '&' : '?'}cycle=${encodeURIComponent(cycleId)}`
}

/** "12 of 65 rooms completed", or a plain phrase when the scope is empty (never "0%" for "no rooms"). */
export function describeProgress(progress: CycleProgress): string {
  if (progress.scope === 0) return 'No rooms to inspect'
  return `${progress.completed} of ${plural(progress.scope, 'room')} completed`
}

/** The non-zero parts of progress other than completed, for example "2 in progress · 1 unable to inspect". */
export function describeRemaining(progress: CycleProgress): string {
  const parts: string[] = []
  if (progress.inProgress > 0) parts.push(`${progress.inProgress} in progress`)
  if (progress.unableToInspect > 0) parts.push(`${progress.unableToInspect} unable to inspect`)
  if (progress.notStarted > 0) parts.push(`${progress.notStarted} not started`)
  return parts.join(' · ')
}

export const INSPECTION_FILTER_LABELS: Record<InspectionFilter, string> = {
  all: 'All rooms',
  toInspect: 'Still to inspect',
  notStarted: 'Not started',
  inProgress: 'In progress',
  completed: 'Completed',
  unable: 'Unable to inspect',
}

/** Tone used for a condition badge. Always shown with its text, never by colour alone. */
export const CONDITION_TONES: Record<ResultCondition, 'success' | 'danger' | 'warning' | 'neutral'> = {
  Working: 'success',
  'Not working': 'danger',
  'Needs replacement': 'warning',
  Missing: 'danger',
  'Not applicable': 'neutral',
  'Not checked': 'neutral',
}

/** A check stored value in its own words: Working is "Up to date" for a firmware check, and so on. */
export function checkWords(check: CheckResultLine): string {
  if (check.condition === 'Working') return check.okLabel
  if (check.condition === 'Not working') return check.notOkLabel
  return check.condition
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
/** A calendar date from an ISO date and time, or an empty string for null. */
export function formatWhen(iso: string | null): string {
  return iso ? dateFormat.format(new Date(iso)) : ''
}

/** One line describing a room inspection: who and when, or why it could not be done. */
export function describeInspection(inspection: RoomInspectionSummary): string {
  if (!inspection.inScope) return ''
  switch (inspection.status) {
    case 'Completed':
      return `${inspection.inspectorName ?? 'Unknown'} · ${formatWhen(inspection.completedAt)}`
    case 'In progress':
      return `${inspection.inspectorName ?? 'Unknown'} · ${inspection.checkedLines} of ${inspection.totalLines} items checked`
    case 'Unable to inspect':
      return inspection.unableReason ?? ''
    default:
      return ''
  }
}
