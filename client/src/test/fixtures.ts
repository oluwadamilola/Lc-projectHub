import type { Project, ProjectListResponse, Task, TaskListResponse, Technician } from '@lc-projecthub/shared'

/** Fictional projects for UI tests. */
export const projectA: Project = {
  id: 'PRJ-001',
  name: 'Alpha Network',
  description: 'Upgrade switches in the north wing.',
  location: 'Test Building One',
  department: 'Infrastructure',
  lead: 'Casey Lane',
  priority: 'High',
  status: 'On track',
  progress: 60,
  startDate: '2026-01-05',
  dueDate: '2026-03-30',
}

export const projectB: Project = {
  id: 'PRJ-002',
  name: 'Bravo Laptops',
  description: 'Refresh the loan laptop pool.',
  location: 'Test Building Two',
  department: 'Service Desk',
  lead: 'Robin Park',
  priority: 'Critical',
  status: 'Delayed',
  progress: 35,
  startDate: '2026-01-12',
  dueDate: '2026-04-15',
}

export const projectC: Project = {
  id: 'PRJ-003',
  name: 'Charlie Signage',
  description: 'Install screens at the main entrance.',
  location: 'Test Building One',
  department: 'Digital Learning',
  lead: 'Casey Lane',
  priority: 'Low',
  status: 'Complete',
  progress: 100,
  startDate: '2025-09-01',
  dueDate: '2025-12-15',
}

export function listResponse(
  projects: Project[],
  meta: Partial<ProjectListResponse['meta']> = {},
): ProjectListResponse {
  return {
    data: projects,
    meta: { page: 1, pageSize: 10, total: projects.length, totalPages: projects.length ? 1 : 0, ...meta },
  }
}

/* ---- Tasks and technicians (fictional) ---- */

export const technicians: Technician[] = [
  { id: 'TECH-001', name: 'Test Technician One', team: 'Test Team A' },
  { id: 'TECH-002', name: 'Test Technician Two', team: 'Test Team B' },
]

export const taskA: Task = {
  id: 'TASK-001',
  projectId: 'PRJ-001',
  title: 'Survey the site',
  description: 'Walk every room and note the cable routes.',
  status: 'In progress',
  priority: 'High',
  assigneeId: 'TECH-001',
  assigneeName: 'Test Technician One',
  startDate: '2000-01-05',
  dueDate: '2099-01-12',
}

export const taskB: Task = {
  id: 'TASK-002',
  projectId: 'PRJ-001',
  title: 'Order switches',
  description: '',
  status: 'To do',
  priority: 'Low',
  assigneeId: null,
  assigneeName: null,
  startDate: '2000-01-10',
  dueDate: '2000-02-01',
}

export function taskListResponse(tasks: Task[], meta: Partial<TaskListResponse['meta']> = {}): TaskListResponse {
  return {
    data: tasks,
    meta: { page: 1, pageSize: 10, total: tasks.length, totalPages: tasks.length ? 1 : 0, ...meta },
  }
}
