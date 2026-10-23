import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Task, TaskListResponse } from '@lc-projecthub/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { getProjects } from '../api/projects'
import { getTasks } from '../api/tasks'
import { listResponse, projectA, projectB, projectC, taskA, taskListResponse } from '../test/fixtures'
import { Dashboard } from './Dashboard'

vi.mock('../api/projects', () => ({ getProjects: vi.fn(), getProject: vi.fn() }))
vi.mock('../api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn() }))
const getProjectsMock = vi.mocked(getProjects)
const getTasksMock = vi.mocked(getTasks)

// Wednesday 10 June 2026: this week is Monday 8 June to Sunday 14 June.
const NOW = new Date(2026, 5, 10, 12, 0)
const WEEK_HINT = 'Mon 8 Jun – Sun 14 Jun'

const task = (id: string, projectId: string, dueDate: string, status: Task['status'] = 'To do'): Task => ({
  ...taskA,
  id,
  projectId,
  dueDate,
  status,
})

/** Serves a fixed set of tasks per project, in the same response format as the real API. */
function serveTasks(byProject: Record<string, Task[]>) {
  getTasksMock.mockImplementation(async (projectId) => taskListResponse(byProject[projectId] ?? []))
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  )
}

const card = (label: string) => screen.getByText(label).closest('.stat-card') as HTMLElement
const valueOf = (label: string) => card(label).querySelector('.stat-card__value')?.textContent

beforeEach(() => {
  // Only the clock is faked, so promises and timers behave normally.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  getProjectsMock.mockReset()
  getTasksMock.mockReset()
  serveTasks({})
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Dashboard', () => {
  it('shows a loading state while projects load', () => {
    getProjectsMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading dashboard…')).toBeTruthy()
  })

  it('builds its project figures from the API data', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB, projectC]))
    renderPage()

    const figures = await screen.findByRole('region', { name: 'Key figures' })
    // Of three projects, two are unfinished and one is delayed.
    expect(valueOf('Active projects')).toBe('2')
    expect(within(figures).getByText('3 projects in total')).toBeTruthy()
    expect(valueOf('Need attention')).toBe('1')

    expect(getProjectsMock).toHaveBeenCalledWith({ pageSize: 100 }, expect.any(AbortSignal))
    expect(screen.getByRole('link', { name: 'View all 3 projects' }).getAttribute('href')).toBe('/projects')
  })

  it('lists unfinished projects by deadline and links to their detail pages', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectB, projectA, projectC]))
    renderPage()

    await screen.findByRole('region', { name: 'Key figures' })
    const table = screen.getByRole('table')
    const names = within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent)
    // Alpha is due before Bravo; the completed project is left out.
    expect(names).toEqual(['Alpha Network', 'Bravo Laptops'])
    expect(within(table).getByRole('link', { name: 'Alpha Network' }).getAttribute('href')).toBe('/projects/PRJ-001')
  })

  it('labels the figures with no data behind them as sample data, and nothing that comes from the API', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB, projectC]))
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('0'))

    const section = (name: string) => screen.getByRole('heading', { name }).closest('section') as HTMLElement

    // Calculated from the API (projects and tasks): no sample label.
    expect(within(card('Active projects')).queryByText('Sample data')).toBeNull()
    expect(within(card('Need attention')).queryByText('Sample data')).toBeNull()
    expect(within(card('Tasks due this week')).queryByText('Sample data')).toBeNull()
    expect(within(section('Projects at a glance')).queryByText('Sample data')).toBeNull()
    expect(within(section('Status breakdown')).queryByText('Sample data')).toBeNull()

    // Nothing in the API to calculate these from: still hard-coded, still labelled.
    expect(within(card('Equipment deployed')).getByText('Sample data')).toBeTruthy()
    expect(within(section('Upcoming milestones')).getByText('Sample data')).toBeTruthy()
    expect(within(section('Recent activity')).getByText('Sample data')).toBeTruthy()
    expect(screen.getAllByText('Sample data')).toHaveLength(3)
  })

  it('warns when the figures cover only part of the data', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB], { total: 150, pageSize: 100, totalPages: 2 }))
    renderPage()
    const note = await screen.findByRole('note')
    expect(note.textContent).toBe('Project figures on this page are based on the first 2 of 150 projects.')
  })

  it('shows no warning when every project is included', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB]))
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('shows an error with retry when projects cannot be loaded, and does not ask for tasks', async () => {
    getProjectsMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    getProjectsMock.mockResolvedValueOnce(listResponse([projectA]))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The dashboard could not be loaded')).toBeTruthy()
    expect(getTasksMock).not.toHaveBeenCalled()

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Key figures' })).toBeTruthy()
  })
})

describe('Dashboard: Tasks due this week', () => {
  it('counts real tasks from the API, not the old hard-coded 14', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB]))
    serveTasks({
      'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-08'), task('TASK-2', 'PRJ-001', '2026-06-10', 'In progress')],
      'PRJ-002': [task('TASK-3', 'PRJ-002', '2026-06-14', 'Blocked')],
    })
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('3'))
    // The value is the calculated count (3), not the old constant. (The hint legitimately mentions "Sun 14 Jun".)
    expect(valueOf('Tasks due this week')).not.toBe('14')
  })

  it('counts tasks across every project, asking the tasks API for each one', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB, projectC]))
    serveTasks({
      'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-09')],
      'PRJ-002': [task('TASK-2', 'PRJ-002', '2026-06-09')],
      'PRJ-003': [task('TASK-3', 'PRJ-003', '2026-06-09')],
    })
    renderPage()
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('3'))
    expect(getTasksMock.mock.calls.map((call) => call[0]).sort()).toEqual(['PRJ-001', 'PRJ-002', 'PRJ-003'])
    expect(getTasksMock).toHaveBeenCalledWith('PRJ-001', { page: 1, pageSize: 100 }, expect.any(AbortSignal))
  })

  it('includes Monday and Sunday, and leaves out the days either side of the week', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({
      'PRJ-001': [
        task('TASK-1', 'PRJ-001', '2026-06-07'), // the Sunday before
        task('TASK-2', 'PRJ-001', '2026-06-08'), // Monday: counted
        task('TASK-3', 'PRJ-001', '2026-06-14'), // Sunday: counted
        task('TASK-4', 'PRJ-001', '2026-06-15'), // the Monday after
      ],
    })
    renderPage()
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('2'))
  })

  it('does not count finished tasks, tasks with no or invalid due date, or tasks due in other weeks', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({
      'PRJ-001': [
        task('TASK-1', 'PRJ-001', '2026-06-10'), // counted
        task('TASK-2', 'PRJ-001', '2026-06-10', 'Done'), // finished
        { ...task('TASK-3', 'PRJ-001', '2026-06-10'), dueDate: '' }, // no due date
        { ...task('TASK-4', 'PRJ-001', '2026-06-10'), dueDate: '2026-02-30' }, // not a real date
        task('TASK-5', 'PRJ-001', '2026-05-20'), // overdue, earlier week
        task('TASK-6', 'PRJ-001', '2026-09-01'), // later
      ],
    })
    renderPage()
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('1'))
  })

  it('explains what is counted, including the week', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({ 'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-10')] })
    renderPage()
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('1'))
    expect(card('Tasks due this week').textContent).toContain(`Not yet done, due ${WEEK_HINT}`)
  })

  it('moves to the next week on Monday', async () => {
    vi.setSystemTime(new Date(2026, 5, 15, 0, 0)) // Monday 15 June
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({ 'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-14'), task('TASK-2', 'PRJ-001', '2026-06-15')] })
    renderPage()
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('1'))
    expect(card('Tasks due this week').textContent).toContain('Mon 15 Jun – Sun 21 Jun')
  })

  it('shows a real zero, with its own wording, when nothing outstanding is due', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({ 'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-10', 'Done'), task('TASK-2', 'PRJ-001', '2026-08-01')] })
    renderPage()
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('0'))
    expect(card('Tasks due this week').textContent).toContain(`Nothing outstanding is due ${WEEK_HINT}`)
    expect(within(card('Tasks due this week')).queryByRole('alert')).toBeNull()
  })

  it('shows a zero when there are no tasks at all', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({})
    renderPage()
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('0'))
  })

  it('shows a loading state, never a number, until the tasks arrive', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    let release!: (value: TaskListResponse) => void
    getTasksMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })

    const tasksCard = card('Tasks due this week')
    expect(tasksCard.textContent).toContain('Loading task data…')
    expect(valueOf('Tasks due this week')).toBe('—')
    expect(valueOf('Tasks due this week')).not.toBe('0')
    expect(tasksCard.getAttribute('aria-busy')).toBe('true')
    // The rest of the dashboard is usable meanwhile.
    expect(valueOf('Active projects')).toBe('1')

    release(taskListResponse([task('TASK-1', 'PRJ-001', '2026-06-10')]))
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('1'))
    expect(tasksCard.getAttribute('aria-busy')).toBe('false')
  })

  it('does not ask for tasks, or show a count, before the projects have loaded', async () => {
    getProjectsMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.queryByText('Tasks due this week')).toBeNull()
    expect(getTasksMock).not.toHaveBeenCalled()
  })

  it('shows an error, never a fabricated zero, when the tasks cannot be loaded', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    getTasksMock.mockRejectedValue(new ApiRequestError('The server could not be reached.', 0))
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })

    const alert = await within(card('Tasks due this week')).findByRole('alert')
    expect(alert.textContent).toBe('Task data could not be loaded.')
    expect(valueOf('Tasks due this week')).toBe('—')
    expect(card('Tasks due this week').textContent).not.toMatch(/\b0\b/)
    // The project figures are still shown.
    expect(valueOf('Active projects')).toBe('1')
  })

  it('can be retried, and then shows the real count', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    getTasksMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    getTasksMock.mockResolvedValue(taskListResponse([task('TASK-1', 'PRJ-001', '2026-06-11')]))
    renderPage()

    await within(await screen.findByRole('region', { name: 'Key figures' })).findByRole('alert')
    fireEvent.click(within(card('Tasks due this week')).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('1'))
    expect(within(card('Tasks due this week')).queryByRole('alert')).toBeNull()
    expect(within(card('Tasks due this week')).queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('shows an error, not a partial total, when only some projects’ tasks fail to load', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB, projectC]))
    getTasksMock.mockImplementation(async (projectId) => {
      if (projectId === 'PRJ-002') throw new ApiRequestError('Something went wrong on the server.', 500, 'INTERNAL_ERROR')
      return taskListResponse([task(`TASK-${projectId}`, projectId, '2026-06-10')])
    })
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })
    const alert = await within(card('Tasks due this week')).findByRole('alert')
    expect(alert.textContent).toBe('Task data could not be loaded.')
    expect(valueOf('Tasks due this week')).toBe('—')
  })

  it('says so when only the first projects are included', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB], { total: 150, pageSize: 100, totalPages: 2 }))
    serveTasks({ 'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-10')] })
    renderPage()
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('1'))
    expect(card('Tasks due this week').textContent).toContain('(first 2 projects only)')
  })
})
