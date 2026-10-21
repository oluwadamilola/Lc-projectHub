import type { Technician } from '@lc-projecthub/shared'
import type { TaskRecord } from '../domain/taskRepository.js'

/** Small, fixed, fictional data so task tests do not depend on the date or on the demo seed. */
export const fixtureTechnicians: Technician[] = [
  { id: 'TECH-001', name: 'Test Technician One', team: 'Test Team A' },
  { id: 'TECH-002', name: 'Test Technician Two', team: 'Test Team B' },
]

/** Tasks for the fixture projects PRJ-001 (four tasks) and PRJ-002 (one task); PRJ-003 has none. */
export const fixtureTasks: TaskRecord[] = [
  {
    id: 'TASK-001',
    projectId: 'PRJ-001',
    title: 'Survey the site',
    description: 'Walk every room and note the cable routes.',
    status: 'Done',
    priority: 'High',
    assigneeId: 'TECH-001',
    startDate: '2026-01-05',
    dueDate: '2026-01-12',
  },
  {
    id: 'TASK-002',
    projectId: 'PRJ-001',
    title: 'Order switches',
    description: 'Raise the purchase request.',
    status: 'In progress',
    priority: 'Medium',
    assigneeId: 'TECH-002',
    startDate: '2026-01-10',
    dueDate: '2026-02-01',
  },
  {
    id: 'TASK-003',
    projectId: 'PRJ-001',
    title: 'Install switches',
    description: '',
    status: 'To do',
    priority: 'High',
    assigneeId: null,
    startDate: '2026-02-02',
    dueDate: '2026-02-20',
  },
  {
    id: 'TASK-004',
    projectId: 'PRJ-002',
    title: 'Image the laptops',
    description: 'Apply the standard build.',
    status: 'Blocked',
    priority: 'Critical',
    assigneeId: 'TECH-001',
    startDate: '2026-01-20',
    dueDate: '2026-02-10',
  },
  {
    id: 'TASK-005',
    projectId: 'PRJ-001',
    title: 'Test the network',
    description: 'Certify every run.',
    status: 'To do',
    priority: 'Low',
    assigneeId: 'TECH-002',
    startDate: '2026-02-21',
    dueDate: '2026-02-28',
  },
]
