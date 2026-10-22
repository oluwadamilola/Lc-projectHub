import { MAX_PAGE_SIZE, type Task } from '@lc-projecthub/shared'
import { ApiRequestError } from './http'
import { getTasks } from './tasks'

/*
  The task API is per project (/api/projects/:id/tasks) and has no cross-project or date filter.
  The dashboard needs every task, so this asks for each project's tasks, a few projects at a time,
  and follows paging until a project's tasks are all in.

  It either returns every task or fails: a half-loaded list would give a wrong total, so one failed
  request fails the whole call and stops the others.
*/

/** How many projects are requested at the same time. */
const CONCURRENCY = 5
/** Safety stop so a runaway project cannot loop forever (50 pages x 100 = 5,000 tasks per project). */
const MAX_PAGES_PER_PROJECT = 50

async function getAllTasksForProject(projectId: string, signal: AbortSignal): Promise<Task[]> {
  const tasks: Task[] = []
  for (let page = 1; page <= MAX_PAGES_PER_PROJECT; page += 1) {
    const response = await getTasks(projectId, { page, pageSize: MAX_PAGE_SIZE }, signal)
    tasks.push(...response.data)
    if (page >= response.meta.totalPages) return tasks
  }
  // Returning what we have would silently undercount, so report failure instead.
  throw new ApiRequestError(`Project ${projectId} has too many tasks to total.`, 0)
}

export async function getAllTasks(projectIds: readonly string[], signal?: AbortSignal): Promise<Task[]> {
  // Stops sibling requests as soon as one fails, and when the caller cancels.
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel)
  if (signal?.aborted) cancel()

  const perProject: Task[][] = new Array(projectIds.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (!controller.signal.aborted) {
      const index = nextIndex
      nextIndex += 1
      if (index >= projectIds.length) return
      perProject[index] = await getAllTasksForProject(projectIds[index], controller.signal)
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, projectIds.length) }, worker))
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return perProject.flat()
  } catch (error) {
    cancel()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}
