import type { Task, TaskDueFilter, TaskInput, TaskPriority, TaskStatus } from '@lc-projecthub/shared'

/** A task as stored. The technician name is looked up when the task is returned, not stored. */
export type TaskRecord = Omit<Task, 'assigneeName'>

export interface TaskSearchCriteria {
  /** Tasks are always listed for one project. */
  projectId: string
  /** Case-insensitive text matched against reference, title and description. */
  search?: string
  status?: TaskStatus
  /** A technician reference, or "unassigned" for tasks nobody has picked up. */
  assignee?: string
  /** 1-based page number. */
  page: number
  pageSize: number
}

export interface TaskPage {
  items: TaskRecord[]
  /** Number of tasks matching the filters, ignoring paging. */
  total: number
}

export interface AllTasksCriteria {
  /** Only this project's tasks. The service checks that it exists. */
  projectId?: string
  /** Case-insensitive text matched against reference, title and description. */
  search?: string
  status?: TaskStatus
  priority?: TaskPriority
  /** A technician reference, or "unassigned" for tasks nobody has picked up. */
  assignee?: string
  /** Only outstanding tasks that are overdue, or due in the week containing `today`. */
  due?: TaskDueFilter
  /** The calendar day (YYYY-MM-DD) that "overdue" and "this week" are measured from. */
  today: string
  /** 1-based page number. */
  page: number
  pageSize: number
}

export interface AllTasksPage extends TaskPage {
  /** Of the tasks matching the filters (ignoring paging): how many are not "Done". */
  outstanding: number
  /** Of the tasks matching the filters (ignoring paging): how many are overdue as of `today`. */
  overdue: number
}

/**
 * The persistence boundary for tasks. Like the project repository it is asynchronous so a
 * database-backed version can replace the in-memory one, assumes validated input, and always
 * returns copies. Whether the project and technician exist is the service's job, not the repository's.
 */
export interface TaskRepository {
  list(criteria: TaskSearchCriteria): Promise<TaskPage>
  /** Searches the tasks of every project, soonest deadline first. */
  listAll(criteria: AllTasksCriteria): Promise<AllTasksPage>
  findById(id: string): Promise<TaskRecord | null>
  /** Stores a new task for the project. The repository assigns its unique reference. */
  create(projectId: string, input: TaskInput): Promise<TaskRecord>
  /** Replaces every editable field of a task. The project and reference never change. Null if it does not exist. */
  update(id: string, input: TaskInput): Promise<TaskRecord | null>
}
