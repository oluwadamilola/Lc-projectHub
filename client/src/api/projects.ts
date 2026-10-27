import type {
  Project,
  ProjectDeleteResponse,
  ProjectInput,
  ProjectListParams,
  ProjectListResponse,
  ProjectResponse,
} from '@lc-projecthub/shared'
import { deleteJson, getJson, sendJson } from './http'

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

export async function createProject(input: ProjectInput): Promise<Project> {
  const body = await sendJson<ProjectResponse>('POST', '/api/projects', input)
  return body.data
}

export async function updateProject(id: string, input: ProjectInput): Promise<Project> {
  const body = await sendJson<ProjectResponse>('PUT', `/api/projects/${encodeURIComponent(id)}`, input)
  return body.data
}

/** Deletes a project together with all of its tasks. Resolves to the project and how many tasks went with it. */
export function deleteProject(id: string): Promise<ProjectDeleteResponse> {
  return deleteJson<ProjectDeleteResponse>(`/api/projects/${encodeURIComponent(id)}`)
}
