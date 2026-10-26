import type { AllTasksParams, AllTasksResponse } from '@lc-projecthub/shared'
import { getJson } from './http'

/** Tasks of every project (GET /api/tasks), filtered and paged by the server. */
export function searchTasks(params: AllTasksParams = {}, signal?: AbortSignal): Promise<AllTasksResponse> {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.project) search.set('project', params.project)
  if (params.status) search.set('status', params.status)
  if (params.priority) search.set('priority', params.priority)
  if (params.assignee) search.set('assignee', params.assignee)
  if (params.due) search.set('due', params.due)
  if (params.today) search.set('today', params.today)
  if (params.page) search.set('page', String(params.page))
  if (params.pageSize) search.set('pageSize', String(params.pageSize))
  const query = search.toString()
  return getJson<AllTasksResponse>(`/api/tasks${query ? `?${query}` : ''}`, signal)
}
