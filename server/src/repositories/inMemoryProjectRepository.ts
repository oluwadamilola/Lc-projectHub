import type { Project, ProjectInput } from '@lc-projecthub/shared'
import type { ProjectPage, ProjectRepository, ProjectSearchCriteria } from '../domain/projectRepository.js'

const REFERENCE_PREFIX = 'PRJ-'
const REFERENCE_PATTERN = /^PRJ-(\d+)$/

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

const byReference = (a: Project, b: Project) => a.id.localeCompare(b.id, 'en', { numeric: true })

/** Holds projects in memory. Used for development and tests; contains only the data it is given. */
export class InMemoryProjectRepository implements ProjectRepository {
  private projects: Project[]
  private lastReferenceNumber: number

  constructor(projects: readonly Project[]) {
    // Copy on the way in, and keep sorted by reference so paging is stable and predictable.
    this.projects = projects.map((project) => ({ ...project })).sort(byReference)
    this.lastReferenceNumber = this.projects.reduce((highest, project) => {
      const match = REFERENCE_PATTERN.exec(project.id)
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0)
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

  async create(input: ProjectInput): Promise<Project> {
    // No await between reading and bumping the counter, so two simultaneous calls can never share a reference.
    this.lastReferenceNumber += 1
    const id = `${REFERENCE_PREFIX}${String(this.lastReferenceNumber).padStart(3, '0')}`
    const project: Project = { ...input, id }
    this.projects = [...this.projects, project].sort(byReference)
    return { ...project }
  }

  async update(id: string, input: ProjectInput): Promise<Project | null> {
    const index = this.projects.findIndex((candidate) => candidate.id === id)
    if (index === -1) return null
    // The reference is never taken from the input.
    const updated: Project = { ...input, id }
    this.projects = this.projects.map((project, position) => (position === index ? updated : project))
    return { ...updated }
  }
}
