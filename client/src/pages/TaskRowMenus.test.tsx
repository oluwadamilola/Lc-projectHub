import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { CrossProjectTask } from '@lc-projecthub/shared'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectTasks } from '../components/ProjectTasks'
import { getProjects } from '../api/projects'
import { searchTasks } from '../api/taskSearch'
import { deleteTask, getTasks, getTechnicians } from '../api/tasks'
import { actionsButton } from '../test/taskMenu'
import { listResponse, projectA, taskA, taskB, taskListResponse, technicians } from '../test/fixtures'
import { AllTasksPage } from './AllTasksPage'

/*
  The row actions menu is one shared component. These tests run the same scenarios against both pages that use it,
  and check that the existing delete confirmation behind it (DeleteTaskDialog) is unchanged.
*/
vi.mock('../api/projects', () => ({ getProjects: vi.fn(), getProject: vi.fn() }))
vi.mock('../api/taskSearch', () => ({ searchTasks: vi.fn() }))
vi.mock('../api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn(), deleteTask: vi.fn() }))
const deleteTaskMock = vi.mocked(deleteTask)

function Address() {
  const location = useLocation()
  return <output aria-label="address">{location.pathname}</output>
}

const asCross = (task: typeof taskA): CrossProjectTask => ({ ...task, projectName: 'Alpha Network' })

const pages = [
  {
    name: 'Project tasks',
    mount: () =>
      render(
        <MemoryRouter>
          <ProjectTasks projectId="PRJ-001" />
          <Address />
        </MemoryRouter>,
      ),
  },
  {
    name: 'All tasks',
    mount: () =>
      render(
        <MemoryRouter initialEntries={['/tasks']}>
          <AllTasksPage />
          <Address />
        </MemoryRouter>,
      ),
  },
]

beforeEach(() => {
  deleteTaskMock.mockReset()
  vi.mocked(getTechnicians).mockReset().mockResolvedValue(technicians)
  vi.mocked(getProjects).mockReset().mockResolvedValue(listResponse([projectA]))
  vi.mocked(getTasks).mockReset().mockResolvedValue(taskListResponse([taskA, taskB]))
  vi.mocked(searchTasks).mockReset().mockResolvedValue({
    data: [asCross(taskA), asCross(taskB)],
    meta: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
    summary: { outstanding: 2, overdue: 1 },
  })
})

const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement

describe.each(pages)('task row actions menu on the $name page', ({ mount }) => {
  async function ready() {
    mount()
    await screen.findByText('Survey the site')
  }

  it('replaces the separate Edit and Delete controls with one "⋮" button per row, in the last column', async () => {
    await ready()
    for (const title of ['Survey the site', 'Order switches']) {
      const row = rowOf(title)
      expect(within(row).getAllByRole('button')).toHaveLength(1)
      expect(within(row).queryByRole('link', { name: /Edit/ })).toBeNull()
      expect(within(row).queryByRole('button', { name: /^Delete/ })).toBeNull()
      expect(actionsButton(row).closest('td')).toBe(row.lastElementChild)
      expect(actionsButton(row).closest('td')?.classList.contains('data-table__actions')).toBe(true)
    }
    const lastHeader = [...document.querySelectorAll('thead th')].at(-1)!
    expect(lastHeader.classList.contains('data-table__actions')).toBe(true)
    expect(lastHeader.textContent).toBe('Actions') // visually hidden, still announced
  })

  it('opens and closes the menu from a row, and the table itself is unchanged by it', async () => {
    await ready()
    const rowsBefore = document.querySelectorAll('tbody tr').length
    fireEvent.click(actionsButton(rowOf('Survey the site')))
    expect(screen.getByRole('menu', { name: 'Actions for task TASK-001' })).toBeTruthy()
    expect(screen.getByRole('menu').closest('table')).toBeNull()
    expect(document.querySelectorAll('tbody tr').length).toBe(rowsBefore)
    fireEvent.click(actionsButton(rowOf('Survey the site')))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Edit task opens that task\'s edit page', async () => {
    await ready()
    fireEvent.click(actionsButton(rowOf('Order switches')))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit task' }))
    expect(screen.getByLabelText('address').textContent).toBe('/projects/PRJ-001/tasks/TASK-002/edit')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Delete task opens the existing confirmation and deletes nothing yet', async () => {
    await ready()
    fireEvent.click(actionsButton(rowOf('Survey the site')))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete task TASK-001?' })
    expect(within(dialog).getByText(/permanently deletes/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Delete task' })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull() // the menu closed when the action was chosen
    expect(deleteTaskMock).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' })) // the dialog\'s own focus rule
  })

  it('Cancel in the confirmation leaves everything as it was and gives focus back to the row\'s button', async () => {
    await ready()
    fireEvent.click(actionsButton(rowOf('Survey the site')))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deleteTaskMock).not.toHaveBeenCalled()
    expect(screen.getByText('Survey the site')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(actionsButton(rowOf('Survey the site'))))
  })

  it('confirming still makes the same API call and shows the same result as before', async () => {
    deleteTaskMock.mockResolvedValue(taskA)
    await ready()
    fireEvent.click(actionsButton(rowOf('Survey the site')))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))

    await waitFor(() => expect(deleteTaskMock).toHaveBeenCalledWith('PRJ-001', 'TASK-001'))
    expect(deleteTaskMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Task TASK-001 “Survey the site” was deleted.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('a server failure is still shown in the confirmation and can be retried', async () => {
    deleteTaskMock.mockRejectedValueOnce(new Error('boom'))
    deleteTaskMock.mockResolvedValueOnce(taskA)
    await ready()
    fireEvent.click(actionsButton(rowOf('Survey the site')))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong')
    expect(screen.queryByText(/was deleted/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await waitFor(() => expect(deleteTaskMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/was deleted/)).toBeTruthy()
  })

  it('a click elsewhere on the page closes the menu', async () => {
    await ready()
    fireEvent.click(actionsButton(rowOf('Survey the site')))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Escape closes the menu and returns focus to that row\'s button', async () => {
    await ready()
    fireEvent.click(actionsButton(rowOf('Order switches')))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(actionsButton(rowOf('Order switches')))
  })

  it('only one row\'s menu is open at a time', async () => {
    await ready()
    fireEvent.click(actionsButton(rowOf('Survey the site')))
    fireEvent.click(actionsButton(rowOf('Order switches')))
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(screen.getByRole('menu').getAttribute('aria-label')).toBe('Actions for task TASK-002')
    expect(actionsButton(rowOf('Survey the site')).getAttribute('aria-expanded')).toBe('false')
  })

  it('works from the keyboard: Down opens it, arrows move, Enter-equivalent click on Delete asks first', async () => {
    await ready()
    fireEvent.keyDown(actionsButton(rowOf('Survey the site')), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit task' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete task' }))
    fireEvent.click(document.activeElement as Element)
    expect(screen.getByRole('alertdialog', { name: 'Delete task TASK-001?' })).toBeTruthy()
    expect(deleteTaskMock).not.toHaveBeenCalled()
  })

  it('every row\'s button has its own accessible name saying which task it is for', async () => {
    await ready()
    const names = [...document.querySelectorAll('tbody tr')].map((row) => row.querySelector('button')?.getAttribute('aria-label'))
    expect(names).toEqual(['Actions for task TASK-001: Survey the site', 'Actions for task TASK-002: Order switches'])
  })
})
