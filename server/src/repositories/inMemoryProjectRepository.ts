import type { Project } from '@lc-projecthub/shared'
import type { ProjectPage, ProjectRepository, ProjectSearchCriteria } from '../domain/projectRepository.js'

function matchesSearch(project: Project, needle: string): boolean {
  const haystack = [
    project.id,
    project.name,
    project.description,
    project.location,
    project.department,
    project.lead,
  ]
  return haystack.some((value) => value.toLowerCase().includes(needle))
}

/** Holds projects in memory. Used for development and tests; contains only the data it is given. */
export class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects: readonly Project[]

  constructor(projects: readonly Project[]) {
    // Sorted once by reference so paging is stable and predictable.
    this.projects = [...projects].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
  }

  async list({ search, status, page, pageSize }: ProjectSearchCriteria): Promise<ProjectPage> {
    const needle = search?.trim().toLowerCase()
    const matches = this.projects.filter(
      (project) => (!status || project.status === status) && (!needle || matchesSearch(project, needle)),
    )
    const start = (page - 1) * pageSize
    return {
      items: matches.slice(start, start + pageSize).map((project) => ({ ...project })),
      total: matches.length,
    }
  }

  async findById(id: string): Promise<Project | null> {
    const project = this.projects.find((candidate) => candidate.id === id)
    return project ? { ...project } : null
  }
}
