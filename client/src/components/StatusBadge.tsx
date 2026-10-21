import type { ProjectPriority, ProjectStatus } from '@lc-projecthub/shared'

const statusTone: Record<ProjectStatus, string> = {
  'On track': 'success',
  'At risk': 'warning',
  Delayed: 'danger',
  Planning: 'info',
  Complete: 'neutral',
}

const priorityTone: Record<ProjectPriority, string> = {
  Critical: 'danger',
  High: 'warning',
  Medium: 'info',
  Low: 'neutral',
}

/** Status and priority are always shown as text, never by colour alone. */
export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`badge badge--${statusTone[status]}`}>{status}</span>
}

export function PriorityBadge({ priority }: { priority: ProjectPriority }) {
  return <span className={`badge badge--${priorityTone[priority]}`}>{priority}</span>
}
