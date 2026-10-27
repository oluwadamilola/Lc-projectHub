import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { deleteTask, getTasks, getTechnicians } from '../api/tasks'
import { taskA, taskB, taskListResponse, technicians } from '../test/fixtures'
import { DeleteTaskDialog } from './DeleteTaskDialog'
import { ProjectTasks } from './ProjectTasks'

vi.mock('../api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn(), deleteTask: vi.fn() }))
const getTasksMock = vi.mocked(getTasks)
const deleteTaskMock = vi.mocked(deleteTask)

beforeEach(() => {
  getTasksMock.mockReset()
  deleteTaskMock.mockReset()
  vi.mocked(getTechnicians).mockReset().mockResolvedValue(technicians)
})

describe('DeleteTaskDialog', () => {
  const task = { id: 'TASK-001', projectId: 'PRJ-001', title: 'Survey the site' }
  const handlers = () => ({ onCancel: vi.fn(), onDeleted: vi.fn(), onAlreadyGone: vi.fn() })

  it('names the task, says it is permanent, and starts on the safe choice', () => {
    render(<DeleteTaskDialog task={task} {...handlers()} />)
    const dialog = screen.getByRole('alertdialog', { name: 'Delete task TASK-001?' })
    expect(within(dialog).getByText(/Survey the site/)).toBeTruthy()
    expect(within(dialog).getByText(/permanently deletes/)).toBeTruthy()
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deleteTaskMock).not.toHaveBeenCalled()
  })

  it('Cancel and Escape close it without deleting anything', () => {
    const h = handlers()
    render(<DeleteTaskDialog task={task} {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(h.onCancel).toHaveBeenCalledTimes(2)
    expect(deleteTaskMock).not.toHaveBeenCalled()
    expect(h.onDeleted).not.toHaveBeenCalled()
  })

  it('deletes only after the confirm button, and reports success only once the server has answered', async () => {
    let finish!: (value: typeof taskA) => void
    deleteTaskMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const h = handlers()
    render(<DeleteTaskDialog task={task} {...h} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(deleteTaskMock).toHaveBeenCalledWith('PRJ-001', 'TASK-001')
    expect(h.onDeleted).not.toHaveBeenCalled() // still waiting for the server

    finish(taskA)
    await waitFor(() => expect(h.onDeleted).toHaveBeenCalledWith(taskA))
  })

  it('cannot be submitted twice while the request is running', async () => {
    let finish!: (value: typeof taskA) => void
    deleteTaskMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<DeleteTaskDialog task={task} {...handlers()} />)
    const confirm = screen.getByRole('button', { name: 'Delete task' })

    fireEvent.click(confirm)
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(deleteTaskMock).toHaveBeenCalledTimes(1)
    const busy = screen.getByRole('button', { name: 'Deleting…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alertdialog').getAttribute('aria-busy')).toBe('true')
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' }) // Escape cannot abandon a request in flight
    finish(taskA)
  })

  it('shows a server failure, never reports success, and can be retried', async () => {
    deleteTaskMock.mockRejectedValueOnce(new ApiRequestError('The server is currently unavailable. Please try again shortly.', 503))
    deleteTaskMock.mockResolvedValueOnce(taskA)
    const h = handlers()
    render(<DeleteTaskDialog task={task} {...h} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('The server is currently unavailable. Please try again shortly.')
    expect(h.onDeleted).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Delete task' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await waitFor(() => expect(h.onDeleted).toHaveBeenCalledTimes(1))
    expect(deleteTaskMock).toHaveBeenCalledTimes(2)
  })

  it('treats an unreachable server as a failure too', async () => {
    deleteTaskMock.mockRejectedValue(new ApiRequestError('The server could not be reached. Check your connection and try again.', 0))
    const h = handlers()
    render(<DeleteTaskDialog task={task} {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be reached')
    expect(h.onDeleted).not.toHaveBeenCalled()
  })

  it('on a 404 explains the task may already be gone and asks the list to refresh', async () => {
    deleteTaskMock.mockRejectedValue(new ApiRequestError('Task TASK-001 was not found in project PRJ-001.', 404, 'NOT_FOUND'))
    const h = handlers()
    render(<DeleteTaskDialog task={task} {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Task TASK-001 was not found in project PRJ-001.')
    expect(alert.textContent).toContain('may already have been deleted')
    expect(h.onAlreadyGone).toHaveBeenCalledTimes(1)
    expect(h.onDeleted).not.toHaveBeenCalled()
  })
})

describe('deleting from the project\'s task list', () => {
  function renderTasks() {
    return render(
      <MemoryRouter>
        <ProjectTasks projectId="PRJ-001" />
      </MemoryRouter>,
    )
  }
  const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement

  it('offers a Delete action on every row that names its task', async () => {
    getTasksMock.mockResolvedValue(taskListResponse([taskA, taskB]))
    renderTasks()
    await screen.findByText('Survey the site')
    expect(within(rowOf('Survey the site')).getByRole('button', { name: 'Delete task TASK-001: Survey the site' })).toBeTruthy()
    expect(within(rowOf('Order switches')).getByRole('button', { name: 'Delete task TASK-002: Order switches' })).toBeTruthy()
  })

  it('opens a confirmation, and cancelling leaves the list and the data alone', async () => {
    getTasksMock.mockResolvedValue(taskListResponse([taskA, taskB]))
    renderTasks()
    await screen.findByText('Survey the site')

    fireEvent.click(within(rowOf('Survey the site')).getByRole('button', { name: /Delete/ }))
    expect(screen.getByRole('alertdialog', { name: 'Delete task TASK-001?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deleteTaskMock).not.toHaveBeenCalled()
    expect(getTasksMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Survey the site')).toBeTruthy()
    expect(screen.queryByText(/was deleted/)).toBeNull()
  })

  it('after a confirmed deletion reloads the list, shows what was deleted, and moves focus to it', async () => {
    getTasksMock.mockResolvedValueOnce(taskListResponse([taskA, taskB]))
    getTasksMock.mockResolvedValueOnce(taskListResponse([taskB]))
    deleteTaskMock.mockResolvedValue(taskA)
    renderTasks()
    await screen.findByText('Survey the site')

    fireEvent.click(within(rowOf('Survey the site')).getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))

    await waitFor(() => expect(screen.queryByText('Survey the site')).toBeNull())
    expect(deleteTaskMock).toHaveBeenCalledWith('PRJ-001', 'TASK-001')
    expect(screen.getByText('Order switches')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const notice = screen.getByText(/was deleted/)
    expect(notice.textContent).toBe('Task TASK-001 “Survey the site” was deleted.')
    expect(notice.getAttribute('role')).toBe('status')
    expect(document.activeElement).toBe(notice)
    expect(getTasksMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the row and shows no success message when the server fails, then succeeds on retry', async () => {
    getTasksMock.mockResolvedValue(taskListResponse([taskA, taskB]))
    deleteTaskMock.mockRejectedValueOnce(new ApiRequestError('The server is currently unavailable. Please try again shortly.', 503))
    deleteTaskMock.mockResolvedValueOnce(taskA)
    renderTasks()
    await screen.findByText('Survey the site')

    fireEvent.click(within(rowOf('Survey the site')).getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect((await screen.findByRole('alert')).textContent).toContain('currently unavailable')
    expect(screen.getByText('Survey the site')).toBeTruthy()
    expect(screen.queryByText(/was deleted/)).toBeNull()
    expect(getTasksMock).toHaveBeenCalledTimes(1) // nothing changed, so nothing was reloaded

    getTasksMock.mockResolvedValue(taskListResponse([taskB]))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await waitFor(() => expect(screen.queryByText('Survey the site')).toBeNull())
    expect(screen.getByText(/was deleted/)).toBeTruthy()
  })

  it('refreshes the list when the task turns out to be gone already', async () => {
    getTasksMock.mockResolvedValueOnce(taskListResponse([taskA, taskB]))
    getTasksMock.mockResolvedValueOnce(taskListResponse([taskB]))
    deleteTaskMock.mockRejectedValue(new ApiRequestError('Task TASK-001 was not found in project PRJ-001.', 404, 'NOT_FOUND'))
    renderTasks()
    await screen.findByText('Survey the site')

    fireEvent.click(within(rowOf('Survey the site')).getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))

    await waitFor(() => expect(screen.queryByText('Survey the site')).toBeNull())
    expect(screen.getByRole('alert').textContent).toContain('may already have been deleted')
    expect(screen.queryByText(/was deleted\./)).toBeNull() // no false success
  })

  it('steps back a page when the only task on the last page is deleted', async () => {
    let deleted = false
    getTasksMock.mockImplementation(async (_project, params) => {
      if (deleted) return taskListResponse([taskB], { page: 1, total: 10, totalPages: 1 })
      return params?.page === 2
        ? taskListResponse([taskA], { page: 2, total: 11, totalPages: 2 })
        : taskListResponse([taskB], { page: 1, total: 11, totalPages: 2 })
    })
    deleteTaskMock.mockImplementation(async () => {
      deleted = true
      return taskA
    })
    renderTasks()
    await screen.findByText('Order switches')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Survey the site') // page 2 holds just this one task

    fireEvent.click(within(rowOf('Survey the site')).getByRole('button', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))

    await waitFor(() => expect(getTasksMock.mock.calls.at(-1)?.[1]).toMatchObject({ page: 1 }))
    expect(await screen.findByText('Order switches')).toBeTruthy()
    expect(screen.queryByText('Survey the site')).toBeNull()
    expect(screen.queryByText(/No tasks/)).toBeNull() // never an empty page 2
  })
})
