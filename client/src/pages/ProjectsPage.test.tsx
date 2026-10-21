import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { getProjects } from '../api/projects'
import { listResponse, projectA, projectB } from '../test/fixtures'
import { ProjectsPage } from './ProjectsPage'

vi.mock('../api/projects', () => ({ getProjects: vi.fn(), getProject: vi.fn() }))
const getProjectsMock = vi.mocked(getProjects)

function renderPage(url = '/projects') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ProjectsPage />
    </MemoryRouter>,
  )
}

function lastRequest() {
  return getProjectsMock.mock.calls.at(-1)?.[0]
}

beforeEach(() => {
  getProjectsMock.mockReset()
})

describe('ProjectsPage', () => {
  it('shows a loading state, then the projects', async () => {
    let resolve!: (value: ReturnType<typeof listResponse>) => void
    getProjectsMock.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage()

    expect(screen.getByText('Loading projects…')).toBeTruthy()

    resolve(listResponse([projectA, projectB]))
    const link = await screen.findByRole('link', { name: 'Alpha Network' })
    expect(link.getAttribute('href')).toBe('/projects/PRJ-001')
    expect(screen.queryByText('Loading projects…')).toBeNull()
  })

  it('shows reference, name, location, lead, priority, status and progress', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectB]))
    renderPage()

    const row = (await screen.findByRole('link', { name: 'Bravo Laptops' })).closest('tr')!
    const cells = within(row)
    expect(cells.getByText('PRJ-002')).toBeTruthy()
    expect(cells.getByText('Test Building Two')).toBeTruthy()
    expect(cells.getByText('Robin Park')).toBeTruthy()
    expect(cells.getByText('Critical')).toBeTruthy()
    expect(cells.getByText('Delayed')).toBeTruthy()
    expect(cells.getByText('35%')).toBeTruthy()
    expect(screen.getByText(/Showing 1–1 of 1 projects/)).toBeTruthy()
  })

  it('shows an error with a retry that reloads the data', async () => {
    getProjectsMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    getProjectsMock.mockResolvedValueOnce(listResponse([projectA]))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The server could not be reached.')).toBeTruthy()

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Alpha Network' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(getProjectsMock).toHaveBeenCalledTimes(2)
  })

  it('replaces the rows with an error when a refresh fails, so rows never contradict the chosen filter', async () => {
    getProjectsMock.mockResolvedValueOnce(listResponse([projectA, projectB]))
    getProjectsMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    getProjectsMock.mockResolvedValueOnce(listResponse([projectB]))
    renderPage()
    await screen.findByRole('link', { name: 'Alpha Network' })

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Delayed' } })

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The server could not be reached.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Alpha Network' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Bravo Laptops' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Alpha Network' })).toBeNull()
  })

  it('shows an empty state for filters with no results and can clear them', async () => {
    getProjectsMock.mockResolvedValueOnce(listResponse([]))
    getProjectsMock.mockResolvedValueOnce(listResponse([projectA]))
    renderPage('/projects?q=nothing')

    expect(await screen.findByText('No projects match your filters')).toBeTruthy()
    const search = screen.getByLabelText('Search projects') as HTMLInputElement
    expect(search.value).toBe('nothing')

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[1])
    expect(await screen.findByRole('link', { name: 'Alpha Network' })).toBeTruthy()
    expect(search.value).toBe('')
    expect(lastRequest()).toEqual({ q: undefined, status: undefined, page: 1, pageSize: 10 })
  })

  it('shows a plain empty state when there are no projects at all', async () => {
    getProjectsMock.mockResolvedValue(listResponse([]))
    renderPage()
    expect(await screen.findByText('There are no projects yet')).toBeTruthy()
  })

  it('searches after typing pauses and returns to page 1', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    renderPage('/projects?page=2')
    await screen.findByRole('link', { name: 'Alpha Network' })
    expect(lastRequest()).toMatchObject({ page: 2 })

    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: ' laptop ' } })

    await waitFor(() => expect(lastRequest()).toEqual({ q: 'laptop', status: undefined, page: 1, pageSize: 10 }))
  })

  it('filters by status', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectB]))
    renderPage()
    await screen.findByRole('link', { name: 'Bravo Laptops' })

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Delayed' } })

    await waitFor(() => expect(lastRequest()).toEqual({ q: undefined, status: 'Delayed', page: 1, pageSize: 10 }))
  })

  it('pages through results', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA], { total: 12, totalPages: 2 }))
    renderPage()
    await screen.findByText('Page 1 of 2')
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(lastRequest()).toEqual({ q: undefined, status: undefined, page: 2, pageSize: 10 }))
  })

  it('ignores invalid values in the address bar', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA]))
    renderPage('/projects?status=bogus&page=-3')
    await screen.findByRole('link', { name: 'Alpha Network' })
    expect(lastRequest()).toEqual({ q: undefined, status: undefined, page: 1, pageSize: 10 })
  })
})
