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
