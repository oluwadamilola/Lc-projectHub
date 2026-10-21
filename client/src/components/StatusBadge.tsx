import type { ProjectStatus } from '../data/demoData'

const tone: Record<ProjectStatus, string> = {
  'On track': 'success',
  'At risk': 'warning',
  Delayed: 'danger',
  Planning: 'info',
  Complete: 'neutral',
}

/** Status is always shown as text, never by colour alone. */
export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`badge badge--${tone[status]}`}>{status}</span>
}
