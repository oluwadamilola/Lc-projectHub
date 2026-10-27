import { validateProjectInput, type Project, type ProjectDeleteResponse, type ProjectListResponse } from '@lc-projecthub/shared'
import type { ProjectRepository, ProjectSearchCriteria } from '../domain/projectRepository.js'
import type { TaskRepository } from '../domain/taskRepository.js'
import { NotFoundError, ValidationError } from '../errors.js'

/** Application logic for projects. Knows nothing about HTTP or about where data is stored. */
export class ProjectService {
  private readonly repository: ProjectRepository
  /** Needed so deleting a project can never leave its tasks behind. */
  private readonly tasks: TaskRepository

  constructor(repository: ProjectRepository, tasks: TaskRepository) {
    this.repository = repository
    this.tasks = tasks
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

  /**
   * Deletes a project together with all of its tasks, so no task is ever left pointing at a missing project.
   *
   * Order matters: the tasks go first and are kept in hand. If removing the project then fails, they are put
   * back, so the project is whole again and the request can simply be retried. A final sweep removes any task
   * that was added while this was running. Asking again once it is gone is a 404, never a second deletion.
   */
  async delete(id: string): Promise<ProjectDeleteResponse> {
    if (!(await this.repository.findById(id))) throw new NotFoundError(this.notFoundMessage(id))

    const removed = await this.tasks.deleteByProject(id)
    let project: Project | null
    try {
      project = await this.repository.delete(id)
    } catch (error) {
      await this.tasks.restore(removed)
      throw error
    }
    // Someone else deleted it first. Their request owns the clean-up, so nothing is put back.
    if (!project) throw new NotFoundError(this.notFoundMessage(id))

    const late = await this.tasks.deleteByProject(id)
    return { data: project, meta: { deletedTasks: removed.length + late.length } }
  }

  private notFoundMessage(id: string): string {
    return `Project ${id} was not found.`
  }
}
