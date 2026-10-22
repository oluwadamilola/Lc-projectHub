import type { Project } from '@lc-projecthub/shared'
import { getAllTasks } from '../api/allTasks'
import { useApiResource } from '../hooks/useApiResource'
import { countTasksDueInWeek, describeWeek, weekRange } from '../lib/dashboardMetrics'
import { StatCard } from './StatCard'

/** Every task of the given projects, stamped with the moment they were loaded. */
async function loadTasks(projectIds: readonly string[], signal: AbortSignal) {
  return { tasks: await getAllTasks(projectIds, signal), loadedAt: new Date() }
}

interface TasksDueThisWeekCardProps {
  projects: Project[]
  /** True when the dashboard only has some of the projects (see the notice at the top of the page). */
  partialProjects: boolean
}

/**
 * Unfinished tasks due this week (Monday to Sunday), counted from the real task data of the projects
 * shown on the dashboard. This component is only mounted once the projects have loaded, so the count
 * is never calculated from an empty project list.
 */
export function TasksDueThisWeekCard({ projects, partialProjects }: TasksDueThisWeekCardProps) {
  const projectIds = projects.map((project) => project.id)
  const result = useApiResource((signal) => loadTasks(projectIds, signal), [projectIds.join(',')])
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
  const scope = partialProjects ? ` (first ${projects.length} projects only)` : ''
  const hint =
    count === 0
      ? `Nothing outstanding is due ${describeWeek(week)}${scope}`
      : `Not yet done, due ${describeWeek(week)}${scope}`
  return <StatCard label={label} value={count} hint={hint} />
}
