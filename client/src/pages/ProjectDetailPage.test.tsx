import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { getProject } from '../api/projects'
import { getTasks, getTechnicians } from '../api/tasks'
import { projectA } from '../test/fixtures'
import { ProjectDetailPage } from './ProjectDetailPage'

vi.mock('../api/projects', () => ({ getProjects: vi.fn(), getProject: vi.fn() }))
vi.mock('../api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn() }))
const getProjectMock = vi.mocked(getProject)

function renderPage(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${id}`]}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  getProjectMock.mockReset()
  vi.mocked(getTasks).mockReset().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } })
  vi.mocked(getTechnicians).mockReset().mockResolvedValue([])
})

describe('ProjectDetailPage', () => {
  it('shows a loading state, then the project details', async () => {
    let resolve!: (value: typeof projectA) => void
    getProjectMock.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage('PRJ-001')
    expect(screen.getByText('Loading project…')).toBeTruthy()

    resolve(projectA)
    expect(await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })).toBeTruthy()
    expect(getProjectMock).toHaveBeenCalledWith('PRJ-001', expect.any(AbortSignal))

    expect(screen.getByText('Upgrade switches in the north wing.')).toBeTruthy()
    expect(screen.getByText('PRJ-001')).toBeTruthy()
    expect(screen.getByText('Casey Lane')).toBeTruthy()
    expect(screen.getByText('Infrastructure')).toBeTruthy()
    expect(screen.getByText('Test Building One')).toBeTruthy()
    expect(screen.getByText('On track')).toBeTruthy()
    expect(screen.getAllByText('High').length).toBeGreaterThan(0)
    expect(screen.getByText('60%')).toBeTruthy()
    expect(screen.getByText('5 Jan 2026')).toBeTruthy()
    expect(screen.getByText('30 Mar 2026')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to projects/ }).getAttribute('href')).toBe('/projects')
  })

  it('shows a not-found state for a missing project', async () => {
    getProjectMock.mockRejectedValue(new ApiRequestError('Project PRJ-999 was not found.', 404, 'NOT_FOUND'))
    renderPage('PRJ-999')

    expect(await screen.findByText('Project not found')).toBeTruthy()
    expect(screen.getByText(/PRJ-999/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View all projects' }).getAttribute('href')).toBe('/projects')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('treats a malformed reference (400) as not found', async () => {
    getProjectMock.mockRejectedValue(
      new ApiRequestError('The request contains invalid values.', 400, 'VALIDATION_ERROR'),
    )
    renderPage('bad%20id')
    expect(await screen.findByText('Project not found')).toBeTruthy()
  })

  it('shows an error with retry when the server fails', async () => {
    getProjectMock.mockRejectedValueOnce(
      new ApiRequestError('Something went wrong on the server.', 500, 'INTERNAL_ERROR'),
    )
    getProjectMock.mockResolvedValueOnce(projectA)
    renderPage('PRJ-001')

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Something went wrong on the server.')).toBeTruthy()
    expect(screen.queryByText('Project not found')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Alpha Network', level: 1 })).toBeTruthy()
  })
})
