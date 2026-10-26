import {
  validateTaskInput,
  type AllTasksResponse,
  type Task,
  type TaskInput,
  type TaskListResponse,
} from '@lc-projecthub/shared'
import type { ProjectRepository } from '../domain/projectRepository.js'
import type { AllTasksCriteria, TaskRecord, TaskRepository, TaskSearchCriteria } from '../domain/taskRepository.js'
import type { TechnicianRepository } from '../domain/technicianRepository.js'
import { NotFoundError, ValidationError } from '../errors.js'

/** Application logic for tasks: ties each task to an existing project and an existing technician. */
export class TaskService {
  private readonly tasks: TaskRepository
  private readonly technicians: TechnicianRepository
  private readonly projects: ProjectRepository

  constructor(tasks: TaskRepository, technicians: TechnicianRepository, projects: ProjectRepository) {
    this.tasks = tasks
    this.technicians = technicians
    this.projects = projects
  }

  async list(criteria: TaskSearchCriteria): Promise<TaskListResponse> {
    await this.requireProject(criteria.projectId)
    const { items, total } = await this.tasks.list(criteria)
    const names = await this.technicianNames()
    return {
      data: items.map((record) => this.withAssignee(record, names)),
      meta: {
        page: criteria.page,
        pageSize: criteria.pageSize,
        total,
        totalPages: Math.ceil(total / criteria.pageSize),
      },
    }
  }

  /** Tasks of every project (or one, when `projectId` is given), each with the name of its project. */
  async listAll(criteria: AllTasksCriteria): Promise<AllTasksResponse> {
    if (criteria.projectId) await this.requireProject(criteria.projectId)
    const { items, total, outstanding, overdue } = await this.tasks.listAll(criteria)
    const names = await this.technicianNames()
    const projectNames = new Map<string, string>()
    for (const projectId of new Set(items.map((item) => item.projectId))) {
      const project = await this.projects.findById(projectId)
      // A task whose project is missing should not happen; show its reference rather than hide the task.
      projectNames.set(projectId, project?.name ?? projectId)
    }
    return {
      data: items.map((record) => ({
        ...this.withAssignee(record, names),
        projectName: projectNames.get(record.projectId) ?? record.projectId,
      })),
      meta: {
        page: criteria.page,
        pageSize: criteria.pageSize,
        total,
        totalPages: Math.ceil(total / criteria.pageSize),
      },
      summary: { outstanding, overdue },
    }
  }

  async get(projectId: string, taskId: string): Promise<Task> {
    await this.requireProject(projectId)
    return this.withAssignee(await this.requireTask(projectId, taskId), await this.technicianNames())
  }

  /** The project must exist (404) before the body is looked at (400). */
  async create(projectId: string, rawInput: unknown): Promise<Task> {
    await this.requireProject(projectId)
    const input = await this.validate(rawInput)
    const record = await this.tasks.create(projectId, input)
    return this.withAssignee(record, await this.technicianNames())
  }

  /** Order of checks: project (404), task in that project (404), body (400), technician (400). */
  async update(projectId: string, taskId: string, rawInput: unknown): Promise<Task> {
    await this.requireProject(projectId)
    await this.requireTask(projectId, taskId)
    const input = await this.validate(rawInput)
    const record = await this.tasks.update(taskId, input)
    // Covers the task disappearing between the check above and the write.
    if (!record) throw new NotFoundError(this.taskNotFound(taskId, projectId))
    return this.withAssignee(record, await this.technicianNames())
  }

  private async validate(rawInput: unknown): Promise<TaskInput> {
    const result = validateTaskInput(rawInput)
    if (!result.ok) throw new ValidationError(result.errors)
    const { assigneeId } = result.value
    if (assigneeId !== null && !(await this.technicians.findById(assigneeId))) {
      throw new ValidationError([
        { field: 'assigneeId', message: 'That technician was not found. Choose one from the list.' },
      ])
    }
    return result.value
  }

  private async requireProject(projectId: string): Promise<void> {
    if (!(await this.projects.findById(projectId))) throw new NotFoundError(`Project ${projectId} was not found.`)
  }

  /** A task is only reachable through its own project: another project's task reference is a 404. */
  private async requireTask(projectId: string, taskId: string): Promise<TaskRecord> {
    const task = await this.tasks.findById(taskId)
    if (!task || task.projectId !== projectId) throw new NotFoundError(this.taskNotFound(taskId, projectId))
    return task
  }

  private taskNotFound(taskId: string, projectId: string): string {
    return `Task ${taskId} was not found in project ${projectId}.`
  }

  private async technicianNames(): Promise<Map<string, string>> {
    const technicians = await this.technicians.list()
    return new Map(technicians.map((technician) => [technician.id, technician.name]))
  }

  private withAssignee(record: TaskRecord, names: Map<string, string>): Task {
    return { ...record, assigneeName: record.assigneeId ? (names.get(record.assigneeId) ?? null) : null }
  }
}
