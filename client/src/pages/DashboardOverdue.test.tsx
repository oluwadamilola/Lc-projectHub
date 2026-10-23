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

// Wednesday 10 June 2026: yesterday is the 9th, tomorrow the 11th; this week is Monday 8 to Sunday 14 June.
const NOW = new Date(2026, 5, 10, 12, 0)

const task = (id: string, projectId: string, dueDate: string, status: Task['status'] = 'To do'): Task => ({
  ...taskA,
  id,
  projectId,
  dueDate,
  status,
})

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

describe('Dashboard: Overdue tasks', () => {
  it('counts outstanding tasks due before today, from the real task data', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({
      'PRJ-001': [
        task('TASK-1', 'PRJ-001', '2026-06-09'), // yesterday: overdue
        task('TASK-2', 'PRJ-001', '2026-05-01', 'In progress'), // overdue
        task('TASK-3', 'PRJ-001', '2026-01-10', 'Blocked'), // overdue
      ],
    })
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('3'))
  })

  it('says what it counts, and carries no sample label', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({ 'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-09')] })
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('1'))
    expect(card('Overdue tasks').textContent).toContain('Outstanding tasks past their due date')
    expect(within(card('Overdue tasks')).queryByText('Sample data')).toBeNull()
    // The three figures with no data behind them are still the only sample ones.
    expect(screen.getAllByText('Sample data')).toHaveLength(3)
  })

  it('treats yesterday as overdue, but today and tomorrow as not overdue', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({
      'PRJ-001': [
        task('TASK-1', 'PRJ-001', '2026-06-09'), // yesterday
        task('TASK-2', 'PRJ-001', '2026-06-10'), // today
        task('TASK-3', 'PRJ-001', '2026-06-11'), // tomorrow
      ],
    })
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('1'))
  })

  it('never counts finished tasks, tasks with no or invalid due date, or tasks due later', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({
      'PRJ-001': [
        task('TASK-1', 'PRJ-001', '2026-06-09'), // counted
        task('TASK-2', 'PRJ-001', '2026-06-09', 'Done'), // finished
        task('TASK-3', 'PRJ-001', '2020-01-01', 'Done'), // finished long ago
        { ...task('TASK-4', 'PRJ-001', '2026-06-09'), dueDate: '' }, // no due date
        { ...task('TASK-5', 'PRJ-001', '2026-06-09'), dueDate: '2026-02-30' }, // not a real date
        task('TASK-6', 'PRJ-001', '2026-06-12'), // later this week
        task('TASK-7', 'PRJ-001', '2026-09-01'), // far future
      ],
    })
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('1'))
  })

  it('totals tasks across every project', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB, projectC]))
    serveTasks({
      'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-01')],
      'PRJ-002': [task('TASK-2', 'PRJ-002', '2026-06-02'), task('TASK-3', 'PRJ-002', '2026-06-03')],
      'PRJ-003': [task('TASK-4', 'PRJ-003', '2026-06-04')],
    })
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('4'))
  })

  it('shares one load of the tasks with the "due this week" card, so there are no duplicate requests', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB, projectC]))
    serveTasks({ 'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-09')] })
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('1'))
    await waitFor(() => expect(valueOf('Tasks due this week')).toBe('1'))
    // Two cards use the task data, yet each project was asked for its tasks exactly once.
    expect(getTasksMock).toHaveBeenCalledTimes(3)
    expect(getTasksMock.mock.calls.map((call) => call[0]).sort()).toEqual(['PRJ-001', 'PRJ-002', 'PRJ-003'])
  })

  it('keeps the "due this week" figure exactly as defined, alongside the overdue figure', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({
      'PRJ-001': [
        task('TASK-1', 'PRJ-001', '2026-06-08'), // Monday: in the week, and already past (overdue)
        task('TASK-2', 'PRJ-001', '2026-06-10'), // today: in the week, not overdue
        task('TASK-3', 'PRJ-001', '2026-06-12'), // Friday: in the week, not overdue
        task('TASK-4', 'PRJ-001', '2026-06-01'), // last week: overdue, not in the week
        task('TASK-5', 'PRJ-001', '2026-06-01', 'Done'), // finished: neither
      ],
    })
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('2'))
    expect(valueOf('Tasks due this week')).toBe('3')
    // The overlap is real and visible: Monday's task is in both figures.
    expect(card('Tasks due this week').textContent).toContain('Mon 8 Jun – Sun 14 Jun')
  })

  it('moves a task from "not overdue" to "overdue" when the day changes', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({ 'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-10')] })
    vi.setSystemTime(new Date(2026, 5, 10, 23, 59, 59))
    const first = renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('0'))
    first.unmount()

    vi.setSystemTime(new Date(2026, 5, 11, 0, 0, 1))
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('1'))
  })

  it('is information only: not a link, because there is no tasks view to send people to', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({ 'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-09')] })
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('1'))
    expect(within(card('Overdue tasks')).queryByRole('link')).toBeNull()
  })

  it('shows a real zero, with its own wording, when nothing is overdue', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    serveTasks({ 'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-10'), task('TASK-2', 'PRJ-001', '2020-01-01', 'Done')] })
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('0'))
    expect(card('Overdue tasks').textContent).toContain('No outstanding tasks are past their due date')
    expect(within(card('Overdue tasks')).queryByRole('alert')).toBeNull()
    expect(within(card('Overdue tasks')).queryByRole('button')).toBeNull()
  })

  it('shows a zero when there are no tasks at all', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('0'))
  })

  it('shows a loading state, never a number, until the tasks arrive', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    let release!: (value: TaskListResponse) => void
    getTasksMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })

    const overdue = card('Overdue tasks')
    expect(overdue.textContent).toContain('Loading task data…')
    expect(valueOf('Overdue tasks')).toBe('—')
    expect(valueOf('Overdue tasks')).not.toBe('0')
    expect(overdue.getAttribute('aria-busy')).toBe('true')
    expect(valueOf('Active projects')).toBe('1')

    release(taskListResponse([task('TASK-1', 'PRJ-001', '2026-06-09')]))
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('1'))
    expect(overdue.getAttribute('aria-busy')).toBe('false')
  })

  it('does not show a count, or ask for tasks, before the projects have loaded', () => {
    getProjectsMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.queryByText('Overdue tasks')).toBeNull()
    expect(getTasksMock).not.toHaveBeenCalled()
  })

  it('shows an error, never a fabricated zero, when the tasks cannot be loaded', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    getTasksMock.mockRejectedValue(new ApiRequestError('The server could not be reached.', 0))
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })

    const alert = await within(card('Overdue tasks')).findByRole('alert')
    expect(alert.textContent).toBe('Task data could not be loaded.')
    expect(valueOf('Overdue tasks')).toBe('—')
    expect(card('Overdue tasks').textContent).not.toMatch(/\b0\b/)
    // The project figures are unaffected.
    expect(valueOf('Active projects')).toBe('1')
  })

  it('shows an error, not a partial total, when only some projects fail to load', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB, projectC]))
    getTasksMock.mockImplementation(async (projectId) => {
      if (projectId === 'PRJ-002') throw new ApiRequestError('Something went wrong on the server.', 500, 'INTERNAL_ERROR')
      return taskListResponse([task(`TASK-${projectId}`, projectId, '2026-06-01')])
    })
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })
    await within(card('Overdue tasks')).findByRole('alert')
    expect(valueOf('Overdue tasks')).toBe('—')
    expect(valueOf('Tasks due this week')).toBe('—')
  })

  it('can be retried, and one retry recovers both task figures', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    getTasksMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    getTasksMock.mockResolvedValue(
      taskListResponse([task('TASK-1', 'PRJ-001', '2026-06-09'), task('TASK-2', 'PRJ-001', '2026-06-11')]),
    )
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })
    await within(card('Overdue tasks')).findByRole('alert')

    fireEvent.click(within(card('Overdue tasks')).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('1'))
    expect(valueOf('Tasks due this week')).toBe('2')
    expect(within(card('Overdue tasks')).queryByRole('alert')).toBeNull()
    expect(within(card('Overdue tasks')).queryByRole('button', { name: 'Try again' })).toBeNull()
    // The failed attempt plus the retry: still one request per attempt, not one per card.
    expect(getTasksMock).toHaveBeenCalledTimes(2)
  })

  it('does not bring back an old number after a failed retry', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    getTasksMock.mockRejectedValue(new ApiRequestError('The server could not be reached.', 0))
    renderPage()
    await within(await screen.findByRole('region', { name: 'Key figures' })).findAllByRole('alert')
    fireEvent.click(within(card('Overdue tasks')).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(getTasksMock).toHaveBeenCalledTimes(2))
    await within(card('Overdue tasks')).findByRole('alert')
    expect(valueOf('Overdue tasks')).toBe('—')
  })

  it('says so when only the first projects are included', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB], { total: 150, pageSize: 100, totalPages: 2 }))
    serveTasks({ 'PRJ-001': [task('TASK-1', 'PRJ-001', '2026-06-01')] })
    renderPage()
    await waitFor(() => expect(valueOf('Overdue tasks')).toBe('1'))
    expect(card('Overdue tasks').textContent).toContain('(first 2 projects only)')
  })
})
