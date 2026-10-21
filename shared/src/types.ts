/*
  Types and constants shared by the API (server) and the web app (client).
  This package contains no framework code, so both sides can depend on it.
*/

/** Display order matters: the UI lists statuses in this order. */
export const PROJECT_STATUSES = ['On track', 'At risk', 'Delayed', 'Planning', 'Complete'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number]

export interface Project {
  /** Human-readable reference, for example "PRJ-101". */
  id: string
  name: string
  description: string
  location: string
  department: string
  lead: string
  priority: ProjectPriority
  status: ProjectStatus
  /** Whole percentage, 0 to 100. */
  progress: number
  /** ISO calendar dates (YYYY-MM-DD). */
  startDate: string
  dueDate: string
}

/**
 * What a caller may send to create or replace a project. The reference (`id`) is always
 * assigned by the server and can never be supplied or changed.
 */
export type ProjectInput = Omit<Project, 'id'>
export type ProjectInputField = keyof ProjectInput

/** Query parameters accepted by GET /api/projects (all optional on the wire). */
export interface ProjectListParams {
  q?: string
  status?: ProjectStatus
  page?: number
  pageSize?: number
}

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100
export const MAX_SEARCH_LENGTH = 100

export interface PageMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/* ---- API response shapes ---- */

export interface ProjectListResponse {
  data: Project[]
  meta: PageMeta
}

export interface ProjectResponse {
  data: Project
}

export type ApiErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR'

export interface ApiErrorDetail {
  field: string
  message: string
}

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode
    message: string
    details?: ApiErrorDetail[]
  }
}

/* ---- Tasks and technicians ---- */

export const TASK_STATUSES = ['To do', 'In progress', 'Blocked', 'Done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Tasks use the same priority scale as projects. */
export const TASK_PRIORITIES = PROJECT_PRIORITIES
export type TaskPriority = ProjectPriority

/** A member of the IT team who can be assigned tasks. Fictional records only. */
export interface Technician {
  /** Reference such as "TECH-001". */
  id: string
  name: string
  team: string
}

export interface Task {
  /** Reference such as "TASK-014", unique across all projects. */
  id: string
  /** The project this task belongs to. Fixed when the task is created. */
  projectId: string
  title: string
  /** Optional; may be an empty string. */
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** The assigned technician, or null while unassigned. */
  assigneeId: string | null
  /** Read-only: the assigned technician's name, filled in by the server. */
  assigneeName: string | null
  /** ISO calendar dates (YYYY-MM-DD). */
  startDate: string
  dueDate: string
}

/** What a caller may send to create or replace a task. The reference and project come from the address, never the body. */
export type TaskInput = Omit<Task, 'id' | 'projectId' | 'assigneeName'>
export type TaskInputField = keyof TaskInput

/** `assignee` is a technician reference, or this value to find tasks nobody has picked up yet. */
export const UNASSIGNED_FILTER = 'unassigned'

/** Query parameters accepted by GET /api/projects/:id/tasks (all optional on the wire). */
export interface TaskListParams {
  q?: string
  status?: TaskStatus
  assignee?: string
  page?: number
  pageSize?: number
}

export interface TaskListResponse {
  data: Task[]
  meta: PageMeta
}

export interface TaskResponse {
  data: Task
}

export interface TechnicianListResponse {
  data: Technician[]
}
