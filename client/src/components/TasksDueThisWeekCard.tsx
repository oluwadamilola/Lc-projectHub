import type { DashboardTasksResult } from '../hooks/useDashboardTasks'
import { countTasksDueInWeek, describeWeek, weekRange } from '../lib/dashboardMetrics'
import { StatCard } from './StatCard'

interface TasksDueThisWeekCardProps {
  /** The dashboard's shared task data (one load serves every task figure). */
  result: DashboardTasksResult
  /** Number of projects included, and whether that is only some of them (see the notice at the top of the page). */
  projectCount: number
  partialProjects: boolean
}

/**
 * Unfinished tasks due this week (Monday to Sunday), counted from the real task data of the projects
 * shown on the dashboard. Note that "this week" includes days that have already passed, so a task due
 * earlier this week is counted here and also on the Overdue card.
 */
export function TasksDueThisWeekCard({ result, projectCount, partialProjects }: TasksDueThisWeekCardProps) {
  const label = 'Tasks due this week'

  // Check the status first: after a failed retry the hook may still hold an earlier result, which must not be shown.
  if (result.status === 'error') {
    return <StatCard label={label} value="" state="error" hint="Task data could not be loaded." onRetry={result.reload} />
  }
  if (result.status === 'loading' || !result.data) {
    return <StatCard label={label} value="" state="loading" hint="Loading task data…" />
  }

  // The week is worked out from the moment the data was loaded, so the number and its date range always agree.
  const week = weekRange(result.data.loadedAt)
  const count = countTasksDueInWeek(result.data.tasks, week)
  const scope = partialProjects ? ` (first ${projectCount} projects only)` : ''
  const hint =
    count === 0
      ? `Nothing outstanding is due ${describeWeek(week)}${scope}`
      : `Not yet done, due ${describeWeek(week)}${scope}`
  return <StatCard label={label} value={count} hint={hint} />
}
