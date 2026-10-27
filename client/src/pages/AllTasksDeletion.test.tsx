import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AllTasksResponse, CrossProjectTask } from '@lc-projecthub/shared'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { getProjects } from '../api/projects'
import { searchTasks } from '../api/taskSearch'
import { deleteTask, getTechnicians } from '../api/tasks'
import { listResponse, projectA, projectB, taskA, taskB, technicians } from '../test/fixtures'
import { AllTasksPage } from './AllTasksPage'

vi.mock('../api/projects', () => ({ getProjects: vi.fn(), getProject: vi.fn() }))
vi.mock('../api/taskSearch', () => ({ searchTasks: vi.fn() }))
vi.mock('../api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn(), deleteTask: vi.fn() }))
const searchMock = vi.mocked(searchTasks)
const deleteTaskMock = vi.mocked(deleteTask)

// "Today" is Tuesday 10 February 2026: taskB (due 2000) is overdue, taskA (due 2099) is not.
const rowA: CrossProjectTask = { ...taskA, projectName: 'Alpha Network' }
const rowB: CrossProjectTask = { ...taskB, projectName: 'Alpha Network' }
const rowC: CrossProjectTask = { ...taskA, id: 'TASK-004', projectId: 'PRJ-002', projectName: 'Bravo Laptops', title: 'Image the laptops' }

function response(rows: CrossProjectTask[], summary = { outstanding: rows.length, overdue: 0 }, meta: Partial<AllTasksResponse['meta']> = {}): AllTasksResponse {
  return { data: rows, meta: { page: 1, pageSize: 10, total: rows.length, totalPages: rows.length ? 1 : 0, ...meta }, summary }
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="address">{location.pathname + location.search}</output>
}
function renderPage(url = '/tasks') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AllTasksPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}
const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement
const counts = () => screen.getByText(/Of these tasks/).textContent

beforeEach(() => {
  searchMock.mockReset()
  deleteTaskMock.mockReset()
  vi.mocked(getProjects).mockReset().mockResolvedValue(listResponse([projectA, projectB]))
  vi.mocked(getTechnicians).mockReset().mockResolvedValue(technicians)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 1, 10, 9, 0) })
})
afterEach(() => vi.useRealTimers())

describe('deleting from the All tasks page', () => {
  it('offers Delete on every row, naming the task and using that task\'s own project', async () => {
    searchMock.mockResolvedValue(response([rowA, rowC]))
    renderPage()
    await screen.findByText('Image the laptops')
    expect(within(rowOf('Survey the site')).getByRole('button', { name: 'Delete task TASK-001: Survey the site' })).toBeTruthy()

    fireEvent.click(within(rowOf('Image the laptops')).getByRole('button', { name: /Delete/ }))
    expect(screen.getByRole('alertdialog', { name: 'Delete task TASK-004?' })).toBeTruthy()
    deleteTaskMock.mockResolvedValue(rowC)
    searchMock.mockResolvedValue(response([rowA]))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await waitFor(() => expect(deleteTaskMock).toHaveBeenCalledWith('PRJ-002', 'TASK-004'))
  })

  it('cancelling leaves the list, the counts and the address unchanged and sends nothing', async () => {
    searchMock.mockResolvedValue(response([rowA, rowB], { outstanding: 2, overdue: 1 }))
    renderPage('/tasks?status=To%20do')
    await screen.findByText('Survey the site')
    const before = counts()

    fireEvent.click(within(rowOf('Survey the site')).getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deleteTaskMock).not.toHaveBeenCalled()
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(counts()).toBe(before)
    expect(screen.getByLabelText('address').textContent).toBe('/tasks?status=To%20do')
  })

  it('after a confirmed deletion reloads with the same filters and shows the new counts', async () => {
    searchMock.mockResolvedValueOnce(response([rowA, rowB], { outstanding: 2, overdue: 1 }))
    searchMock.mockResolvedValueOnce(response([rowA], { outstanding: 1, overdue: 0 }))
    deleteTaskMock.mockResolvedValue(rowB)
    renderPage('/tasks?priority=Low')
    await screen.findByText('Order switches')
    expect(counts()).toContain('2 outstanding')
    expect(counts()).toContain('1 overdue')

    fireEvent.click(within(rowOf('Order switches')).getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))

    await waitFor(() => expect(screen.queryByText('Order switches')).toBeNull())
    expect(counts()).toContain('1 outstanding')
    expect(counts()).toContain('0 overdue')
    expect(screen.getByText('Task TASK-002 “Order switches” was deleted.')).toBeTruthy()
    expect(searchMock).toHaveBeenCalledTimes(2)
    expect(searchMock.mock.calls[1][0]).toMatchObject({ priority: 'Low' }) // the filters are kept
    expect(screen.getByLabelText('address').textContent).toBe('/tasks?priority=Low')
  })

  it('shows the empty state, not a stale row, when the last matching task is deleted', async () => {
    searchMock.mockResolvedValueOnce(response([rowB], { outstanding: 1, overdue: 1 }))
    searchMock.mockResolvedValueOnce(response([]))
    deleteTaskMock.mockResolvedValue(rowB)
    renderPage('/tasks?q=switches')
    await screen.findByText('Order switches')
    fireEvent.click(within(rowOf('Order switches')).getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(await screen.findByText('No tasks match your filters')).toBeTruthy()
    expect(screen.getByText(/was deleted/)).toBeTruthy()
  })

  it('on failure keeps the row and the counts, claims no success, and can be retried', async () => {
    searchMock.mockResolvedValueOnce(response([rowA, rowB], { outstanding: 2, overdue: 1 }))
    deleteTaskMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached. Check your connection and try again.', 0))
    deleteTaskMock.mockResolvedValueOnce(rowB)
    renderPage()
    await screen.findByText('Order switches')

    fireEvent.click(within(rowOf('Order switches')).getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be reached')
    expect(screen.getByText('Order switches')).toBeTruthy()
    expect(counts()).toContain('2 outstanding')
    expect(screen.queryByText(/was deleted/)).toBeNull()
    expect(searchMock).toHaveBeenCalledTimes(1)

    searchMock.mockResolvedValueOnce(response([rowA], { outstanding: 1, overdue: 0 }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await waitFor(() => expect(screen.queryByText('Order switches')).toBeNull())
    expect(counts()).toContain('1 outstanding')
  })

  it('is not sent twice by a double click', async () => {
    searchMock.mockResolvedValue(response([rowA]))
    let finish!: (value: CrossProjectTask) => void
    deleteTaskMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderPage()
    await screen.findByText('Survey the site')
    fireEvent.click(within(rowOf('Survey the site')).getByRole('button', { name: /Delete/ }))
    const confirm = screen.getByRole('button', { name: 'Delete task' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(deleteTaskMock).toHaveBeenCalledTimes(1)
    finish(rowA)
  })

  it('steps back a page when the only task on the last page is deleted', async () => {
    let deleted = false
    searchMock.mockImplementation(async (params) => {
      if (deleted) return response([rowB], { outstanding: 1, overdue: 1 }, { total: 10, totalPages: 1 })
      return params?.page === 2
        ? response([rowA], { outstanding: 1, overdue: 0 }, { page: 2, total: 11, totalPages: 2 })
        : response([rowB], { outstanding: 2, overdue: 1 }, { total: 11, totalPages: 2 })
    })
    deleteTaskMock.mockImplementation(async () => {
      deleted = true
      return rowA
    })
    renderPage('/tasks?page=2')
    await screen.findByText('Survey the site')

    fireEvent.click(within(rowOf('Survey the site')).getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))

    await waitFor(() => expect(screen.getByLabelText('address').textContent).toBe('/tasks'))
    expect(await screen.findByText('Order switches')).toBeTruthy()
    expect(screen.queryByText('No tasks match your filters')).toBeNull()
  })
})
