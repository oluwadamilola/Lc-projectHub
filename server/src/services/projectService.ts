import type { Project, ProjectListResponse } from '@lc-projecthub/shared'
import type { ProjectRepository, ProjectSearchCriteria } from '../domain/projectRepository.js'
import { NotFoundError } from '../errors.js'

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
    if (!project) throw new NotFoundError(`Project ${id} was not found.`)
    return project
  }
}
