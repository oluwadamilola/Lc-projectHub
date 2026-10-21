import type { Project, ProjectListParams, ProjectListResponse, ProjectResponse } from '@lc-projecthub/shared'
import { getJson } from './http'

export function getProjects(params: ProjectListParams = {}, signal?: AbortSignal): Promise<ProjectListResponse> {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.status) search.set('status', params.status)
  if (params.page) search.set('page', String(params.page))
  if (params.pageSize) search.set('pageSize', String(params.pageSize))
  const query = search.toString()
  return getJson<ProjectListResponse>(`/api/projects${query ? `?${query}` : ''}`, signal)
}

export async function getProject(id: string, signal?: AbortSignal): Promise<Project> {
  const body = await getJson<ProjectResponse>(`/api/projects/${encodeURIComponent(id)}`, signal)
  return body.data
}
