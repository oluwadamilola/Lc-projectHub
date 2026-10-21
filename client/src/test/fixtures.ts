import type { Project, ProjectListResponse } from '@lc-projecthub/shared'

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
