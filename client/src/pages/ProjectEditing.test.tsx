import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { createProject, getProject, getProjects, updateProject } from '../api/projects'
import { getTasks, getTechnicians } from '../api/tasks'
import { routes } from '../routes'
import { listResponse, projectA } from '../test/fixtures'

vi.mock('../api/projects', () => ({
  getProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
}))
vi.mock('../api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn() }))
const getProjectsMock = vi.mocked(getProjects)
const getProjectMock = vi.mocked(getProject)
const createMock = vi.mocked(createProject)
const updateMock = vi.mocked(updateProject)

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

function fillNewProject() {
  fill('Project name', 'Foxtrot Wi-Fi')
  fill('Description', 'Add access points.')
  fill('Location', 'Test Annexe')
  fill('Department', 'Infrastructure')
  fill('Project lead', 'Jamie Cole')
  fill('Target completion date', '2099-08-01')
  fill('Start date', '2099-05-01')
}

beforeEach(() => {
  getProjectsMock.mockReset().mockResolvedValue(listResponse([projectA]))
  getProjectMock.mockReset()
  // The project detail page also lists the project's tasks; none are needed here.
  vi.mocked(getTasks).mockReset().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } })
  vi.mocked(getTechnicians).mockReset().mockResolvedValue([])
  createMock.mockReset()
  updateMock.mockReset()
})

describe('entry points', () => {
  it('offers New project on the Projects page', async () => {
    renderApp('/projects')
    const link = await screen.findByRole('link', { name: 'New project' })
    expect(link.getAttribute('href')).toBe('/projects/new')
  })

  it('offers Edit project on the detail page', async () => {
    getProjectMock.mockResolvedValue(projectA)
    renderApp('/projects/PRJ-001')
    const link = await screen.findByRole('link', { name: 'Edit project' })
    expect(link.getAttribute('href')).toBe('/projects/PRJ-001/edit')
  })

  it('opens the creation form at /projects/new (not as a project called "new")', async () => {
    renderApp('/projects/new')
    expect(await screen.findByRole('heading', { name: 'New project', level: 1 })).toBeTruthy()
    expect(getProjectMock).not.toHaveBeenCalled()
  })
})

describe('creating a project', () => {
  it('saves, shows a confirmation and opens the new project’s detail page', async () => {
    const created = { ...projectA, id: 'PRJ-113', name: 'Foxtrot Wi-Fi' }
    createMock.mockResolvedValue(created)
    getProjectMock.mockResolvedValue(created)
    const router = renderApp('/projects/new')

    await screen.findByRole('heading', { name: 'New project', level: 1 })
    fillNewProject()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('heading', { name: 'Foxtrot Wi-Fi', level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/projects/PRJ-113')
    expect(screen.getByText('Project PRJ-113 was created.')).toBeTruthy()
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock).toHaveBeenCalledWith({
      name: 'Foxtrot Wi-Fi',
      description: 'Add access points.',
      location: 'Test Annexe',
      department: 'Infrastructure',
      lead: 'Jamie Cole',
      priority: 'Medium',
      status: 'Planning',
      progress: 0,
      startDate: '2099-05-01',
      dueDate: '2099-08-01',
    })
  })

  it('does not leave a confirmation behind in the history entry (a refresh will not repeat it)', async () => {
    const created = { ...projectA, id: 'PRJ-113' }
    createMock.mockResolvedValue(created)
    getProjectMock.mockResolvedValue(created)
    const router = renderApp('/projects/new')
    await screen.findByRole('heading', { name: 'New project', level: 1 })
    fillNewProject()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await screen.findByText('Project PRJ-113 was created.')
    await waitFor(() => expect(router.state.location.state).toBeNull())
  })

  it('preserves the input and explains the problem when the save fails', async () => {
    createMock.mockRejectedValue(new ApiRequestError('The server is currently unavailable. Please try again shortly.', 503))
    const router = renderApp('/projects/new')
    await screen.findByRole('heading', { name: 'New project', level: 1 })
    fillNewProject()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The server is currently unavailable. Please try again shortly.')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/projects/new')
    expect(field('Project name').value).toBe('Foxtrot Wi-Fi')
    expect(field('Description').value).toBe('Add access points.')
    expect(field('Target completion date').value).toBe('2099-08-01')
    expect((screen.getByRole('button', { name: 'Create project' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows server-side field errors and stays on the form', async () => {
    createMock.mockRejectedValue(
      new ApiRequestError('The request contains invalid values.', 400, 'VALIDATION_ERROR', [
        { field: 'name', message: 'The project name must be 100 characters or fewer.' },
      ]),
    )
    renderApp('/projects/new')
    await screen.findByRole('heading', { name: 'New project', level: 1 })
    fillNewProject()
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('link', { name: 'The project name must be 100 characters or fewer.' })).toBeTruthy()
    expect(field('Project name').getAttribute('aria-invalid')).toBe('true')
  })

  it('does not call the API when the form is invalid', async () => {
    renderApp('/projects/new')
    await screen.findByRole('heading', { name: 'New project', level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('asks before abandoning a half-filled form', async () => {
    const router = renderApp('/projects/new')
    await screen.findByRole('heading', { name: 'New project', level: 1 })
    fill('Project name', 'Half written')
    fireEvent.click(screen.getAllByRole('link', { name: 'Projects' })[0])
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/projects/new')
  })
})

describe('editing a project', () => {
  it('shows loading, then the existing values', async () => {
    let resolve!: (project: typeof projectA) => void
    getProjectMock.mockReturnValue(new Promise((r) => (resolve = r)))
    renderApp('/projects/PRJ-001/edit')
    expect(await screen.findByText('Loading project…')).toBeTruthy()

    resolve(projectA)
    await screen.findByLabelText('Project name')
    expect(field('Project name').value).toBe('Alpha Network')
    expect(field('Description').value).toBe('Upgrade switches in the north wing.')
    expect(field('Location').value).toBe('Test Building One')
    expect(field('Department').value).toBe('Infrastructure')
    expect(field('Project lead').value).toBe('Casey Lane')
    expect(field('Priority').value).toBe('High')
    expect(field('Status').value).toBe('On track')
    expect(field('Progress (%)').value).toBe('60')
    expect(field('Start date').value).toBe('2026-01-05')
    expect(field('Target completion date').value).toBe('2026-03-30')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()
  })

  it('saves, then returns to the updated detail page with a confirmation', async () => {
    const updated = { ...projectA, name: 'Alpha Network (phase 2)', progress: 75 }
    getProjectMock.mockResolvedValueOnce(projectA).mockResolvedValue(updated)
    updateMock.mockResolvedValue(updated)
    const router = renderApp('/projects/PRJ-001/edit')
    await screen.findByLabelText('Project name')

    fill('Project name', 'Alpha Network (phase 2)')
    fill('Progress (%)', '75')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('heading', { name: 'Alpha Network (phase 2)', level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/projects/PRJ-001')
    expect(screen.getByText('Changes to PRJ-001 were saved.')).toBeTruthy()
    expect(screen.getByText('75%')).toBeTruthy()
    const [id, input] = updateMock.mock.calls[0]
    expect(id).toBe('PRJ-001')
    expect(input).toMatchObject({ name: 'Alpha Network (phase 2)', progress: 75, lead: 'Casey Lane' })
    expect(input).not.toHaveProperty('id')
  })

  it('shows a not-found state when the project does not exist', async () => {
    getProjectMock.mockRejectedValue(new ApiRequestError('Project PRJ-999 was not found.', 404, 'NOT_FOUND'))
    renderApp('/projects/PRJ-999/edit')
    expect(await screen.findByText('Project not found')).toBeTruthy()
    expect(screen.queryByLabelText('Project name')).toBeNull()
  })

  it('shows an error with retry when the project cannot be loaded', async () => {
    getProjectMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    getProjectMock.mockResolvedValueOnce(projectA)
    renderApp('/projects/PRJ-001/edit')
    const alert = await screen.findByRole('alert')
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect((await screen.findByLabelText('Project name') as HTMLInputElement).value).toBe('Alpha Network')
  })

  it('keeps the user’s edits when saving fails, and says the project is gone if it was removed', async () => {
    getProjectMock.mockResolvedValue(projectA)
    updateMock.mockRejectedValue(new ApiRequestError('Project PRJ-001 was not found.', 404, 'NOT_FOUND'))
    const router = renderApp('/projects/PRJ-001/edit')
    await screen.findByLabelText('Project name')
    fill('Project name', 'My careful edit')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Project PRJ-001 was not found.')).toBeTruthy()
    expect(field('Project name').value).toBe('My careful edit')
    expect(router.state.location.pathname).toBe('/projects/PRJ-001/edit')
  })

  it('shows field errors from the server beside the fields', async () => {
    getProjectMock.mockResolvedValue(projectA)
    updateMock.mockRejectedValue(
      new ApiRequestError('The request contains invalid values.', 400, 'VALIDATION_ERROR', [
        { field: 'dueDate', message: 'The target completion date must be on or after the start date.' },
      ]),
    )
    renderApp('/projects/PRJ-001/edit')
    await screen.findByLabelText('Project name')
    fill('Progress (%)', '61')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('link', { name: 'The target completion date must be on or after the start date.' })).toBeTruthy()
    expect(field('Progress (%)').value).toBe('61')
  })

  it('validates in the browser before calling the API', async () => {
    getProjectMock.mockResolvedValue(projectA)
    renderApp('/projects/PRJ-001/edit')
    await screen.findByLabelText('Project name')
    fill('Progress (%)', '150')
    fill('Start date', '2026-05-01')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Enter the progress as a whole number from 0 to 100.')).toBeTruthy()
    expect(within(alert).getByText('The target completion date must be on or after the start date.')).toBeTruthy()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('Cancel goes back to the project without prompting when nothing changed', async () => {
    getProjectMock.mockResolvedValue(projectA)
    const router = renderApp('/projects/PRJ-001/edit')
    await screen.findByLabelText('Project name')
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/PRJ-001'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('prompts on Cancel when there are unsaved edits', async () => {
    getProjectMock.mockResolvedValue(projectA)
    const router = renderApp('/projects/PRJ-001/edit')
    await screen.findByLabelText('Project name')
    fill('Project lead', 'Somebody else')
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/projects/PRJ-001/edit')
  })
})
