import { validateProjectInput, type Project, type ProjectListResponse } from '@lc-projecthub/shared'
import type { ProjectRepository, ProjectSearchCriteria } from '../domain/projectRepository.js'
import { NotFoundError, ValidationError } from '../errors.js'

/** Application logic for projects. Knows nothing about HTTP or about where data is stored. */
export class ProjectService {
  private readonly repository: ProjectRepository

  constructor(repository: ProjectRepository) {
    this.repository = repository
  }

  async list(criteria: ProjectSearchCriteria): Promise<ProjectListResponse> {
    const { items, total } = await this.repository.list(criteria)
    return {
      data: items,
      meta: {
        page: criteria.page,
        pageSize: criteria.pageSize,
        total,
        totalPages: Math.ceil(total / criteria.pageSize),
      },
    }
  }

  async getById(id: string): Promise<Project> {
    const project = await this.repository.findById(id)
    if (!project) throw new NotFoundError(this.notFoundMessage(id))
    return project
  }

  /** Validates untrusted input, then stores a new project. The reference is assigned by the repository. */
  async create(rawInput: unknown): Promise<Project> {
    const result = validateProjectInput(rawInput)
    if (!result.ok) throw new ValidationError(result.errors)
    return this.repository.create(result.value)
  }

  /** A missing project is reported before the body is checked, so a wrong address is always a 404. */
  async update(id: string, rawInput: unknown): Promise<Project> {
    if (!(await this.repository.findById(id))) throw new NotFoundError(this.notFoundMessage(id))
    const result = validateProjectInput(rawInput)
    if (!result.ok) throw new ValidationError(result.errors)
    const updated = await this.repository.update(id, result.value)
    // Covers the project disappearing between the check above and the write.
    if (!updated) throw new NotFoundError(this.notFoundMessage(id))
    return updated
  }

  private notFoundMessage(id: string): string {
    return `Project ${id} was not found.`
  }
}
