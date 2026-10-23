import type { Project, Task } from '@lc-projecthub/shared'
import { getAllTasks } from '../api/allTasks'
import { useApiResource } from './useApiResource'

/** Every task of the dashboard's projects, stamped with the moment they were loaded. */
export interface DashboardTasks {
  tasks: Task[]
  /** Both "today" and "this week" are worked out from this moment, so the figures and their dates always agree. */
  loadedAt: Date
}

async function loadTasks(projectIds: readonly string[], signal: AbortSignal): Promise<DashboardTasks> {
  return { tasks: await getAllTasks(projectIds, signal), loadedAt: new Date() }
}

/**
 * Loads the tasks of the given projects once. Every dashboard figure that depends on tasks reads
 * this one result, so adding another figure never adds another round of requests.
 * Call it only after the projects have loaded, so a figure is never calculated from an empty project list.
 */
export function useDashboardTasks(projects: readonly Project[]) {
  const projectIds = projects.map((project) => project.id)
  return useApiResource((signal) => loadTasks(projectIds, signal), [projectIds.join(',')])
}

export type DashboardTasksResult = ReturnType<typeof useDashboardTasks>
