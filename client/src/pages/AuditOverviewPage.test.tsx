import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuditBlocks, getAuditCycles } from '../api/audit'
import { ApiRequestError } from '../api/http'
import { blockList, blockListClosed, cycleList } from '../test/auditFixtures'
import { AuditOverviewPage } from './AuditOverviewPage'

vi.mock('../api/audit', () => ({ getAuditCycles: vi.fn(), getAuditBlocks: vi.fn(), getAuditBlock: vi.fn(), getAuditRooms: vi.fn(), getAuditRoom: vi.fn() }))
const blocksMock = vi.mocked(getAuditBlocks)

function Address() {
  const location = useLocation()
  return <output aria-label="address">{location.pathname + location.search}</output>
}

function renderPage(url = '/audit') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AuditOverviewPage />
      <Address />
    </MemoryRouter>,
  )
}

const card = (label: string) => screen.getByText(label, { selector: '.stat-card__label' }).closest('.stat-card') as HTMLElement
const value = (label: string) => card(label).querySelector('.stat-card__value')!.textContent
const hint = (label: string) => card(label).querySelector('.stat-card__hint')!.textContent

beforeEach(() => {
  blocksMock.mockReset()
  vi.mocked(getAuditCycles).mockReset().mockResolvedValue(cycleList)
})

describe('AuditOverviewPage', () => {
  it('shows the heading, and loading placeholders (never a number) while the data loads', async () => {
    let resolve!: (value: typeof blockList) => void
    blocksMock.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Audit' })).toBeTruthy()
    expect(screen.getByText('Loading blocks…')).toBeTruthy()
    for (const label of ['Rooms to inspect', 'Completed', 'Still to inspect', 'Unable to inspect']) {
      expect(value(label)).toBe('—')
      expect(card(label).getAttribute('aria-busy')).toBe('true')
    }
    resolve(blockList)
    await screen.findByRole('link', { name: 'B Block' })
    expect(screen.queryByText('Loading blocks…')).toBeNull()
  })

  it('asks for the open cycle by default (no cycle in the request) and names it', async () => {
    blocksMock.mockResolvedValue(blockList)
    renderPage()
    await screen.findByRole('link', { name: 'B Block' })
    expect(blocksMock.mock.calls[0][0]).toBeUndefined()
    expect(((await screen.findByLabelText('Inspection cycle')) as HTMLSelectElement).value).toBe('CYC-003')
    expect(screen.getByText('Open', { selector: '.badge' })).toBeTruthy()
  })

  it('shows zero progress for the open cycle plainly, with a note that nothing has been recorded yet', async () => {
    blocksMock.mockResolvedValue(blockList)
    renderPage()
    await screen.findByRole('link', { name: 'B Block' })
    expect(value('Rooms to inspect')).toBe('25')
    expect(value('Completed')).toBe('0 (0%)')
    expect(hint('Completed')).toBe('0 of 25 rooms completed')
    expect(value('Still to inspect')).toBe('25')
    expect(hint('Still to inspect')).toBe('25 not started · 0 in progress')
    expect(value('Unable to inspect')).toBe('0')
    expect(screen.getByText(/No inspections have been recorded in this cycle yet/)).toBeTruthy()
  })

  it('lists every block with floors, rooms and progress, each linked to its rooms and keeping the cycle', async () => {
    blocksMock.mockResolvedValue(blockListClosed)
    renderPage('/audit?cycle=CYC-002')
    const link = await screen.findByRole('link', { name: 'B Block' })
    expect(link.getAttribute('href')).toBe('/audit/blocks/BLK-001?cycle=CYC-002')
    const row = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement
    const b = within(row('B Block'))
    expect(b.getByText('(+1 retired)')).toBeTruthy()
    expect(b.getByText('10 of 15 rooms completed · 2 unable to inspect · 3 not started')).toBeTruthy()
    expect(within(row('S Block')).getByText('10 of 10 rooms completed')).toBeTruthy()
    expect(within(row('IOT')).getByText('No rooms to inspect')).toBeTruthy()
    expect(value('Completed')).toBe('20 (80%)')
    // A closed cycle with work done does not claim "nothing recorded".
    expect(screen.queryByText(/No inspections have been recorded/)).toBeNull()
    expect(blocksMock.mock.calls[0][0]).toBe('CYC-002')
  })

  it('switching cycle reloads the figures and puts the cycle in the address', async () => {
    blocksMock.mockImplementation(async (cycle) => (cycle === 'CYC-002' ? blockListClosed : blockList))
    renderPage()
    await screen.findByRole('link', { name: 'B Block' })
    fireEvent.change(await screen.findByLabelText('Inspection cycle'), { target: { value: 'CYC-002' } })
    await screen.findByText('Closed', { selector: '.badge' })
    expect(screen.getByLabelText('address').textContent).toBe('/audit?cycle=CYC-002')
    expect(await screen.findByText('20 (80%)', { selector: '.stat-card__value' })).toBeTruthy()
    expect(screen.getByText(/Closed: kept as a record/)).toBeTruthy()
  })

  it('ignores a malformed cycle in the address instead of sending it', async () => {
    blocksMock.mockResolvedValue(blockList)
    renderPage('/audit?cycle=%3Cscript%3E')
    await screen.findByRole('link', { name: 'B Block' })
    expect(blocksMock.mock.calls[0][0]).toBeUndefined()
  })

  it('shows one error, not dashes, when the blocks cannot be loaded, and retries', async () => {
    blocksMock.mockRejectedValueOnce(new ApiRequestError('The server is currently unavailable. Please try again shortly.', 503))
    renderPage()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Blocks could not be loaded')).toBeTruthy()
    expect(screen.queryByText('Rooms to inspect')).toBeNull()
    blocksMock.mockResolvedValue(blockList)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'B Block' })).toBeTruthy()
  })

  it('explains an unknown cycle and offers the current one', async () => {
    blocksMock.mockRejectedValue(new ApiRequestError('Inspection cycle CYC-999 was not found.', 404))
    renderPage('/audit?cycle=CYC-999')
    expect(await screen.findByText('Inspection cycle not found')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Show the current cycle' }).getAttribute('href')).toBe('/audit')
  })

  it('shows an empty state when there are no blocks', async () => {
    blocksMock.mockResolvedValue({ ...blockList, data: [], summary: { ...blockList.summary, blocks: 0, floors: 0, rooms: 0 } })
    renderPage()
    expect(await screen.findByText('There are no blocks yet')).toBeTruthy()
  })

  it('still names the cycle when the list of cycles cannot be loaded', async () => {
    vi.mocked(getAuditCycles).mockRejectedValue(new ApiRequestError('The server could not be reached.', 0))
    blocksMock.mockResolvedValue(blockList)
    renderPage()
    await screen.findByRole('link', { name: 'B Block' })
    expect(screen.getByText('Summer 2027')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Inspection cycle' })).toBeNull()
  })
})
