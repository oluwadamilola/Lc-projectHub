import type {
  Task,
  TaskInput,
  TaskListParams,
  TaskListResponse,
  TaskResponse,
  Technician,
  TechnicianListResponse,
} from '@lc-projecthub/shared'
import { deleteJson, getJson, sendJson } from './http'

const tasksPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/tasks`

export function getTasks(projectId: string, params: TaskListParams = {}, signal?: AbortSignal): Promise<TaskListResponse> {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.status) search.set('status', params.status)
  if (params.assignee) search.set('assignee', params.assignee)
  if (params.page) search.set('page', String(params.page))
  if (params.pageSize) search.set('pageSize', String(params.pageSize))
  const query = search.toString()
  return getJson<TaskListResponse>(`${tasksPath(projectId)}${query ? `?${query}` : ''}`, signal)
}

export async function getTask(projectId: string, taskId: string, signal?: AbortSignal): Promise<Task> {
  const body = await getJson<TaskResponse>(`${tasksPath(projectId)}/${encodeURIComponent(taskId)}`, signal)
  return body.data
}

export async function createTask(projectId: string, input: TaskInput): Promise<Task> {
  const body = await sendJson<TaskResponse>('POST', tasksPath(projectId), input)
  return body.data
}

export async function updateTask(projectId: string, taskId: string, input: TaskInput): Promise<Task> {
  const body = await sendJson<TaskResponse>('PUT', `${tasksPath(projectId)}/${encodeURIComponent(taskId)}`, input)
  return body.data
}

/** Deletes one task for good. Resolves to the task that was deleted; rejects (404) if it is already gone. */
export async function deleteTask(projectId: string, taskId: string): Promise<Task> {
  const body = await deleteJson<TaskResponse>(`${tasksPath(projectId)}/${encodeURIComponent(taskId)}`)
  return body.data
}

export async function getTechnicians(signal?: AbortSignal): Promise<Technician[]> {
  const body = await getJson<TechnicianListResponse>('/api/technicians', signal)
  return body.data
}
