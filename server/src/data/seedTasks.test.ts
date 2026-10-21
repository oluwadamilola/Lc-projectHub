import { TASK_PRIORITIES, TASK_STATUSES, validateTaskInput } from '@lc-projecthub/shared'
import { describe, expect, it } from 'vitest'
import { buildSeedProjects } from './seedProjects.js'
import { buildSeedTasks, seedTechnicians } from './seedTasks.js'

describe('demo seed tasks', () => {
  const today = new Date('2026-06-01T12:00:00Z')
  const tasks = buildSeedTasks(today)
  const projects = buildSeedProjects(today)

  it('has unique task and technician references', () => {
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length)
    expect(new Set(seedTechnicians.map((technician) => technician.id)).size).toBe(seedTechnicians.length)
  })

  it('attaches every task to a seeded project and an existing technician (or nobody)', () => {
    const projectIds = new Set(projects.map((project) => project.id))
    const technicianIds = new Set(seedTechnicians.map((technician) => technician.id))
    for (const task of tasks) {
      expect(projectIds.has(task.projectId)).toBe(true)
      if (task.assigneeId !== null) expect(technicianIds.has(task.assigneeId)).toBe(true)
    }
  })

  it('passes the same validation as user input', () => {
    for (const { id: _id, projectId: _projectId, assigneeName: _name, ...input } of tasks as (typeof tasks[number] & {
      assigneeName?: string
    })[]) {
      void _id
      void _projectId
      void _name
      expect(validateTaskInput(input).ok).toBe(true)
    }
  })

  it('uses only supported statuses and priorities, and valid date ranges', () => {
    for (const task of tasks) {
      expect(TASK_STATUSES).toContain(task.status)
      expect(TASK_PRIORITIES).toContain(task.priority)
      expect(task.startDate <= task.dueDate).toBe(true)
    }
  })

  it('shows every status, an unassigned task, and tasks for several projects', () => {
    for (const status of TASK_STATUSES) expect(tasks.some((task) => task.status === status)).toBe(true)
    expect(tasks.some((task) => task.assigneeId === null)).toBe(true)
    expect(new Set(tasks.map((task) => task.projectId)).size).toBeGreaterThan(5)
  })

  it('leaves completed projects with only finished tasks', () => {
    const complete = new Set(projects.filter((project) => project.status === 'Complete').map((project) => project.id))
    for (const task of tasks.filter((candidate) => complete.has(candidate.projectId))) expect(task.status).toBe('Done')
  })

  it('generates dates relative to the supplied day', () => {
    expect(tasks[0].dueDate).toBe('2026-04-22')
  })

  it('contains fictional technicians only', () => {
    for (const technician of seedTechnicians) expect(technician.name).not.toMatch(/@|\d/)
  })
})
