import { render, screen, waitFor, within } from '@testing-library/react'
import { countOverdueTasks, type CrossProjectTask, type Task } from '@lc-projecthub/shared'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProjects } from '../api/projects'
import { searchTasks } from '../api/taskSearch'
import { getTasks, getTechnicians } from '../api/tasks'
import { AllTasksPage } from '../pages/AllTasksPage'
import { listResponse, projectA, taskA, taskListResponse, technicians } from '../test/fixtures'
import { ProjectTasks } from './ProjectTasks'

/*
  The project's task list and the All tasks page both mark a task "Overdue". They must agree, and they must
  agree with the dashboard's count, because all three use the one shared rule (shared/src/taskDates.ts).

  formatDate is replaced by a pass-through here only so rows with a missing or impossible date can be drawn at all
  (the real one cannot format them, and the API never lets such a date be saved). The overdue rule is the real one.
*/
vi.mock('../lib/format', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/format')>()), formatDate: (iso: string) => iso }))
vi.mock('../api/projects', () => ({ getProjects: vi.fn(), getProject: vi.fn() }))
vi.mock('../api/taskSearch', () => ({ searchTasks: vi.fn() }))
vi.mock('../api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn() }))

// "Today" is Tuesday 10 February 2026.
const TODAY = new Date(2026, 1, 10, 9, 0)
let counter = 0
const make = (title: string, dueDate: string, status: Task['status'] = 'To do'): Task => {
  counter += 1
  return { ...taskA, id: `TASK-${String(counter).padStart(3, '0')}`, title, status, dueDate }
}

const cases = {
  'Yesterday, to do': { task: make('Yesterday, to do', '2026-02-09'), overdue: true },
  'Months ago, in progress': { task: make('Months ago, in progress', '2025-11-01', 'In progress'), overdue: true },
  'Long ago, blocked': { task: make('Long ago, blocked', '2020-02-29', 'Blocked'), overdue: true },
  'Due today, to do': { task: make('Due today, to do', '2026-02-10'), overdue: false },
  'Due today, blocked': { task: make('Due today, blocked', '2026-02-10', 'Blocked'), overdue: false },
  'Due tomorrow': { task: make('Due tomorrow', '2026-02-11'), overdue: false },
  'Far in the future': { task: make('Far in the future', '2099-01-01'), overdue: false },
  'Past due but done': { task: make('Past due but done', '2020-01-01', 'Done'), overdue: false },
  'Done yesterday': { task: make('Done yesterday', '2026-02-09', 'Done'), overdue: false },
  'Empty due date': { task: make('Empty due date', ''), overdue: false },
  'Text as due date': { task: make('Text as due date', 'next week'), overdue: false },
  'Impossible due date': { task: make('Impossible due date', '2026-02-30'), overdue: false },
  'Wrong date format': { task: make('Wrong date format', '09/02/2026'), overdue: false },
  'Empty due date, done': { task: make('Empty due date, done', '', 'Done'), overdue: false },
}
const tasks = Object.values(cases).map((entry) => entry.task)
const expectedOverdue = Object.entries(cases).filter(([, entry]) => entry.overdue).map(([title]) => title).sort()

const overdueTitles = () =>
  [...document.querySelectorAll('table tbody tr')]
    .filter((row) => within(row as HTMLElement).queryByText('Overdue'))
    .map((row) => row.querySelector('th')!.childNodes[0].textContent!.trim())
    .sort()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: TODAY })
  vi.mocked(getTechnicians).mockResolvedValue(technicians)
  vi.mocked(getProjects).mockResolvedValue(listResponse([projectA]))
  vi.mocked(getTasks).mockResolvedValue(taskListResponse(tasks, { pageSize: 50 }))
  vi.mocked(searchTasks).mockResolvedValue({
    data: tasks.map((task): CrossProjectTask => ({ ...task, projectName: projectA.name })),
    meta: { page: 1, pageSize: 50, total: tasks.length, totalPages: 1 },
    summary: { outstanding: 0, overdue: 0 },
  })
})
afterEach(() => vi.useRealTimers())

describe('overdue rules are the same on every screen', () => {
  it('the project task list marks exactly the overdue tasks', async () => {
    render(
      <MemoryRouter>
        <ProjectTasks projectId="PRJ-001" />
      </MemoryRouter>,
    )
    await screen.findByText('Yesterday, to do')
    expect(overdueTitles()).toEqual(expectedOverdue)
  })

  it('the All tasks page marks exactly the overdue tasks', async () => {
    render(
      <MemoryRouter>
        <AllTasksPage />
      </MemoryRouter>,
    )
    await screen.findByText('Yesterday, to do')
    expect(overdueTitles()).toEqual(expectedOverdue)
  })

  it('both screens mark the same tasks as each other and as many as the dashboard counts', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <ProjectTasks projectId="PRJ-001" />
      </MemoryRouter>,
    )
    await screen.findByText('Yesterday, to do')
    const onProjectPage = overdueTitles()
    unmount()

    render(
      <MemoryRouter>
        <AllTasksPage />
      </MemoryRouter>,
    )
    await screen.findByText('Yesterday, to do')
    await waitFor(() => expect(overdueTitles().length).toBeGreaterThan(0))
    expect(overdueTitles()).toEqual(onProjectPage)
    expect(onProjectPage).toHaveLength(countOverdueTasks(tasks, TODAY))
  })

  it.each(Object.entries(cases))('"%s" is treated the same way on both screens', async (title, { overdue }) => {
    for (const page of [
      <ProjectTasks key="project" projectId="PRJ-001" />,
      <AllTasksPage key="all" />,
    ]) {
      const { unmount } = render(<MemoryRouter>{page}</MemoryRouter>)
      const row = (await screen.findByText(title)).closest('tr')!
      expect(within(row).queryByText('Overdue') !== null).toBe(overdue)
      unmount()
    }
  })
})
