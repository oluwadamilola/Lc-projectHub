import type { ResultCondition, ReviewStatus, RoomInspectionSummary } from '@lc-projecthub/shared'
import { CONDITION_TONES } from '../lib/audit'

const statusTone = { 'Not started': 'neutral', 'In progress': 'info', Completed: 'success', 'Unable to inspect': 'warning' } as const

/** A room inspection state, as text. A room outside the cycle scope says so instead. */
export function InspectionStatusBadge({ inspection }: { inspection: RoomInspectionSummary }) {
  if (!inspection.inScope) return <span className="badge badge--neutral">Not in this cycle</span>
  return <span className={`badge badge--${statusTone[inspection.status]}`}>{inspection.status}</span>
}

export function ConditionBadge({ condition }: { condition: ResultCondition }) {
  return <span className={`badge badge--${CONDITION_TONES[condition]}`}>{condition}</span>
}

export function RoomStatusBadge({ active }: { active: boolean }) {
  return <span className={`badge badge--${active ? 'success' : 'neutral'}`}>{active ? 'Active' : 'Retired'}</span>
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  return status === 'Needs review' ? <span className="badge badge--warning">Needs review</span> : null
}
