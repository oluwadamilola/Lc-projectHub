import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { deleteProject, getProject, getProjects } from '../api/projects'
import { getTasks, getTechnicians } from '../api/tasks'
import { listResponse, projectA, projectB, taskListResponse } from '../test/fixtures'
import { ProjectDetailPage } from './ProjectDetailPage'
import { ProjectsPage } from './ProjectsPage'

vi.mock('../api/projects', () => ({ getProjects: vi.fn(), getProject: vi.fn(), deleteProject: vi.fn() }))
vi.mock('../api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn() }))
const deleteProjectMock = vi.mocked(deleteProject)

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/projects/PRJ-001']}>
      <Routes>
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const deleteButton = () => screen.getByRole('button', { name: 'Delete project' })

beforeEach(() => {
  deleteProjectMock.mockReset()
  vi.mocked(getProject).mockReset().mockResolvedValue(projectA)
  vi.mocked(getProjects).mockReset().mockResolvedValue(listResponse([projectB]))
  vi.mocked(getTasks).mockReset().mockResolvedValue(taskListResponse([]))
  vi.mocked(getTechnicians).mockReset().mockResolvedValue([])
})

describe('deleting a project from its page', () => {
  it('shows a Delete project button that does nothing until it is confirmed', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deleteProjectMock).not.toHaveBeenCalled()
    expect(deleteButton()).toBeTruthy()
  })

  it('names the project and warns that all of its tasks go too', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })
    fireEvent.click(deleteButton())

    const dialog = screen.getByRole('alertdialog', { name: 'Delete project PRJ-001?' })
    expect(within(dialog).getByText(/Alpha Network/)).toBeTruthy()
    expect(within(dialog).getByText('and all tasks associated with it')).toBeTruthy()
    expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Delete project and its tasks' })).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deleteProjectMock).not.toHaveBeenCalled()
  })

  it('Cancel closes the dialog, deletes nothing, stays on the page and returns focus to the button', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })
    deleteButton().focus() // a real click focuses the button first; fireEvent does not
    fireEvent.click(deleteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deleteProjectMock).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Alpha Network', level: 1 })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(deleteButton()))
  })

  it('Escape also cancels', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })
    fireEvent.click(deleteButton())
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deleteProjectMock).not.toHaveBeenCalled()
  })

  it('after a confirmed deletion leaves the page for the projects list and says what happened', async () => {
    deleteProjectMock.mockResolvedValue({ data: projectA, meta: { deletedTasks: 4 } })
    renderApp()
    await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })
    fireEvent.click(deleteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Delete project and its tasks' }))

    expect(await screen.findByRole('heading', { name: 'Projects', level: 1 })).toBeTruthy()
    expect(deleteProjectMock).toHaveBeenCalledWith('PRJ-001')
    expect(screen.getByText('Project PRJ-001 “Alpha Network” and its 4 tasks were deleted.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Alpha Network', level: 1 })).toBeNull()
    expect(vi.mocked(getProjects)).toHaveBeenCalled() // the list loaded fresh data
  })

  it.each([
    [0, 'Project PRJ-001 “Alpha Network” was deleted. It had no tasks.'],
    [1, 'Project PRJ-001 “Alpha Network” and its 1 task were deleted.'],
  ])('words the confirmation correctly for %i task(s)', async (count, text) => {
    deleteProjectMock.mockResolvedValue({ data: projectA, meta: { deletedTasks: count } })
    renderApp()
    await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })
    fireEvent.click(deleteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Delete project and its tasks' }))
    expect(await screen.findByText(text)).toBeTruthy()
  })

  it('does not show the confirmation again after the list is reloaded or revisited', async () => {
    deleteProjectMock.mockResolvedValue({ data: projectA, meta: { deletedTasks: 2 } })
    renderApp()
    await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })
    fireEvent.click(deleteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Delete project and its tasks' }))
    await screen.findByText(/were deleted/)
    // The history entry no longer carries the message, so Back/refresh cannot replay it.
    await waitFor(() => expect(window.history.state?.usr?.notice ?? null).toBeNull())
  })

  it('cannot be confirmed twice while the request is running', async () => {
    let finish!: (value: { data: typeof projectA; meta: { deletedTasks: number } }) => void
    deleteProjectMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderApp()
    await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })
    fireEvent.click(deleteButton())
    const confirm = screen.getByRole('button', { name: 'Delete project and its tasks' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(deleteProjectMock).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Deleting…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('heading', { name: 'Alpha Network', level: 1 })).toBeTruthy() // not gone until the server says so
    finish({ data: projectA, meta: { deletedTasks: 0 } })
    expect(await screen.findByRole('heading', { name: 'Projects', level: 1 })).toBeTruthy()
  })

  it('on failure stays on the page, shows the reason, claims no success, and succeeds when retried', async () => {
    deleteProjectMock.mockRejectedValueOnce(new ApiRequestError('The server is currently unavailable. Please try again shortly.', 503))
    deleteProjectMock.mockResolvedValueOnce({ data: projectA, meta: { deletedTasks: 3 } })
    renderApp()
    await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })
    fireEvent.click(deleteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Delete project and its tasks' }))

    expect((await screen.findByRole('alert')).textContent).toContain('currently unavailable')
    expect(screen.getByRole('heading', { name: 'Alpha Network', level: 1 })).toBeTruthy()
    expect(screen.queryByText(/were deleted/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete project and its tasks' }))
    expect(await screen.findByText('Project PRJ-001 “Alpha Network” and its 3 tasks were deleted.')).toBeTruthy()
    expect(deleteProjectMock).toHaveBeenCalledTimes(2)
  })

  it('when the project is already gone (404) leaves for the list and says so', async () => {
    deleteProjectMock.mockRejectedValue(new ApiRequestError('Project PRJ-001 was not found.', 404, 'NOT_FOUND'))
    renderApp()
    await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })
    fireEvent.click(deleteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Delete project and its tasks' }))

    expect(await screen.findByRole('heading', { name: 'Projects', level: 1 })).toBeTruthy()
    expect(screen.getByText('Project PRJ-001 had already been deleted.')).toBeTruthy()
  })
})
