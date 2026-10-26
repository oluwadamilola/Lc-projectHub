import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getProjects } from './api/projects'
import { searchTasks } from './api/taskSearch'
import { getTechnicians } from './api/tasks'
import { routes } from './routes'
import { listResponse, projectA, technicians } from './test/fixtures'

vi.mock('./api/projects', () => ({ getProjects: vi.fn(), getProject: vi.fn() }))
vi.mock('./api/taskSearch', () => ({ searchTasks: vi.fn() }))
vi.mock('./api/tasks', () => ({ getTasks: vi.fn(), getTechnicians: vi.fn() }))

beforeEach(() => {
  vi.mocked(getProjects).mockResolvedValue(listResponse([projectA]))
  vi.mocked(getTechnicians).mockResolvedValue(technicians)
  vi.mocked(searchTasks).mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    summary: { outstanding: 0, overdue: 0 },
  })
})

function renderAt(path: string) {
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

describe('routes', () => {
  it('the Tasks navigation item opens the All tasks page', async () => {
    renderAt('/projects')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const link = [...nav.querySelectorAll('a')].find((anchor) => anchor.textContent?.includes('Tasks'))!
    expect(link.getAttribute('href')).toBe('/tasks')
    link.click()

    expect(await screen.findByRole('heading', { level: 1, name: 'All tasks' })).toBeTruthy()
    expect(screen.queryByText('Coming soon')).toBeNull()
    expect(link.getAttribute('aria-current')).toBe('page')
  })

  it('opens All tasks directly, keeping its filters', async () => {
    renderAt('/tasks?status=Blocked')
    expect(await screen.findByRole('heading', { level: 1, name: 'All tasks' })).toBeTruthy()
    expect(vi.mocked(searchTasks).mock.calls[0][0]).toMatchObject({ status: 'Blocked' })
  })

  it('leaves the other sections as "Coming soon"', async () => {
    renderAt('/locations')
    expect(await screen.findByText('Coming soon')).toBeTruthy()
  })
})
