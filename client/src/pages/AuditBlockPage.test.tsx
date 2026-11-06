import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuditBlock, getAuditCycles, getAuditRooms } from '../api/audit'
import { ApiRequestError } from '../api/http'
import { blockDetailB, cycleList, roomB001, roomB002, roomB103, roomB205, roomDone, roomListResponse, roomUnable } from '../test/auditFixtures'
import { AuditBlockPage } from './AuditBlockPage'

vi.mock('../api/audit', () => ({ getAuditCycles: vi.fn(), getAuditBlocks: vi.fn(), getAuditBlock: vi.fn(), getAuditRooms: vi.fn(), getAuditRoom: vi.fn() }))
const blockMock = vi.mocked(getAuditBlock)
const roomsMock = vi.mocked(getAuditRooms)

function Address() {
  const location = useLocation()
  return <output aria-label="address">{location.pathname + location.search}</output>
}

function renderPage(url = '/audit/blocks/BLK-001') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/audit/blocks/:id" element={<AuditBlockPage />} />
        <Route path="/audit/blocks/:id/floors/:floorId" element={<AuditBlockPage />} />
      </Routes>
      <Address />
    </MemoryRouter>,
  )
}

const address = () => screen.getByLabelText('address').textContent
const lastRooms = () => roomsMock.mock.calls.at(-1)![0]
const floorNav = () => within(screen.getByRole('navigation', { name: 'Floors' }))

beforeEach(() => {
  blockMock.mockReset().mockResolvedValue(blockDetailB)
  roomsMock.mockReset().mockResolvedValue(roomListResponse([roomB001, roomB002]))
  vi.mocked(getAuditCycles).mockReset().mockResolvedValue(cycleList)
})

describe('AuditBlockPage', () => {
  it('shows a loading state, then the block heading and counts', async () => {
    let resolve!: (value: typeof blockDetailB) => void
    blockMock.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage()
    expect(screen.getByText('Loading block…')).toBeTruthy()
    resolve(blockDetailB)
    expect(await screen.findByRole('heading', { level: 1, name: 'B Block' })).toBeTruthy()
    expect(screen.getByText('2 floors · 15 active rooms · 1 retired')).toBeTruthy()
  })

  it('offers All floors and each floor with its room count, and marks the chosen floor', async () => {
    renderPage('/audit/blocks/BLK-001/floors/FLR-002')
    await screen.findByRole('heading', { level: 1, name: 'B Block' })
    const links = floorNav().getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['All floors 15', 'Ground floor 6', 'First floor 9'])
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, null, 'page'])
    expect(lastRooms()).toMatchObject({ block: 'BLK-001', floor: 'FLR-002' })
  })

  it('states the progress of the chosen floor, or the whole block when no floor is chosen', async () => {
    renderPage('/audit/blocks/BLK-001')
    expect(await screen.findByText('B Block: 0 of 15 rooms completed · 15 not started')).toBeTruthy()
    fireEvent.click(floorNav().getByRole('link', { name: /First floor/ }))
    expect(await screen.findByText('First floor: 0 of 9 rooms completed · 9 not started')).toBeTruthy()
  })

  it('lists rooms with equipment, inspection state and why a room could not be inspected', async () => {
    roomsMock.mockResolvedValue(roomListResponse([roomB001, roomB002, roomB103, roomDone, roomUnable, roomB205]))
    renderPage()
    await screen.findByRole('link', { name: 'B001' })
    const row = (code: string) => within(screen.getByRole('link', { name: code }).closest('tr') as HTMLElement)
    expect(row('B001').getByText('3 items')).toBeTruthy()
    expect(row('B001').getByText('Not started')).toBeTruthy()
    expect(row('B002').getByText('No equipment')).toBeTruthy()
    expect(row('B103').getByText('1 to review')).toBeTruthy()
    expect(row('B006').getByText('Completed')).toBeTruthy()
    expect(row('B006').getByText('Aisha Rahman · 1 Jul 2026')).toBeTruthy()
    expect(row('B007').getByText('Unable to inspect')).toBeTruthy()
    expect(row('B007').getByText('Room locked')).toBeTruthy()
    expect(row('B205').getByText('Not in this cycle')).toBeTruthy()
    expect(row('B205').getByText('Retired')).toBeTruthy()
  })

  it('links each room and keeps the cycle', async () => {
    renderPage('/audit/blocks/BLK-001?cycle=CYC-002')
    const link = await screen.findByRole('link', { name: 'B001' })
    expect(link.getAttribute('href')).toBe('/audit/rooms/ROOM-001?cycle=CYC-002')
    expect(lastRooms()).toMatchObject({ cycle: 'CYC-002' })
    expect((blockMock.mock.calls[0][1])).toBe('CYC-002')
  })

  it('the inspection filter asks the server for that state and is kept in the address', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'B001' })
    fireEvent.change(screen.getByLabelText('Inspection'), { target: { value: 'unable' } })
    await waitFor(() => expect(lastRooms()).toMatchObject({ inspection: 'unable', page: 1 }))
    expect(address()).toBe('/audit/blocks/BLK-001?inspection=unable')
  })

  it('ignores an unknown filter value in the address instead of sending it', async () => {
    renderPage('/audit/blocks/BLK-001?inspection=bogus&status=bogus&page=-3')
    await screen.findByRole('link', { name: 'B001' })
    expect(lastRooms()).toMatchObject({ inspection: 'all', status: 'active', page: 1 })
  })

  it('changing floor keeps the cycle and filters but returns to page 1', async () => {
    renderPage('/audit/blocks/BLK-001?cycle=CYC-002&inspection=completed&page=2')
    await screen.findByRole('heading', { level: 1, name: 'B Block' })
    const link = floorNav().getByRole('link', { name: /Ground floor/ })
    expect(link.getAttribute('href')).toBe('/audit/blocks/BLK-001/floors/FLR-001?cycle=CYC-002&inspection=completed')
  })

  it('changing the cycle keeps the floor and filters and returns to page 1', async () => {
    renderPage('/audit/blocks/BLK-001/floors/FLR-001?inspection=unable&page=2')
    fireEvent.change(await screen.findByLabelText('Inspection cycle'), { target: { value: 'CYC-002' } })
    await waitFor(() => expect(lastRooms()).toMatchObject({ cycle: 'CYC-002', floor: 'FLR-001', inspection: 'unable', page: 1 }))
    expect(address()).toBe('/audit/blocks/BLK-001/floors/FLR-001?inspection=unable&cycle=CYC-002')
  })

  it('Clear filters keeps the cycle and resets the rest', async () => {
    renderPage('/audit/blocks/BLK-001?cycle=CYC-002&inspection=unable&q=B0')
    await screen.findByRole('link', { name: 'B001' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(address()).toBe('/audit/blocks/BLK-001?cycle=CYC-002'))
  })

  it('says no rooms match when a filter finds none, and offers to clear it', async () => {
    roomsMock.mockResolvedValue(roomListResponse([]))
    renderPage('/audit/blocks/BLK-001?inspection=unable')
    expect(await screen.findByText('No rooms match your filters')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0)
  })

  it('shows an error for the room list and retries it, leaving the block heading in place', async () => {
    roomsMock.mockRejectedValueOnce(new ApiRequestError('The server is currently unavailable. Please try again shortly.', 503))
    renderPage()
    expect(await screen.findByText('Rooms could not be loaded')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'B Block' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'B001' })).toBeTruthy()
  })

  it('explains an unknown block, with a way back', async () => {
    blockMock.mockRejectedValue(new ApiRequestError('Block BLK-999 was not found.', 404))
    renderPage('/audit/blocks/BLK-999')
    expect(await screen.findByText('Block or cycle not found')).toBeTruthy()
    expect(screen.getByRole('link', { name: '← Back to audit overview' }).getAttribute('href')).toBe('/audit')
  })
})
