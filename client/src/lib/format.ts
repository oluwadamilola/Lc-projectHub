import type { ProjectStatus } from '@lc-projecthub/shared'

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Formats an ISO calendar date (YYYY-MM-DD) for display. */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(`${iso}T00:00:00`))
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Plain-language deadline note, or null for completed projects. */
export function describeDeadline(dueDate: string, status: ProjectStatus, today: Date = new Date()): string | null {
  if (status === 'Complete') return null
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((new Date(`${dueDate}T00:00:00`).getTime() - startOfToday.getTime()) / MS_PER_DAY)
  if (days === 0) return 'Due today'
  const unit = Math.abs(days) === 1 ? 'day' : 'days'
  return days > 0 ? `Due in ${days} ${unit}` : `Overdue by ${Math.abs(days)} ${unit}`
}

/** True when the due date has passed (the whole of the due day still counts as on time). */
export function isOverdue(dueDate: string, done: boolean, today: Date = new Date()): boolean {
  if (done) return false
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return new Date(`${dueDate}T00:00:00`).getTime() < startOfToday.getTime()
}
