import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuditBlock, getAuditBlocks, getAuditCycles, getAuditRoom, getAuditRooms } from './api/audit'
import { getProjects } from './api/projects'
import { searchTasks } from './api/taskSearch'
import { getTechnicians } from './api/tasks'
import { routes } from './routes'
import { blockDetailB, blockList, cycleList, roomB001, roomDetail, roomListResponse } from './test/auditFixtures'
import { listResponse, projectA, technicians } from './test/fixtures'

vi.mock('./api/audit', () => ({ getAuditCycles: vi.fn(), getAuditBlocks: vi.fn(), getAuditBlock: vi.fn(), getAuditRooms: vi.fn(), getAuditRoom: vi.fn() }))
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

  it('lists Audit in the sidebar straight after Tasks, with Locations and Equipment still separate', () => {
    renderAt('/projects')
    const labels = [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].map((anchor) => anchor.textContent?.trim())
    expect(labels).toEqual(['Dashboard', 'Projects', 'Tasks', 'Audit', 'Locations', 'Equipment', 'Reports', 'Settings'])
  })

  it('the Audit navigation item opens the Audit overview, and is marked as the current page', async () => {
    vi.mocked(getAuditBlocks).mockResolvedValue(blockList)
    vi.mocked(getAuditCycles).mockResolvedValue(cycleList)
    renderAt('/projects')
    const link = [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].find((anchor) => anchor.textContent?.trim() === 'Audit')!
    expect(link.getAttribute('href')).toBe('/audit')
    link.click()
    expect(await screen.findByRole('link', { name: 'B Block' })).toBeTruthy()
    expect(screen.queryByText('Coming soon')).toBeNull()
    expect(link.getAttribute('aria-current')).toBe('page')
  })

  it('Audit stays marked as the current page on a block, floor and room address', async () => {
    vi.mocked(getAuditCycles).mockResolvedValue(cycleList)
    vi.mocked(getAuditBlock).mockResolvedValue(blockDetailB)
    vi.mocked(getAuditRooms).mockResolvedValue(roomListResponse([roomB001]))
    vi.mocked(getAuditRoom).mockResolvedValue(roomDetail())
    for (const [path, heading] of [
      ['/audit/blocks/BLK-001', 'B Block'],
      ['/audit/blocks/BLK-001/floors/FLR-001', 'B Block'],
      ['/audit/rooms/ROOM-001', 'B001'],
    ] as const) {
      const view = renderAt(path)
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy()
      const link = [...screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')].find((anchor) => anchor.textContent?.trim() === 'Audit')!
      expect(link.getAttribute('aria-current')).toBe('page')
      view.unmount()
    }
  })
})
