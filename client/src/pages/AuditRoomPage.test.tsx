import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuditCycles, getAuditRoom } from '../api/audit'
import { ApiRequestError } from '../api/http'
import type { RoomDetail } from '@lc-projecthub/shared'
import { closedCycle, cycleList, foundLine, panelLine, projectorLine, roomDetail } from '../test/auditFixtures'
import { AuditRoomPage } from './AuditRoomPage'

vi.mock('../api/audit', () => ({ getAuditCycles: vi.fn(), getAuditBlocks: vi.fn(), getAuditBlock: vi.fn(), getAuditRooms: vi.fn(), getAuditRoom: vi.fn() }))
const roomMock = vi.mocked(getAuditRoom)

function renderPage(url = '/audit/rooms/ROOM-001') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/audit/rooms/:id" element={<AuditRoomPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const row = (text: RegExp | string) => within(screen.getByText(text).closest('tr') as HTMLElement)

beforeEach(() => {
  roomMock.mockReset().mockResolvedValue(roomDetail())
  vi.mocked(getAuditCycles).mockReset().mockResolvedValue(cycleList)
})

describe('AuditRoomPage', () => {
  it('shows a loading state, then the room, its status and its place', async () => {
    let resolve!: (value: ReturnType<typeof roomDetail>) => void
    roomMock.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage()
    expect(screen.getByText('Loading room…')).toBeTruthy()
    resolve(roomDetail())
    expect(await screen.findByRole('heading', { level: 1, name: 'B001' })).toBeTruthy()
    expect(screen.getByText('Training room')).toBeTruthy()
    expect(screen.getByRole('link', { name: '← Back to B Block, Ground floor' }).getAttribute('href')).toBe('/audit/blocks/BLK-001/floors/FLR-001?cycle=CYC-003')
  })

  it('in the open cycle nothing is answered: each item says so and shows last time', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'B001' })
    expect(screen.getByText('This room has not been inspected yet.')).toBeTruthy()
    const projector = row('Projector')
    expect(projector.getByText('No answer yet')).toBeTruthy()
    expect(projector.getByText('Not working')).toBeTruthy()
    expect(projector.getByText('Lamp failing')).toBeTruthy()
    expect(projector.getByText(/Summer 2026/)).toBeTruthy()
    expect(projector.getByText('Asset tag AT-1001 · Serial SN-9001')).toBeTruthy()
    expect(screen.getByText('3 items · 0 answered in Summer 2027')).toBeTruthy()
  })

  it('shows a firmware check in its own words, never as Working / Not working', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'B001' })
    const panel = row('Clevertouch panel')
    expect(panel.getByText('Firmware: Needs update', { exact: false })).toBeTruthy()
    expect(panel.getByText('(Update due)')).toBeTruthy()
    expect(panel.queryByText(/Firmware: Not working/)).toBeNull()
  })

  it('flags an item found during an inspection as needing review, and says where it came from', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'B001' })
    const found = row(/Other: Document camera/)
    expect(found.getByText('Needs review')).toBeTruthy()
    expect(found.getByText('Found during an inspection')).toBeTruthy()
    expect(found.getByText('No earlier inspection')).toBeTruthy()
  })

  it('shows this cycle answer beside last time for a completed room, marking a corrected answer', async () => {
    roomMock.mockResolvedValue(
      roomDetail(
        {
          inspection: { status: 'Completed', inScope: true, inspectionId: 'INS-9', inspectorName: 'Aisha Rahman', startedAt: '2026-07-01T09:00:00.000Z', completedAt: '2026-07-01T09:30:00.000Z', checkedLines: 1, totalLines: 1, unableReason: null },
          equipment: [
            {
              ...projectorLine,
              current: { ...projectorLine.previous!, cycleName: 'Summer 2026', condition: 'Needs replacement', note: 'Cracked housing', corrected: true },
              previous: null,
            },
          ],
        },
        closedCycle,
      ),
    )
    renderPage('/audit/rooms/ROOM-001?cycle=CYC-002')
    await screen.findByRole('heading', { level: 1, name: 'B001' })
    const projector = row('Projector')
    expect(projector.getByText('Needs replacement')).toBeTruthy()
    expect(projector.getByText('Corrected')).toBeTruthy()
    expect(projector.getByText('Cracked housing')).toBeTruthy()
    expect(projector.getByText('No earlier inspection')).toBeTruthy()
    expect(screen.getByText('Inspector')).toBeTruthy()
    expect(screen.getByText('Completed', { selector: 'dt' })).toBeTruthy()
    expect(roomMock.mock.calls[0][1]).toBe('CYC-002')
  })

  it('shows why a room could not be inspected', async () => {
    roomMock.mockResolvedValue(
      roomDetail({ inspection: { status: 'Unable to inspect', inScope: true, inspectionId: 'INS-2', inspectorName: 'Tom Hale', startedAt: '2026-07-02T09:00:00.000Z', completedAt: null, checkedLines: 0, totalLines: 0, unableReason: 'Room locked' } }, closedCycle),
    )
    renderPage('/audit/rooms/ROOM-001?cycle=CYC-002')
    expect(await screen.findByText('Room locked')).toBeTruthy()
    expect(screen.getByText('Reason:')).toBeTruthy()
  })

  it('for a room with no equipment, says so and shows the inspector confirmation', async () => {
    roomMock.mockResolvedValue(roomDetail({ equipment: [], equipmentCount: 0, noEquipmentConfirmed: true }, closedCycle))
    renderPage('/audit/rooms/ROOM-001?cycle=CYC-002')
    expect(await screen.findByText('No equipment is recorded for this room.')).toBeTruthy()
    expect(screen.getByText(/confirmed in this cycle that the room has no equipment/)).toBeTruthy()
  })

  it('does not claim a retired room was never inspected; it was not part of the cycle', async () => {
    roomMock.mockResolvedValue(roomDetail({ active: false, equipment: [], inspection: { status: 'Not started', inScope: false, inspectionId: null, inspectorName: null, startedAt: null, completedAt: null, checkedLines: 0, totalLines: 0, unableReason: null } }))
    renderPage()
    expect(await screen.findByText('This room was not part of this cycle.')).toBeTruthy()
    expect(screen.queryByText('This room has not been inspected yet.')).toBeNull()
  })

  it('a draft answer of "Not checked" is shown as text, not as an answered item', async () => {
    roomMock.mockResolvedValue(roomDetail({ equipment: [{ ...foundLine, current: { ...projectorLine.previous!, condition: 'Not checked', checkedAt: null, inspectorName: null } }] }))
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'B001' })
    const found = row(/Document camera/)
    expect(found.getByText('Not checked')).toBeTruthy()
    expect(screen.getByText(/0 answered/)).toBeTruthy()
  })

  it('switching cycle reloads the room for that cycle', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('Inspection cycle'), { target: { value: 'CYC-002' } })
    await screen.findByRole('heading', { level: 1, name: 'B001' })
    expect(roomMock.mock.calls.at(-1)![1]).toBe('CYC-002')
  })

  it('explains an unknown room, and a failed load can be retried', async () => {
    roomMock.mockRejectedValueOnce(new ApiRequestError('Room was not found.', 404))
    renderPage('/audit/rooms/ROOM-999')
    expect(await screen.findByText('Room or cycle not found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('shows an error with a retry when the room cannot be loaded', async () => {
    roomMock.mockRejectedValueOnce(new ApiRequestError('The server is currently unavailable. Please try again shortly.', 503))
    renderPage()
    expect(await screen.findByText('The room could not be loaded')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'B001' })).toBeTruthy()
  })

  describe('the way into an inspection', () => {
    const inspectionWith = (over: Partial<RoomDetail['inspection']>) => roomDetail({ inspection: { ...roomDetail().data.inspection, ...over } })

    it('offers "Start inspection" for a room not yet inspected in the open cycle, keeping the cycle in the link', async () => {
      renderPage('/audit/rooms/ROOM-001?cycle=CYC-003')
      await screen.findByRole('heading', { level: 1, name: 'B001' })
      expect(screen.getByRole('link', { name: 'Start inspection' }).getAttribute('href')).toBe('/audit/rooms/ROOM-001/inspect?cycle=CYC-003')
    })

    it('offers "Continue inspection" while one is in progress, and "Inspect this room again" after unable to inspect', async () => {
      roomMock.mockResolvedValue(inspectionWith({ status: 'In progress', inspectionId: 'INS-010', inspectorName: 'Aisha Rahman', startedAt: '2027-07-12T09:00:00.000Z' }))
      const first = renderPage()
      expect(await screen.findByRole('link', { name: 'Continue inspection' })).toBeTruthy()
      first.unmount()
      roomMock.mockResolvedValue(inspectionWith({ status: 'Unable to inspect', inspectionId: 'INS-010', unableReason: 'Room locked' }))
      renderPage()
      expect(await screen.findByRole('link', { name: 'Inspect this room again' })).toBeTruthy()
    })

    it('offers nothing for a completed room, a closed cycle, a retired room or a room outside the cycle', async () => {
      roomMock.mockResolvedValue(inspectionWith({ status: 'Completed', inspectionId: 'INS-010' }))
      const a = renderPage()
      await screen.findByRole('heading', { level: 1, name: 'B001' })
      expect(screen.queryByRole('link', { name: /inspect/i })).toBeNull()
      a.unmount()

      roomMock.mockResolvedValue(roomDetail({}, closedCycle))
      const b = renderPage('/audit/rooms/ROOM-001?cycle=CYC-002')
      await screen.findByRole('heading', { level: 1, name: 'B001' })
      expect(screen.queryByRole('link', { name: /inspect/i })).toBeNull()
      b.unmount()

      roomMock.mockResolvedValue(roomDetail({ active: false }))
      const c = renderPage()
      await screen.findByRole('heading', { level: 1, name: 'B001' })
      expect(screen.queryByRole('link', { name: /inspect/i })).toBeNull()
      c.unmount()

      roomMock.mockResolvedValue(inspectionWith({ inScope: false }))
      renderPage()
      await screen.findByRole('heading', { level: 1, name: 'B001' })
      expect(screen.queryByRole('link', { name: /inspect/i })).toBeNull()
    })
  })
})

void panelLine
