import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../api/http'
import { getProjects } from '../api/projects'
import { listResponse, projectA, projectB, projectC } from '../test/fixtures'
import { Dashboard } from './Dashboard'

vi.mock('../api/projects', () => ({ getProjects: vi.fn(), getProject: vi.fn() }))
const getProjectsMock = vi.mocked(getProjects)

function renderPage() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  getProjectsMock.mockReset()
})

describe('Dashboard', () => {
  it('shows a loading state while projects load', () => {
    getProjectsMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('Loading dashboard…')).toBeTruthy()
  })

  it('builds its figures from the API data', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB, projectC]))
    renderPage()

    const figures = await screen.findByRole('region', { name: 'Key figures' })
    // Of three projects, two are unfinished and one is delayed.
    const valueOf = (label: string) => within(figures).getByText(label).closest('.stat-card')?.querySelector('.stat-card__value')?.textContent
    expect(valueOf('Active projects')).toBe('2')
    expect(within(figures).getByText('3 projects in total')).toBeTruthy()
    expect(valueOf('Need attention')).toBe('1')

    expect(getProjectsMock).toHaveBeenCalledWith({ pageSize: 100 }, expect.any(AbortSignal))
    expect(screen.getByRole('link', { name: 'View all 3 projects' }).getAttribute('href')).toBe('/projects')
  })

  it('lists unfinished projects by deadline and links to their detail pages', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectB, projectA, projectC]))
    renderPage()

    await screen.findByRole('region', { name: 'Key figures' })
    const table = screen.getByRole('table')
    const names = within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent)
    // Alpha is due before Bravo; the completed project is left out.
    expect(names).toEqual(['Alpha Network', 'Bravo Laptops'])
    expect(within(table).getByRole('link', { name: 'Alpha Network' }).getAttribute('href')).toBe('/projects/PRJ-001')
  })

  it('labels every hard-coded section as sample data and nothing that comes from the API', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB, projectC]))
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })

    const card = (label: string) => screen.getByText(label).closest('.stat-card') as HTMLElement
    const section = (name: string) => screen.getByRole('heading', { name }).closest('section') as HTMLElement

    // Calculated from the API: no sample label.
    expect(within(card('Active projects')).queryByText('Sample data')).toBeNull()
    expect(within(card('Need attention')).queryByText('Sample data')).toBeNull()
    expect(within(section('Projects at a glance')).queryByText('Sample data')).toBeNull()
    expect(within(section('Status breakdown')).queryByText('Sample data')).toBeNull()

    // Hard-coded: labelled.
    expect(within(card('Tasks due this week')).getByText('Sample data')).toBeTruthy()
    expect(within(card('Equipment deployed')).getByText('Sample data')).toBeTruthy()
    expect(within(section('Upcoming milestones')).getByText('Sample data')).toBeTruthy()
    expect(within(section('Recent activity')).getByText('Sample data')).toBeTruthy()
    expect(screen.getAllByText('Sample data')).toHaveLength(4)
  })

  it('warns when the figures cover only part of the data', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB], { total: 150, pageSize: 100, totalPages: 2 }))
    renderPage()
    const note = await screen.findByRole('note')
    expect(note.textContent).toBe('Project figures on this page are based on the first 2 of 150 projects.')
  })

  it('shows no warning when every project is included', async () => {
    getProjectsMock.mockResolvedValue(listResponse([projectA, projectB]))
    renderPage()
    await screen.findByRole('region', { name: 'Key figures' })
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('shows an error with retry when projects cannot be loaded', async () => {
    getProjectsMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached.', 0))
    getProjectsMock.mockResolvedValueOnce(listResponse([projectA]))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The dashboard could not be loaded')).toBeTruthy()

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Key figures' })).toBeTruthy()
  })
})
