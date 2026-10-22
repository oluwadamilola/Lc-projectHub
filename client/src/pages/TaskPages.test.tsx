import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { getProject } from '../api/projects'
import { createTask, getTask, getTasks, getTechnicians, updateTask } from '../api/tasks'
import { routes } from '../routes'
import { projectA, taskA, taskListResponse, technicians } from '../test/fixtures'

vi.mock('../api/projects', () => ({
  getProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
}))
vi.mock('../api/tasks', () => ({
  getTasks: vi.fn(),
  getTask: vi.fn(),
  getTechnicians: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
}))
const getProjectMock = vi.mocked(getProject)
const getTasksMock = vi.mocked(getTasks)
const getTaskMock = vi.mocked(getTask)
const getTechniciansMock = vi.mocked(getTechnicians)
const createMock = vi.mocked(createTask)
const updateMock = vi.mocked(updateTask)

/** Renders the real route tree (shell, pages, navigation) with only the API mocked. */
function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <RouterProvider router={router} />,
  )
  return router
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const fill = (label: string, value: string) => fireEvent.change(field(label), { target: { value } })

beforeEach(() => {
  getProjectMock.mockReset().mockResolvedValue(projectA)
  getTasksMock.mockReset().mockResolvedValue(taskListResponse([taskA]))
  getTaskMock.mockReset().mockResolvedValue(taskA)
  getTechniciansMock.mockReset().mockResolvedValue(technicians)
  createMock.mockReset()
  updateMock.mockReset()
})

describe('tasks on the project page', () => {
  it('shows the project’s tasks and offers Add task, which opens the creation form', async () => {
    const router = renderApp('/projects/PRJ-001')
    expect(await screen.findByText('Survey the site')).toBeTruthy()
    expect(getTasksMock).toHaveBeenCalledWith('PRJ-001', expect.any(Object), expect.any(AbortSignal))

    fireEvent.click(screen.getByRole('link', { name: 'Add task' }))
    expect(await screen.findByRole('heading', { name: 'New task', level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/projects/PRJ-001/tasks/new')
  })

  it('opens the edit form from a task row', async () => {
    const router = renderApp('/projects/PRJ-001')
    fireEvent.click(await screen.findByRole('link', { name: 'Edit task TASK-001: Survey the site' }))
    expect(await screen.findByRole('heading', { name: 'Edit task', level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/projects/PRJ-001/tasks/TASK-001/edit')
  })

  it('still shows the project when its tasks cannot be loaded', async () => {
    getTasksMock.mockRejectedValue(new ApiRequestError('The server could not be reached.', 0))
    renderApp('/projects/PRJ-001')
    expect(await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })).toBeTruthy()
    expect(await screen.findByText('Tasks could not be loaded')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Edit project' })).toBeTruthy()
  })
})

describe('creating a task', () => {
  async function openForm() {
    const router = renderApp('/projects/PRJ-001/tasks/new')
    await screen.findByRole('heading', { name: 'New task', level: 1 })
    await screen.findByLabelText('Task title')
    return router
  }

  it('shows loading, then the project and an empty form', async () => {
    let resolve!: (project: typeof projectA) => void
    getProjectMock.mockReturnValue(new Promise((r) => (resolve = r)))
    renderApp('/projects/PRJ-001/tasks/new')
    expect(await screen.findByText('Loading…')).toBeTruthy()
    resolve(projectA)
    await screen.findByLabelText('Task title')
    expect(screen.getByText('PRJ-001: Alpha Network')).toBeTruthy()
    expect(field('Task title').value).toBe('')
  })

  it('saves, returns to the project and confirms with the new reference', async () => {
    createMock.mockResolvedValue({ ...taskA, id: 'TASK-050', title: 'Label the cables' })
    getTasksMock.mockResolvedValue(taskListResponse([{ ...taskA, id: 'TASK-050', title: 'Label the cables' }]))
    const router = await openForm()

    fill('Task title', 'Label the cables')
    fill('Technician (optional)', 'TECH-002')
    fill('Due date', '2099-03-20')
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/projects/PRJ-001')
    expect(screen.getByText('Task TASK-050 was created.')).toBeTruthy()
    expect(await screen.findByText('Label the cables')).toBeTruthy()
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock).toHaveBeenCalledWith('PRJ-001', {
      title: 'Label the cables',
      description: '',
      status: 'To do',
      priority: 'Medium',
      assigneeId: 'TECH-002',
      startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      dueDate: '2099-03-20',
    })
    await waitFor(() => expect(router.state.location.state).toBeNull())
  })

  it('does not call the API when the form is invalid', async () => {
    await openForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('preserves the input and explains the problem when the save fails', async () => {
    createMock.mockRejectedValue(new ApiRequestError('The server is currently unavailable. Please try again shortly.', 503))
    const router = await openForm()
    fill('Task title', 'Label the cables')
    fill('Description (optional)', 'Both ends.')
    fill('Due date', '2099-03-20')
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The server is currently unavailable. Please try again shortly.')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/projects/PRJ-001/tasks/new')
    expect(field('Task title').value).toBe('Label the cables')
    expect(field('Description (optional)').value).toBe('Both ends.')
    expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows server-side field errors on the right field', async () => {
    createMock.mockRejectedValue(
      new ApiRequestError('The request contains invalid values.', 400, 'VALIDATION_ERROR', [
        { field: 'assigneeId', message: 'That technician was not found. Choose one from the list.' },
      ]),
    )
    await openForm()
    fill('Task title', 'Label the cables')
    fill('Due date', '2099-03-20')
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByRole('link', { name: 'That technician was not found. Choose one from the list.' })).toBeTruthy()
    expect(field('Technician (optional)').getAttribute('aria-invalid')).toBe('true')
  })

  it('shows a not-found state when the project does not exist', async () => {
    getProjectMock.mockRejectedValue(new ApiRequestError('Project PRJ-999 was not found.', 404, 'NOT_FOUND'))
    renderApp('/projects/PRJ-999/tasks/new')
    expect(await screen.findByText('Project not found')).toBeTruthy()
    expect(screen.queryByLabelText('Task title')).toBeNull()
  })

  it('shows an error with retry when technicians cannot be loaded', async () => {
    getTechniciansMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    renderApp('/projects/PRJ-001/tasks/new')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Technicians could not be loaded')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Task title')).toBeTruthy()
  })

  it('asks before abandoning a half-filled form, and Cancel returns to the project', async () => {
    const router = await openForm()
    fill('Task title', 'Half written')
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Leave without saving' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/PRJ-001'))
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('editing a task', () => {
  async function openForm() {
    const router = renderApp('/projects/PRJ-001/tasks/TASK-001/edit')
    await screen.findByLabelText('Task title')
    return router
  }

  it('shows loading, then the existing values', async () => {
    let resolve!: (task: typeof taskA) => void
    getTaskMock.mockReturnValue(new Promise((r) => (resolve = r)))
    renderApp('/projects/PRJ-001/tasks/TASK-001/edit')
    expect(await screen.findByText('Loading task…')).toBeTruthy()
    resolve(taskA)
    await screen.findByLabelText('Task title')
    expect(getTaskMock).toHaveBeenCalledWith('PRJ-001', 'TASK-001', expect.any(AbortSignal))
    expect(screen.getByText('TASK-001: Survey the site')).toBeTruthy()
    expect(field('Task title').value).toBe('Survey the site')
    expect(field('Description (optional)').value).toBe('Walk every room and note the cable routes.')
    expect(field('Status').value).toBe('In progress')
    expect(field('Priority').value).toBe('High')
    expect(field('Technician (optional)').value).toBe('TECH-001')
    expect(field('Start date').value).toBe('2000-01-05')
    expect(field('Due date').value).toBe('2099-01-12')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()
  })

  it('saves and returns to the project with a confirmation', async () => {
    updateMock.mockResolvedValue({ ...taskA, status: 'Done' })
    const router = await openForm()
    fill('Status', 'Done')
    fill('Technician (optional)', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Changes to TASK-001 were saved.')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/projects/PRJ-001')
    expect(updateMock).toHaveBeenCalledTimes(1)
    const [projectId, taskId, input] = updateMock.mock.calls[0]
    expect(projectId).toBe('PRJ-001')
    expect(taskId).toBe('TASK-001')
    expect(input).toMatchObject({ status: 'Done', assigneeId: null, title: 'Survey the site' })
    expect(input).not.toHaveProperty('id')
    expect(input).not.toHaveProperty('projectId')
    expect(input).not.toHaveProperty('assigneeName')
  })

  it('validates in the browser before calling the API', async () => {
    await openForm()
    fill('Task title', '   ')
    fill('Start date', '2099-06-01')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Enter the task title.')).toBeTruthy()
    expect(within(alert).getByText('The due date must be on or after the start date.')).toBeTruthy()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('keeps the user’s edits when saving fails, including when the task has been removed', async () => {
    updateMock.mockRejectedValue(new ApiRequestError('Task TASK-001 was not found in project PRJ-001.', 404, 'NOT_FOUND'))
    const router = await openForm()
    fill('Task title', 'My careful edit')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Task TASK-001 was not found in project PRJ-001.')).toBeTruthy()
    expect(field('Task title').value).toBe('My careful edit')
    expect(router.state.location.pathname).toBe('/projects/PRJ-001/tasks/TASK-001/edit')
  })

  it('shows a not-found state for a missing task, and for a malformed reference', async () => {
    getTaskMock.mockRejectedValue(new ApiRequestError('Task TASK-999 was not found in project PRJ-001.', 404, 'NOT_FOUND'))
    renderApp('/projects/PRJ-001/tasks/TASK-999/edit')
    expect(await screen.findByText('Task not found')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the project' }).getAttribute('href')).toBe('/projects/PRJ-001')
    expect(screen.queryByLabelText('Task title')).toBeNull()
  })

  it('shows an error with retry when the task cannot be loaded', async () => {
    getTaskMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    renderApp('/projects/PRJ-001/tasks/TASK-001/edit')
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Task could not be loaded')).toBeTruthy()
    expect(screen.queryByText('Task not found')).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect((await screen.findByLabelText('Task title') as HTMLInputElement).value).toBe('Survey the site')
  })

  it('prompts on Cancel when there are unsaved edits and not otherwise', async () => {
    const router = await openForm()
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/PRJ-001'))
    expect(screen.queryByRole('alertdialog')).toBeNull()

    const again = renderApp('/projects/PRJ-001/tasks/TASK-001/edit')
    const titles = await screen.findAllByLabelText('Task title')
    fireEvent.change(titles[titles.length - 1], { target: { value: 'Changed' } })
    const cancels = screen.getAllByRole('link', { name: 'Cancel' })
    fireEvent.click(cancels[cancels.length - 1])
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(again.state.location.pathname).toBe('/projects/PRJ-001/tasks/TASK-001/edit')
  })
})
