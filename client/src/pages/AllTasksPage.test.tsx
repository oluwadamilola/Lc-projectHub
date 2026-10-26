import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AllTasksResponse, CrossProjectTask } from '@lc-projecthub/shared'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { getProjects } from '../api/projects'
import { searchTasks } from '../api/taskSearch'
import { getTechnicians } from '../api/tasks'
import { listResponse, projectA, projectB, taskA, taskB, technicians } from '../test/fixtures'
import { AllTasksPage } from './AllTasksPage'

vi.mock('../api/projects', () => ({ getProjects: vi.fn(), getProject: vi.fn() }))
vi.mock('../api/taskSearch', () => ({ searchTasks: vi.fn() }))
vi.mock('../api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn() }))
const searchMock = vi.mocked(searchTasks)
const getProjectsMock = vi.mocked(getProjects)
const getTechniciansMock = vi.mocked(getTechnicians)

const withProject = (task: typeof taskA, projectName: string): CrossProjectTask => ({ ...task, projectName })
const rowA = withProject(taskA, 'Alpha Network') // In progress, due 2099 (not overdue)
const rowB = withProject(taskB, 'Alpha Network') // To do, unassigned, due 2000 (overdue)
const rowC: CrossProjectTask = { ...taskA, id: 'TASK-004', projectId: 'PRJ-002', projectName: 'Bravo Laptops', title: 'Image the laptops', status: 'Done', priority: 'Critical', dueDate: '2000-03-01' }

function response(rows: CrossProjectTask[], extra: Partial<AllTasksResponse> = {}): AllTasksResponse {
  return {
    data: rows,
    meta: { page: 1, pageSize: 10, total: rows.length, totalPages: rows.length ? 1 : 0 },
    summary: { outstanding: rows.length, overdue: 0 },
    ...extra,
  }
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
const address = () => screen.getByLabelText('address').textContent
const lastRequest = () => searchMock.mock.calls.at(-1)![0]

beforeEach(() => {
  searchMock.mockReset()
  getProjectsMock.mockReset()
  getTechniciansMock.mockReset()
  getProjectsMock.mockResolvedValue(listResponse([projectA, projectB]))
  getTechniciansMock.mockResolvedValue(technicians)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 1, 10, 9, 0) })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('AllTasksPage', () => {
  it('shows a loading state, then the tasks', async () => {
    let resolve!: (value: AllTasksResponse) => void
    searchMock.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage()
    expect(screen.getByText('Loading tasks…')).toBeTruthy()

    resolve(response([rowA]))
    expect(await screen.findByText('Survey the site')).toBeTruthy()
    expect(screen.queryByText('Loading tasks…')).toBeNull()
  })

  it('shows title, project, status, priority, technician and due date', async () => {
    searchMock.mockResolvedValue(response([rowA, rowC]))
    renderPage()

    const row = (await screen.findByText('Image the laptops')).closest('tr')!
    const cells = within(row)
    expect(cells.getByText('TASK-004')).toBeTruthy()
    const projectLink = cells.getByRole('link', { name: 'Bravo Laptops' })
    expect(projectLink.getAttribute('href')).toBe('/projects/PRJ-002')
    expect(cells.getByText('PRJ-002')).toBeTruthy()
    expect(cells.getByText('Done')).toBeTruthy()
    expect(cells.getByText('Critical')).toBeTruthy()
    expect(cells.getByText('Test Technician One')).toBeTruthy()
    expect(cells.getByText('1 Mar 2000')).toBeTruthy()
    expect(cells.getByRole('link', { name: /Edit/ }).getAttribute('href')).toBe('/projects/PRJ-002/tasks/TASK-004/edit')
    expect(screen.getByText(/Showing 1–2 of 2 tasks/)).toBeTruthy()
  })

  it('shows "Unassigned" for a task nobody has picked up', async () => {
    searchMock.mockResolvedValue(response([rowB]))
    renderPage()
    const row = (await screen.findByText('Order switches')).closest('tr')!
    expect(within(row).getByText('Unassigned')).toBeTruthy()
  })

  it('marks overdue tasks using the same rule as the dashboard (outstanding and due before today)', async () => {
    searchMock.mockResolvedValue(response([rowB, rowA, rowC]))
    renderPage()
    await screen.findByText('Order switches')
    expect(within(screen.getByText('Order switches').closest('tr')!).getByText('Overdue')).toBeTruthy() // outstanding, past due
    expect(within(screen.getByText('Survey the site').closest('tr')!).queryByText('Overdue')).toBeNull() // due in 2099
    expect(within(screen.getByText('Image the laptops').closest('tr')!).queryByText('Overdue')).toBeNull() // Done
  })

  it('does not mark a task due today as overdue, but marks one due yesterday', async () => {
    searchMock.mockResolvedValue(
      response([
        { ...rowA, id: 'TASK-010', title: 'Due today', status: 'To do', dueDate: '2026-02-10' },
        { ...rowA, id: 'TASK-011', title: 'Due yesterday', status: 'To do', dueDate: '2026-02-09' },
      ]),
    )
    renderPage()
    await screen.findByText('Due today')
    expect(within(screen.getByText('Due today').closest('tr')!).queryByText('Overdue')).toBeNull()
    expect(within(screen.getByText('Due yesterday').closest('tr')!).getByText('Overdue')).toBeTruthy()
  })

  it('asks the server for the viewer\'s calendar day so counts and badges agree', async () => {
    searchMock.mockResolvedValue(response([rowA]))
    renderPage()
    await screen.findByText('Survey the site')
    expect(lastRequest()).toMatchObject({ today: '2026-02-10', page: 1, pageSize: 10 })
  })

  it('shows the outstanding and overdue counts from the server for the whole result, not just the page', async () => {
    searchMock.mockResolvedValue(response([rowA], { meta: { page: 1, pageSize: 10, total: 25, totalPages: 3 }, summary: { outstanding: 18, overdue: 6 } }))
    renderPage()
    await screen.findByText('Survey the site')
    expect(screen.getByText('18 outstanding')).toBeTruthy()
    expect(screen.getByText('6 overdue')).toBeTruthy()
    expect(screen.getByText(/Showing 1–1 of 25 tasks/)).toBeTruthy()
  })

  it('shows an error with a retry that reloads the data', async () => {
    searchMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    searchMock.mockResolvedValueOnce(response([rowA]))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Tasks could not be loaded')).toBeTruthy()
    expect(within(alert).getByText('The server could not be reached.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Survey the site')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(searchMock).toHaveBeenCalledTimes(2)
  })

  it('replaces the rows with an error when a refresh fails, so rows never contradict the chosen filters', async () => {
    searchMock.mockResolvedValueOnce(response([rowA, rowB]))
    searchMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    renderPage()
    await screen.findByText('Survey the site')

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Blocked' } })

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Survey the site')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows an empty state for filters with no results and can clear them', async () => {
    searchMock.mockResolvedValueOnce(response([]))
    searchMock.mockResolvedValueOnce(response([rowA]))
    renderPage('/tasks?q=nothing')

    expect(await screen.findByText('No tasks match your filters')).toBeTruthy()
    const search = screen.getByLabelText('Search tasks') as HTMLInputElement
    expect(search.value).toBe('nothing')

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[1])
    expect(await screen.findByText('Survey the site')).toBeTruthy()
    expect(search.value).toBe('')
    expect(address()).toBe('/tasks')
  })

  it('shows a plain empty state when there are no tasks at all', async () => {
    searchMock.mockResolvedValue(response([]))
    renderPage()
    expect(await screen.findByText('There are no tasks yet')).toBeTruthy()
  })

  describe('filters and the address', () => {
    beforeEach(() => {
      searchMock.mockResolvedValue(response([rowA]))
    })

    it('reads every filter and the page from the address', async () => {
      renderPage('/tasks?q=cable&project=PRJ-002&status=Blocked&priority=High&assignee=TECH-002&due=overdue&page=3')
      await screen.findByText('Survey the site')
      expect(lastRequest()).toEqual({
        q: 'cable',
        project: 'PRJ-002',
        status: 'Blocked',
        priority: 'High',
        assignee: 'TECH-002',
        due: 'overdue',
        today: '2026-02-10',
        page: 3,
        pageSize: 10,
      })
      expect((screen.getByLabelText('Search tasks') as HTMLInputElement).value).toBe('cable')
      expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('Blocked')
      expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('High')
      expect((screen.getByLabelText('Technician') as HTMLSelectElement).value).toBe('TECH-002')
      expect((screen.getByLabelText('Due date') as HTMLSelectElement).value).toBe('overdue')
      await waitFor(() => expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('PRJ-002'))
    })

    it('ignores values in the address that are not valid choices', async () => {
      renderPage('/tasks?status=Finished&priority=Urgent&due=tomorrow&assignee=Riley&project=a%20b&page=-4')
      await screen.findByText('Survey the site')
      expect(lastRequest()).toEqual({
        q: undefined,
        project: undefined,
        status: undefined,
        priority: undefined,
        assignee: undefined,
        due: undefined,
        today: '2026-02-10',
        page: 1,
        pageSize: 10,
      })
    })

    it('writes each filter to the address and returns to page 1', async () => {
      renderPage('/tasks?page=2')
      await screen.findByText('Survey the site')

      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Blocked' } })
      await waitFor(() => expect(address()).toBe('/tasks?status=Blocked'))

      fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'Critical' } })
      await waitFor(() => expect(address()).toBe('/tasks?status=Blocked&priority=Critical'))

      fireEvent.change(await screen.findByLabelText('Technician'), { target: { value: 'unassigned' } })
      await waitFor(() => expect(address()).toBe('/tasks?status=Blocked&priority=Critical&assignee=unassigned'))

      fireEvent.change(screen.getByLabelText('Due date'), { target: { value: 'this-week' } })
      await waitFor(() => expect(address()).toContain('due=this-week'))

      await waitFor(() => expect(screen.getByLabelText('Project').querySelectorAll('option').length).toBe(3))
      fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'PRJ-001' } })
      await waitFor(() => expect(lastRequest()).toMatchObject({ project: 'PRJ-001', status: 'Blocked', priority: 'Critical', assignee: 'unassigned', due: 'this-week', page: 1 }))
      expect(address()).not.toContain('page=')
    })

    it('removes a filter from the address when it is set back to "all"', async () => {
      renderPage('/tasks?status=Blocked')
      await screen.findByText('Survey the site')
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } })
      await waitFor(() => expect(address()).toBe('/tasks'))
    })

    it('searches after typing pauses, trims the text and goes back to page 1', async () => {
      renderPage('/tasks?page=2')
      await screen.findByText('Survey the site')
      expect(lastRequest()).toMatchObject({ page: 2 })

      fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: ' cable ' } })

      await waitFor(() => expect(lastRequest()).toMatchObject({ q: 'cable', page: 1 }))
      expect(address()).toBe('/tasks?q=cable')
    })

    it('offers every status, priority, due-date option, technician and project', async () => {
      renderPage()
      await screen.findByText('Survey the site')
      const options = (label: string) => [...screen.getByLabelText(label).querySelectorAll('option')].map((option) => option.textContent)
      expect(options('Status')).toEqual(['All statuses', 'To do', 'In progress', 'Blocked', 'Done'])
      expect(options('Priority')).toEqual(['All priorities', 'Low', 'Medium', 'High', 'Critical'])
      expect(options('Due date')).toEqual(['Any due date', 'Overdue', 'Due this week'])
      await waitFor(() => expect(options('Technician')).toEqual(['Everyone', 'Unassigned', 'Test Technician One', 'Test Technician Two']))
      await waitFor(() => expect(options('Project')).toEqual(['All projects', 'Alpha Network (PRJ-001)', 'Bravo Laptops (PRJ-002)']))
    })

    it('still works, and shows the chosen project, when the project list cannot be loaded', async () => {
      getProjectsMock.mockRejectedValue(new ApiRequestError('The server could not be reached.', 0))
      renderPage('/tasks?project=PRJ-002')
      await screen.findByText('Survey the site')
      await waitFor(() => expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('PRJ-002'))
    })

    it('"Clear filters" is disabled until something is filtered', async () => {
      renderPage()
      await screen.findByText('Survey the site')
      expect((screen.getByRole('button', { name: 'Clear filters' }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'Low' } })
      await waitFor(() => expect((screen.getByRole('button', { name: 'Clear filters' }) as HTMLButtonElement).disabled).toBe(false))
    })
  })

  describe('an unknown project in the address', () => {
    it('shows the server\'s explanation and lets the filters be cleared', async () => {
      searchMock.mockRejectedValueOnce(new ApiRequestError('Project PRJ-999 was not found.', 404))
      searchMock.mockResolvedValueOnce(response([rowA]))
      renderPage('/tasks?project=PRJ-999')

      const alert = await screen.findByRole('alert')
      expect(within(alert).getByText('Project PRJ-999 was not found.')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
      expect(await screen.findByText('Survey the site')).toBeTruthy()
      expect(address()).toBe('/tasks')
    })
  })

  describe('paging', () => {
    it('pages through results using the address', async () => {
      searchMock.mockResolvedValue(response([rowA], { meta: { page: 1, pageSize: 10, total: 12, totalPages: 2 } }))
      renderPage()
      await screen.findByText('Page 1 of 2')
      expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: 'Next' }))

      await waitFor(() => expect(lastRequest()).toMatchObject({ page: 2 }))
      expect(address()).toBe('/tasks?page=2')
    })

    it('shows no paging when everything fits on one page', async () => {
      searchMock.mockResolvedValue(response([rowA]))
      renderPage()
      await screen.findByText('Survey the site')
      expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull()
    })

    it('treats a page past the end as an empty result that can be cleared', async () => {
      searchMock.mockResolvedValueOnce(response([], { meta: { page: 9, pageSize: 10, total: 12, totalPages: 2 } }))
      searchMock.mockResolvedValueOnce(response([rowA]))
      renderPage('/tasks?page=9')
      expect(await screen.findByText('No tasks match your filters')).toBeTruthy()
      fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[1])
      expect(await screen.findByText('Survey the site')).toBeTruthy()
    })
  })
})
