import type { Project, ProjectStatus } from '@lc-projecthub/shared'

export interface ProjectSearchCriteria {
  /** Case-insensitive text matched against reference, name, description, location, department and lead. */
  search?: string
  status?: ProjectStatus
  /** 1-based page number. */
  page: number
  pageSize: number
}

export interface ProjectPage {
  items: Project[]
  /** Number of projects matching the filters, ignoring paging. */
  total: number
}

/**
 * The persistence boundary for projects.
 *
 * Routes and services depend only on this interface. Methods are asynchronous so a
 * database-backed implementation (for example SQL Server) can replace the in-memory one
 * without changing any caller.
 */
export interface ProjectRepository {
  list(criteria: ProjectSearchCriteria): Promise<ProjectPage>
  findById(id: string): Promise<Project | null>
}
