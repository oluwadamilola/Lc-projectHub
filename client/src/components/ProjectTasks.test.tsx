import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { getTasks, getTechnicians } from '../api/tasks'
import { taskA, taskB, taskListResponse, technicians } from '../test/fixtures'
import { ProjectTasks } from './ProjectTasks'

vi.mock('../api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn() }))
const getTasksMock = vi.mocked(getTasks)
const getTechniciansMock = vi.mocked(getTechnicians)

function renderTasks() {
  return render(
    <MemoryRouter>
      <ProjectTasks projectId="PRJ-001" />
    </MemoryRouter>,
  )
}

const lastParams = () => getTasksMock.mock.calls.at(-1)?.[1]

beforeEach(() => {
  getTasksMock.mockReset()
  getTechniciansMock.mockReset().mockResolvedValue(technicians)
})

describe('ProjectTasks', () => {
  it('shows a loading state, then the tasks', async () => {
    let resolve!: (value: ReturnType<typeof taskListResponse>) => void
    getTasksMock.mockReturnValue(new Promise((r) => (resolve = r)))
    renderTasks()
    expect(screen.getByText('Loading tasks…')).toBeTruthy()

    resolve(taskListResponse([taskA, taskB]))
    expect(await screen.findByText('Survey the site')).toBeTruthy()
    expect(screen.queryByText('Loading tasks…')).toBeNull()
    expect(getTasksMock).toHaveBeenCalledWith('PRJ-001', { q: undefined, status: undefined, assignee: undefined, page: 1, pageSize: 10 }, expect.any(AbortSignal))
  })

  it('shows reference, title, status, priority, technician and due date', async () => {
    getTasksMock.mockResolvedValue(taskListResponse([taskA]))
    renderTasks()
    const row = (await screen.findByText('Survey the site')).closest('tr')!
    const cells = within(row)
    expect(cells.getByText('TASK-001')).toBeTruthy()
    expect(cells.getByText('In progress')).toBeTruthy()
    expect(cells.getByText('High')).toBeTruthy()
    expect(cells.getByText('Test Technician One')).toBeTruthy()
    expect(cells.getByText('12 Jan 2099')).toBeTruthy()
    expect(screen.getByText(/Showing 1–1 of 1 tasks/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Tasks \(1\)/ })).toBeTruthy()
  })

  it('shows "Unassigned" and marks overdue tasks, but not finished ones', async () => {
    const done = { ...taskB, id: 'TASK-003', title: 'Old but finished', status: 'Done' as const }
    getTasksMock.mockResolvedValue(taskListResponse([taskB, done, taskA]))
    renderTasks()
    const overdueRow = (await screen.findByText('Order switches')).closest('tr')!
    expect(within(overdueRow).getByText('Unassigned')).toBeTruthy()
    expect(within(overdueRow).getByText('Overdue')).toBeTruthy()
    expect(within(screen.getByText('Old but finished').closest('tr')!).queryByText('Overdue')).toBeNull()
    expect(within(screen.getByText('Survey the site').closest('tr')!).queryByText('Overdue')).toBeNull()
  })

  it('links to add a task and to edit each task, with accessible names', async () => {
    getTasksMock.mockResolvedValue(taskListResponse([taskA]))
    renderTasks()
    await screen.findByText('Survey the site')
    expect(screen.getByRole('link', { name: 'Add task' }).getAttribute('href')).toBe('/projects/PRJ-001/tasks/new')
    const edit = screen.getByRole('link', { name: 'Edit task TASK-001: Survey the site' })
    expect(edit.getAttribute('href')).toBe('/projects/PRJ-001/tasks/TASK-001/edit')
  })

  it('shows an empty state with a way to add the first task', async () => {
    getTasksMock.mockResolvedValue(taskListResponse([]))
    renderTasks()
    expect(await screen.findByText('No tasks yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add the first task' }).getAttribute('href')).toBe('/projects/PRJ-001/tasks/new')
  })

  it('shows an error with a retry that reloads the tasks', async () => {
    getTasksMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    getTasksMock.mockResolvedValueOnce(taskListResponse([taskA]))
    renderTasks()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Tasks could not be loaded')).toBeTruthy()
    expect(within(alert).getByText('The server could not be reached.')).toBeTruthy()

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Survey the site')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('replaces the rows with the error when a refresh fails, so rows never contradict the filters', async () => {
    getTasksMock.mockResolvedValueOnce(taskListResponse([taskA, taskB]))
    getTasksMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    renderTasks()
    await screen.findByText('Survey the site')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Blocked' } })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Survey the site')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('searches after typing pauses and returns to page 1', async () => {
    getTasksMock.mockResolvedValue(taskListResponse([taskA], { total: 12, totalPages: 2 }))
    renderTasks()
    await screen.findByText('Survey the site')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 2 }))

    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: ' cable ' } })
    await waitFor(() => expect(lastParams()).toEqual({ q: 'cable', status: undefined, assignee: undefined, page: 1, pageSize: 10 }))
  })

  it('filters by status and by technician, offering the fictional technicians and Unassigned', async () => {
    getTasksMock.mockResolvedValue(taskListResponse([taskA]))
    renderTasks()
    await screen.findByText('Survey the site')

    const assignee = screen.getByLabelText('Technician') as HTMLSelectElement
    await waitFor(() => expect(within(assignee).getAllByRole('option')).toHaveLength(4))
    expect(within(assignee).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Everyone',
      'Unassigned',
      'Test Technician One',
      'Test Technician Two',
    ])

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Blocked' } })
    await waitFor(() => expect(lastParams()).toMatchObject({ status: 'Blocked', page: 1 }))
    fireEvent.change(assignee, { target: { value: 'unassigned' } })
    await waitFor(() => expect(lastParams()).toMatchObject({ status: 'Blocked', assignee: 'unassigned' }))
    fireEvent.change(assignee, { target: { value: 'TECH-002' } })
    await waitFor(() => expect(lastParams()).toMatchObject({ assignee: 'TECH-002' }))
  })

  it('shows "no tasks match" for filters with no results and can clear them', async () => {
    getTasksMock.mockResolvedValueOnce(taskListResponse([taskA]))
    getTasksMock.mockResolvedValueOnce(taskListResponse([]))
    getTasksMock.mockResolvedValue(taskListResponse([taskA]))
    renderTasks()
    await screen.findByText('Survey the site')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Done' } })
    expect(await screen.findByText('No tasks match your filters')).toBeTruthy()
    // The filtered empty state is not the "add the first task" prompt.
    expect(screen.queryByRole('link', { name: 'Add the first task' })).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[1])
    expect(await screen.findByText('Survey the site')).toBeTruthy()
    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('')
    expect(lastParams()).toEqual({ q: undefined, status: undefined, assignee: undefined, page: 1, pageSize: 10 })
  })

  it('pages through results', async () => {
    getTasksMock.mockResolvedValue(taskListResponse([taskA], { total: 12, totalPages: 2 }))
    renderTasks()
    await screen.findByText('Page 1 of 2')
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 2 }))
  })

  it('still works when the technician list cannot be loaded', async () => {
    getTechniciansMock.mockReset().mockRejectedValue(new ApiRequestError('The server could not be reached.', 0))
    getTasksMock.mockResolvedValue(taskListResponse([taskA]))
    renderTasks()
    expect(await screen.findByText('Survey the site')).toBeTruthy()
    const options = within(screen.getByLabelText('Technician')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Everyone', 'Unassigned'])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
