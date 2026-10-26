import {
  UNASSIGNED_FILTER,
  isIsoDate,
  isOutstandingAndDueInWeek,
  isTaskOutstanding,
  isTaskOverdue,
  weekRangeFor,
  type TaskInput,
} from '@lc-projecthub/shared'
import type {
  AllTasksCriteria,
  AllTasksPage,
  TaskPage,
  TaskRecord,
  TaskRepository,
  TaskSearchCriteria,
} from '../domain/taskRepository.js'

const REFERENCE_PREFIX = 'TASK-'
const REFERENCE_PATTERN = /^TASK-(\d+)$/

const byReference = (a: TaskRecord, b: TaskRecord) => a.id.localeCompare(b.id, 'en', { numeric: true })
/** Soonest deadline first; the reference keeps the order stable for equal dates. */
const byDueDate = (a: TaskRecord, b: TaskRecord) => a.dueDate.localeCompare(b.dueDate) || byReference(a, b)

/** Like `byDueDate`, but tasks without a usable due date go last (in reference order) instead of sorting by accident. */
const byDueDateDatedFirst = (a: TaskRecord, b: TaskRecord) => {
  const aDated = isIsoDate(a.dueDate)
  const bDated = isIsoDate(b.dueDate)
  if (aDated !== bDated) return aDated ? -1 : 1
  return aDated ? byDueDate(a, b) : byReference(a, b)
}

function matchesSearch(task: TaskRecord, needle: string): boolean {
  return [task.id, task.title, task.description].some((value) => value.toLowerCase().includes(needle))
}

/** Holds tasks in memory. Used for development and tests; contains only the data it is given. */
export class InMemoryTaskRepository implements TaskRepository {
  private tasks: TaskRecord[]
  private lastReferenceNumber: number

  constructor(tasks: readonly TaskRecord[]) {
    this.tasks = tasks.map((task) => ({ ...task })).sort(byReference)
    this.lastReferenceNumber = this.tasks.reduce((highest, task) => {
      const match = REFERENCE_PATTERN.exec(task.id)
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0)
  }

  async list({ projectId, search, status, assignee, page, pageSize }: TaskSearchCriteria): Promise<TaskPage> {
    const needle = search?.trim().toLowerCase()
    const matches = this.tasks
      .filter((task) => task.projectId === projectId)
      .filter((task) => !status || task.status === status)
      .filter((task) => {
        if (!assignee) return true
        return assignee === UNASSIGNED_FILTER ? task.assigneeId === null : task.assigneeId === assignee
      })
      .filter((task) => !needle || matchesSearch(task, needle))
      .sort(byDueDate)
    const start = (page - 1) * pageSize
    return {
      items: matches.slice(start, start + pageSize).map((task) => ({ ...task })),
      total: matches.length,
    }
  }

  async listAll({ projectId, search, status, priority, assignee, due, today, page, pageSize }: AllTasksCriteria): Promise<AllTasksPage> {
    const needle = search?.trim().toLowerCase()
    const week = due === 'this-week' && isIsoDate(today) ? weekRangeFor(today) : null
    const matches = this.tasks
      .filter((task) => !projectId || task.projectId === projectId)
      .filter((task) => !status || task.status === status)
      .filter((task) => !priority || task.priority === priority)
      .filter((task) => {
        if (!assignee) return true
        return assignee === UNASSIGNED_FILTER ? task.assigneeId === null : task.assigneeId === assignee
      })
      .filter((task) => !needle || matchesSearch(task, needle))
      .filter((task) => {
        if (due === 'overdue') return isTaskOverdue(task, today)
        if (due === 'this-week') return week !== null && isOutstandingAndDueInWeek(task, week)
        return true
      })
      .sort(byDueDateDatedFirst)
    const start = (page - 1) * pageSize
    return {
      items: matches.slice(start, start + pageSize).map((task) => ({ ...task })),
      total: matches.length,
      outstanding: matches.filter(isTaskOutstanding).length,
      overdue: matches.filter((task) => isTaskOverdue(task, today)).length,
    }
  }

  async findById(id: string): Promise<TaskRecord | null> {
    const task = this.tasks.find((candidate) => candidate.id === id)
    return task ? { ...task } : null
  }

  async create(projectId: string, input: TaskInput): Promise<TaskRecord> {
    // No await between reading and bumping the counter, so two simultaneous calls can never share a reference.
    this.lastReferenceNumber += 1
    const id = `${REFERENCE_PREFIX}${String(this.lastReferenceNumber).padStart(3, '0')}`
    const task: TaskRecord = { ...input, id, projectId }
    this.tasks = [...this.tasks, task].sort(byReference)
    return { ...task }
  }

  async update(id: string, input: TaskInput): Promise<TaskRecord | null> {
    const existing = this.tasks.find((candidate) => candidate.id === id)
    if (!existing) return null
    // The reference and project are never taken from the input.
    const updated: TaskRecord = { ...input, id, projectId: existing.projectId }
    this.tasks = this.tasks.map((task) => (task.id === id ? updated : task))
    return { ...updated }
  }
}
