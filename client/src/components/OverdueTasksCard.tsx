import type { DashboardTasksResult } from '../hooks/useDashboardTasks'
import { countOverdueTasks } from '../lib/dashboardMetrics'
import { StatCard } from './StatCard'

interface OverdueTasksCardProps {
  /** The dashboard's shared task data (one load serves every task figure). */
  result: DashboardTasksResult
  /** Number of projects included, and whether that is only some of them (see the notice at the top of the page). */
  projectCount: number
  partialProjects: boolean
}

/**
 * Outstanding tasks (not Done) whose due date is before today, from the real task data of the projects
 * shown on the dashboard. A task due today is not overdue.
 *
 * This card is deliberately not a link. Tasks are only listed inside each project's page, there is no page
 * that lists tasks across projects, and the project task list has no overdue filter, so there is no
 * existing view to send people to.
 */
export function OverdueTasksCard({ result, projectCount, partialProjects }: OverdueTasksCardProps) {
  const label = 'Overdue tasks'

  // Check the status first: after a failed retry the hook may still hold an earlier result, which must not be shown.
  if (result.status === 'error') {
    return <StatCard label={label} value="" state="error" hint="Task data could not be loaded." onRetry={result.reload} />
  }
  if (result.status === 'loading' || !result.data) {
    return <StatCard label={label} value="" state="loading" hint="Loading task data…" />
  }

  // "Today" is the day the data was loaded, the same moment the "due this week" card uses.
  const count = countOverdueTasks(result.data.tasks, result.data.loadedAt)
  const scope = partialProjects ? ` (first ${projectCount} projects only)` : ''
  const hint =
    count === 0
      ? `No outstanding tasks are past their due date${scope}`
      : `Outstanding tasks past their due date${scope}`
  return <StatCard label={label} value={count} hint={hint} />
}
