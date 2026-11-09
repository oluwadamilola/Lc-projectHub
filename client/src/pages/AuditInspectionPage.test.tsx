import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InspectionView, RoomInspectionSummary } from '@lc-projecthub/shared'
import {
  addInspectionEquipment,
  completeInspection,
  getAuditRoom,
  getEquipmentTypes,
  getInspection,
  markInspectionUnable,
  saveInspectionResult,
  setInspectionNoEquipment,
  startInspection,
} from '../api/audit'
import { ApiRequestError } from '../api/http'
import { getTechnicians } from '../api/tasks'
import { closedCycle, foundLine, inspectionView, roomB001, roomDetail } from '../test/auditFixtures'
import { AuditInspectionPage } from './AuditInspectionPage'

vi.mock('../api/audit', () => ({
  getAuditRoom: vi.fn(),
  getInspection: vi.fn(),
  startInspection: vi.fn(),
  saveInspectionResult: vi.fn(),
  addInspectionEquipment: vi.fn(),
  setInspectionNoEquipment: vi.fn(),
  markInspectionUnable: vi.fn(),
  completeInspection: vi.fn(),
  getEquipmentTypes: vi.fn(),
}))
vi.mock('../api/tasks', () => ({ getTechnicians: vi.fn() }))

const roomMock = vi.mocked(getAuditRoom)
const getInspectionMock = vi.mocked(getInspection)
const startMock = vi.mocked(startInspection)
const saveMock = vi.mocked(saveInspectionResult)
const addMock = vi.mocked(addInspectionEquipment)
const noneMock = vi.mocked(setInspectionNoEquipment)
const unableMock = vi.mocked(markInspectionUnable)
const completeMock = vi.mocked(completeInspection)

const technicians = [
  { id: 'TECH-001', name: 'Aisha Rahman', team: 'IT' },
  { id: 'TECH-002', name: 'Tom Hale', team: 'IT' },
]
const idle: RoomInspectionSummary = roomB001.inspection
const inProgress: RoomInspectionSummary = { ...idle, status: 'In progress', inspectionId: 'INS-010', inspectorName: 'Aisha Rahman', startedAt: '2027-07-12T09:00:00.000Z', checkedLines: 1, totalLines: 3 }

function renderPage(url = '/audit/rooms/ROOM-001/inspect?cycle=CYC-003') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/audit/rooms/:id/inspect" element={<AuditInspectionPage />} />
        <Route path="/audit/rooms/:id" element={<p>Room page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const card = (title: string | RegExp) => within(screen.getByRole('heading', { level: 3, name: title }).closest('li') as HTMLElement)
const radio = (scope: ReturnType<typeof card>, name: string) => scope.getAllByRole('radio', { name })[0]!
const completeButton = () => screen.getByRole('button', { name: /Complete inspection|Completing/ }) as HTMLButtonElement
const answered = (view: InspectionView) => saveMock.mockResolvedValue({ data: view })

const completedView = (): InspectionView =>
  inspectionView(
    { 'EQP-001': { condition: 'Not working', note: 'Lamp failing' }, 'EQP-002': { condition: 'Working', checks: { firmware: 'Not working' } }, 'EQP-003': { condition: 'Working' } },
    {
      status: 'Completed',
      completedAt: '2027-07-12T10:00:00.000Z',
      summary: {
        totalItems: 3,
        counts: { Working: 2, 'Not working': 1, 'Needs replacement': 0, Missing: 0, 'Not applicable': 0 },
        issues: [{ equipmentItemId: 'EQP-001', label: 'Projector (AT-1001)', kind: 'Fault', condition: 'Not working', note: 'Lamp failing' }],
        checkIssues: [{ equipmentItemId: 'EQP-002', label: 'Clevertouch panel', checkId: 'firmware', checkLabel: 'Firmware', answer: 'Needs update', note: 'Version 3' }],
        foundItems: [{ equipmentItemId: 'EQP-003', label: 'Other: Document camera' }],
        noEquipmentConfirmed: false,
      },
    },
  )

beforeEach(() => {
  window.scrollTo = vi.fn()
  roomMock.mockReset().mockResolvedValue(roomDetail({ inspection: idle }))
  getInspectionMock.mockReset().mockResolvedValue({ data: inspectionView() })
  startMock.mockReset().mockResolvedValue({ data: inspectionView() })
  saveMock.mockReset()
  addMock.mockReset()
  noneMock.mockReset()
  unableMock.mockReset()
  completeMock.mockReset()
  vi.mocked(getEquipmentTypes).mockReset().mockResolvedValue({
    data: [
      { id: 'projector', label: 'Projector', order: 1, requiresName: false, checks: [] },
      { id: 'other', label: 'Other', order: 9, requiresName: true, checks: [] },
    ],
  })
  vi.mocked(getTechnicians).mockReset().mockResolvedValue(technicians)
})

describe('AuditInspectionPage: getting in', () => {
  it('shows the start screen for a room not yet inspected, and nothing is created until Start is pressed', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Start the inspection' })).toBeTruthy()
    expect(screen.getByText(/has 3 items to check/)).toBeTruthy()
    expect(startMock).not.toHaveBeenCalled()
  })

  it('asks who is inspecting, from the existing technicians, and refuses to start without one', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Start the inspection' })
    const options = within(screen.getByLabelText('Who is inspecting?')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Choose a technician…', 'Aisha Rahman', 'Tom Hale'])
    fireEvent.click(screen.getByRole('button', { name: 'Start inspection' }))
    expect(await screen.findByText('Choose who is inspecting.')).toBeTruthy()
    expect(startMock).not.toHaveBeenCalled()
  })

  it('starts with the chosen technician in the open cycle and opens the checklist', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Start the inspection' })
    fireEvent.change(screen.getByLabelText('Who is inspecting?'), { target: { value: 'TECH-002' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start inspection' }))
    expect(await screen.findByRole('heading', { level: 3, name: /Projector/ })).toBeTruthy()
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(startMock).toHaveBeenCalledWith('ROOM-001', { inspectorId: 'TECH-002', cycleId: 'CYC-003' })
    expect(screen.getByText('0 of 3 items checked')).toBeTruthy()
  })

  it('remembers the technician for next time, and still works when the browser will not store it', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Start the inspection' })
    fireEvent.change(screen.getByLabelText('Who is inspecting?'), { target: { value: 'TECH-002' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start inspection' }))
    await screen.findByRole('heading', { level: 3, name: /Projector/ })
    expect(localStorage.getItem('lc.audit.inspector')).toBe('TECH-002')
  })

  it('sends one request when Start is submitted twice', async () => {
    let finish!: (value: { data: InspectionView }) => void
    startMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderPage()
    await screen.findByRole('heading', { name: 'Start the inspection' })
    fireEvent.change(screen.getByLabelText('Who is inspecting?'), { target: { value: 'TECH-001' } })
    const form = screen.getByRole('button', { name: 'Start inspection' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(startMock).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Starting…' }) as HTMLButtonElement).disabled).toBe(true)
    finish({ data: inspectionView() })
    await screen.findByRole('heading', { level: 3, name: /Projector/ })
    expect(startMock).toHaveBeenCalledTimes(1)
  })

  it('tells the technician when the server cannot be reached or refuses, and lets them try again', async () => {
    startMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached. Check your connection and try again.', 0))
    renderPage()
    await screen.findByRole('heading', { name: 'Start the inspection' })
    fireEvent.change(screen.getByLabelText('Who is inspecting?'), { target: { value: 'TECH-001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start inspection' }))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be reached')
    expect((screen.getByRole('button', { name: 'Start inspection' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Start inspection' }))
    expect(await screen.findByRole('heading', { level: 3, name: /Projector/ })).toBeTruthy()
  })

  it('shows the cycle date message when the server refuses to start outside the cycle window', async () => {
    startMock.mockRejectedValueOnce(new ApiRequestError('Summer 2027 opens on 2027-06-21, so inspections cannot be recorded in it yet.', 409, 'CONFLICT'))
    renderPage()
    await screen.findByRole('heading', { name: 'Start the inspection' })
    fireEvent.change(screen.getByLabelText('Who is inspecting?'), { target: { value: 'TECH-001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start inspection' }))
    expect((await screen.findByRole('alert')).textContent).toContain('opens on 2027-06-21')
  })

  it('refuses a closed cycle, a retired room and a room outside the cycle, and says an unknown room is not found', async () => {
    roomMock.mockResolvedValue(roomDetail({}, closedCycle))
    const first = renderPage('/audit/rooms/ROOM-001/inspect?cycle=CYC-002')
    expect(await screen.findByText('Summer 2026 is closed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start inspection' })).toBeNull()
    first.unmount()

    roomMock.mockResolvedValue(roomDetail({ active: false }))
    const second = renderPage()
    expect(await screen.findByText('This room is not being inspected')).toBeTruthy()
    second.unmount()

    roomMock.mockResolvedValue(roomDetail({ inspection: { ...idle, inScope: false } }))
    const third = renderPage()
    expect(await screen.findByText('This room is not being inspected')).toBeTruthy()
    third.unmount()

    roomMock.mockRejectedValue(new ApiRequestError('No such room', 404, 'NOT_FOUND'))
    renderPage('/audit/rooms/ROOM-999/inspect')
    expect(await screen.findByText('Room or cycle not found')).toBeTruthy()
  })
})

describe('AuditInspectionPage: carrying out the checklist', () => {
  async function openWorkspace(view: InspectionView = inspectionView()) {
    roomMock.mockResolvedValue(roomDetail({ inspection: inProgress }))
    getInspectionMock.mockResolvedValue({ data: view })
    renderPage()
    await screen.findByRole('heading', { level: 3, name: /Projector/ })
  }

  it('resumes an inspection already under way after a reload: it is loaded, not started again, with earlier answers shown', async () => {
    await openWorkspace(inspectionView({ 'EQP-001': { condition: 'Not working', note: 'Lamp failing' } }))
    expect(startMock).not.toHaveBeenCalled()
    expect(getInspectionMock).toHaveBeenCalledWith('INS-010', expect.anything())
    expect(screen.getByText('1 of 3 items checked')).toBeTruthy()
    expect((radio(card(/Projector/), 'Not working') as HTMLInputElement).checked).toBe(true)
    expect((card(/Projector/).getByLabelText(/Note \(required/) as HTMLTextAreaElement).value).toBe('Lamp failing')
  })

  it('shows each item with its identity, five conditions, and what it was last time', async () => {
    await openWorkspace()
    const projector = card(/Projector/)
    expect(projector.getByText('Asset tag AT-1001 · Serial SN-9001')).toBeTruthy()
    expect(projector.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['Working', 'Not working', 'Needs replacement', 'Missing', 'Not applicable'])
    expect(projector.getByText('Not working', { selector: '.badge' })).toBeTruthy()
    expect(projector.getByText(/Lamp failing/)).toBeTruthy()
    expect(projector.getByText(/Summer 2026/)).toBeTruthy()
    expect(card(/Other: Document camera/).getByText('No earlier inspection')).toBeTruthy()
    expect(card(/Other: Document camera/).getByText('Needs review')).toBeTruthy()
  })

  it('saves a chosen condition at once, updates the progress from the server answer, and says everything is saved', async () => {
    await openWorkspace()
    answered(inspectionView({ 'EQP-001': { condition: 'Working' } }))
    fireEvent.click(radio(card(/Projector/), 'Working'))
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy())
    expect(saveMock).toHaveBeenCalledWith('INS-010', 'EQP-001', { condition: 'Working', note: '', checks: [] })
    expect(screen.getByText('1 of 3 items checked')).toBeTruthy()
    expect(card(/Projector/).getByText('Saved')).toBeTruthy()
  })

  it('shows a required note box as soon as a condition needs one, keeps Complete disabled, and lists what is missing', async () => {
    await openWorkspace()
    answered(inspectionView({ 'EQP-001': { condition: 'Not working' } }))
    fireEvent.click(radio(card(/Projector/), 'Not working'))
    const note = (await card(/Projector/).findByLabelText(/Note \(required/)) as HTMLTextAreaElement
    expect(note.getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy())
    expect(completeButton().disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Projector: add a note describing why it is not working/ })).toBeTruthy()
  })

  it('sends a note once after typing pauses, not on every keystroke', async () => {
    await openWorkspace(inspectionView({ 'EQP-001': { condition: 'Not working' } }))
    answered(inspectionView({ 'EQP-001': { condition: 'Not working', note: 'Lamp failing badly' } }))
    const note = card(/Projector/).getByLabelText(/Note \(required/)
    fireEvent.change(note, { target: { value: 'Lamp' } })
    fireEvent.change(note, { target: { value: 'Lamp failing' } })
    fireEvent.change(note, { target: { value: 'Lamp failing badly' } })
    expect(saveMock).not.toHaveBeenCalled()
    expect(screen.getAllByText('Saving…').length).toBeGreaterThan(0)
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(saveMock).toHaveBeenCalledWith('INS-010', 'EQP-001', { condition: 'Not working', note: 'Lamp failing badly', checks: [] })
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy())
  })

  it('asks a firmware check in its own words, and sends its answer with the line', async () => {
    await openWorkspace()
    answered(inspectionView({ 'EQP-002': { condition: 'Working' } }))
    fireEvent.click(radio(card(/Clevertouch panel/), 'Working'))
    const panel = card(/Clevertouch panel/)
    expect(await panel.findByRole('radio', { name: 'Up to date' })).toBeTruthy()
    expect(panel.getByRole('radio', { name: 'Needs update' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy())
    fireEvent.click(panel.getByRole('radio', { name: 'Needs update' }))
    expect(await panel.findByLabelText(/Note about the firmware check \(required\)/)).toBeTruthy()
    await waitFor(() => expect(saveMock).toHaveBeenLastCalledWith('INS-010', 'EQP-002', { condition: 'Working', note: '', checks: [{ checkId: 'firmware', condition: 'Not working', note: '' }] }))
  })

  it('does not ask extra checks of an item that is Missing', async () => {
    await openWorkspace()
    answered(inspectionView({ 'EQP-002': { condition: 'Missing' } }))
    fireEvent.click(radio(card(/Clevertouch panel/), 'Missing'))
    await waitFor(() => expect(saveMock).toHaveBeenCalled())
    expect(card(/Clevertouch panel/).queryByRole('radio', { name: 'Up to date' })).toBeNull()
  })

  it('shows a failed save on the item and in the status bar, keeps Complete disabled, and Try again saves it', async () => {
    await openWorkspace(inspectionView({ 'EQP-002': { condition: 'Working', checks: { firmware: 'Working' } }, 'EQP-003': { condition: 'Working' } }))
    saveMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached. Check your connection and try again.', 0))
    fireEvent.click(radio(card(/Projector/), 'Working'))
    expect(await card(/Projector/).findByText(/Not saved: The server could not be reached/)).toBeTruthy()
    expect(screen.getByText('Some answers are not saved')).toBeTruthy()
    expect(completeButton().disabled).toBe(true)
    answered(inspectionView({ 'EQP-001': { condition: 'Working' }, 'EQP-002': { condition: 'Working', checks: { firmware: 'Working' } }, 'EQP-003': { condition: 'Working' } }))
    fireEvent.click(card(/Projector/).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy())
    expect(saveMock).toHaveBeenCalledTimes(2)
    expect(completeButton().disabled).toBe(false)
  })

  it('refuses a note over 500 characters on screen, with the reason, without sending it', async () => {
    await openWorkspace(inspectionView({ 'EQP-001': { condition: 'Not working' } }))
    fireEvent.change(card(/Projector/).getByLabelText(/Note \(required/), { target: { value: 'x'.repeat(520) } })
    expect(await card(/Projector/).findByText(/500/, {}, { timeout: 3000 })).toBeTruthy()
    expect(saveMock).not.toHaveBeenCalled()
    expect(screen.getByText('Some answers are not saved')).toBeTruthy()
  })

  it('keeps what was typed when the server answer for an earlier save arrives', async () => {
    await openWorkspace()
    let finish!: (value: { data: InspectionView }) => void
    saveMock.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    fireEvent.click(radio(card(/Projector/), 'Not working'))
    fireEvent.change(await card(/Projector/).findByLabelText(/Note \(required/), { target: { value: 'Typed meanwhile' } })
    finish({ data: inspectionView({ 'EQP-001': { condition: 'Not working' } }) })
    await waitFor(() => expect(screen.getByText('1 of 3 items checked')).toBeTruthy())
    expect((card(/Projector/).getByLabelText(/Note \(required/) as HTMLTextAreaElement).value).toBe('Typed meanwhile')
  })

  it('enables Complete only when the server says the inspection is valid, and sends one request when pressed twice', async () => {
    const full = inspectionView({ 'EQP-001': { condition: 'Working' }, 'EQP-002': { condition: 'Working', checks: { firmware: 'Working' } }, 'EQP-003': { condition: 'Working' } })
    expect(full.completion.canComplete).toBe(true)
    await openWorkspace(full)
    expect(screen.getByText(/Everything is answered/)).toBeTruthy()
    let finish!: (value: { data: InspectionView }) => void
    completeMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    fireEvent.click(completeButton())
    fireEvent.click(completeButton())
    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1))
    expect(completeButton().disabled).toBe(true)
    finish({ data: completedView() })
    expect(await screen.findByText(/Inspection completed for room B001/)).toBeTruthy()
    expect(completeMock).toHaveBeenCalledTimes(1)
  })

  it('sends any answer still waiting before completing', async () => {
    const full = inspectionView({ 'EQP-001': { condition: 'Working' }, 'EQP-002': { condition: 'Working', checks: { firmware: 'Working' } }, 'EQP-003': { condition: 'Working' } })
    await openWorkspace(full)
    answered(full)
    fireEvent.click(card(/Projector/).getByRole('button', { name: 'Add a note' }))
    fireEvent.change(card(/Projector/).getByLabelText('Note (optional)'), { target: { value: 'Cleaned filter' } })
    expect(completeButton().disabled).toBe(true)
    await waitFor(() => expect(completeButton().disabled).toBe(false), { timeout: 3000 })
    completeMock.mockResolvedValue({ data: completedView() })
    fireEvent.click(completeButton())
    await screen.findByText(/Inspection completed/)
    expect(saveMock.mock.invocationCallOrder[0]!).toBeLessThan(completeMock.mock.invocationCallOrder[0]!)
  })

  it('shows the completion summary: counts, issues reported, failed checks, and equipment found', async () => {
    const full = inspectionView({ 'EQP-001': { condition: 'Working' }, 'EQP-002': { condition: 'Working', checks: { firmware: 'Working' } }, 'EQP-003': { condition: 'Working' } })
    await openWorkspace(full)
    completeMock.mockResolvedValue({ data: completedView() })
    fireEvent.click(completeButton())
    expect(await screen.findByRole('heading', { name: 'Issues reported' })).toBeTruthy()
    expect(screen.getByText('3 items checked. 2 issues reported.')).toBeTruthy()
    expect(screen.getByText('Lamp failing', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('Firmware: Needs update')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Equipment found, needing review' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /View the room.s equipment and history/ }).getAttribute('href')).toBe('/audit/rooms/ROOM-001?cycle=CYC-003')
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('handles a Complete that fails to reach the server: says so, nothing is lost, and it can be pressed again', async () => {
    const full = inspectionView({ 'EQP-001': { condition: 'Working' }, 'EQP-002': { condition: 'Working', checks: { firmware: 'Working' } }, 'EQP-003': { condition: 'Working' } })
    await openWorkspace(full)
    completeMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached. Check your connection and try again.', 0))
    fireEvent.click(completeButton())
    expect((await screen.findByText('That did not work')).closest('[role="alert"]')!.textContent).toContain('could not be reached')
    expect(completeButton().disabled).toBe(false)
    completeMock.mockResolvedValue({ data: completedView() })
    fireEvent.click(completeButton())
    expect(await screen.findByText(/Inspection completed/)).toBeTruthy()
  })

  it('when the server says it was already completed (another screen), shows the completed summary instead of an error', async () => {
    const full = inspectionView({ 'EQP-001': { condition: 'Working' }, 'EQP-002': { condition: 'Working', checks: { firmware: 'Working' } }, 'EQP-003': { condition: 'Working' } })
    await openWorkspace(full)
    completeMock.mockRejectedValue(new ApiRequestError('Inspection INS-010 has already been completed and can no longer be changed.', 409, 'CONFLICT'))
    getInspectionMock.mockResolvedValue({ data: completedView() })
    fireEvent.click(completeButton())
    expect(await screen.findByText(/Inspection completed for room B001/)).toBeTruthy()
    expect(screen.queryByText('That did not work')).toBeNull()
  })

  it('shows an already completed inspection as its summary, with nothing to edit', async () => {
    roomMock.mockResolvedValue(roomDetail({ inspection: { ...inProgress, status: 'Completed', completedAt: '2027-07-12T10:00:00.000Z' } }))
    getInspectionMock.mockResolvedValue({ data: completedView() })
    renderPage()
    expect(await screen.findByText(/Inspection completed for room B001/)).toBeTruthy()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('says if the inspection under way cannot be loaded, and Try again loads it', async () => {
    roomMock.mockResolvedValue(roomDetail({ inspection: inProgress }))
    getInspectionMock.mockRejectedValueOnce(new ApiRequestError('The server could not be reached. Check your connection and try again.', 0))
    renderPage()
    expect(await screen.findByText('The inspection could not be opened')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 3, name: /Projector/ })).toBeTruthy()
  })
})

describe('AuditInspectionPage: unable to inspect', () => {
  async function openWorkspace(view: InspectionView = inspectionView({ 'EQP-001': { condition: 'Working' } })) {
    roomMock.mockResolvedValue(roomDetail({ inspection: inProgress }))
    getInspectionMock.mockResolvedValue({ data: view })
    renderPage()
    await screen.findByRole('heading', { level: 3, name: /Projector/ })
  }
  const unableView = () => inspectionView({ 'EQP-001': { condition: 'Working' } }, { status: 'Unable to inspect', attempts: [{ at: '2027-07-12T09:30:00.000Z', byId: 'TECH-001', byName: 'Aisha Rahman', reason: 'Room locked' }] })

  it('needs a reason of at least three characters, and sends nothing until it has one', async () => {
    await openWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'Unable to inspect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record: unable to inspect' }))
    expect(await screen.findByText(/reason/i, { selector: '.field__error' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'no' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record: unable to inspect' }))
    expect(unableMock).not.toHaveBeenCalled()
  })

  it('offers common reasons, records the reason with the inspector, then offers to inspect again with the answers kept', async () => {
    await openWorkspace()
    unableMock.mockResolvedValue({ data: unableView() })
    fireEvent.click(screen.getByRole('button', { name: 'Unable to inspect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Room locked' }))
    expect((screen.getByLabelText('Reason') as HTMLInputElement).value).toBe('Room locked')
    fireEvent.click(screen.getByRole('button', { name: 'Record: unable to inspect' }))
    expect(await screen.findByRole('heading', { name: 'Inspect this room again' })).toBeTruthy()
    expect(unableMock).toHaveBeenCalledWith('INS-010', { reason: 'Room locked', inspectorId: 'TECH-001' })
    expect(screen.getByText(/unable to inspect: Room locked/)).toBeTruthy()
    expect(screen.getByText(/Your answer from that visit has been kept/)).toBeTruthy()
  })

  it('starting again after unable uses the start call (the server resumes the same inspection) and shows the kept answers', async () => {
    await openWorkspace()
    unableMock.mockResolvedValue({ data: unableView() })
    fireEvent.click(screen.getByRole('button', { name: 'Unable to inspect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Room locked' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record: unable to inspect' }))
    await screen.findByRole('heading', { name: 'Inspect this room again' })
    startMock.mockResolvedValue({ data: inspectionView({ 'EQP-001': { condition: 'Working' } }, { attempts: unableView().attempts }) })
    fireEvent.change(screen.getByLabelText('Who is inspecting?'), { target: { value: 'TECH-002' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start inspection again' }))
    expect(await screen.findByRole('heading', { level: 3, name: /Projector/ })).toBeTruthy()
    expect(startMock).toHaveBeenCalledWith('ROOM-001', { inspectorId: 'TECH-002', cycleId: 'CYC-003' })
    expect(screen.getByText('1 of 3 items checked')).toBeTruthy()
    expect(screen.getByText(/Earlier visit: Room locked/)).toBeTruthy()
  })

  it('shows a room recorded as unable on load (a reload) with its reason, and the earlier answers noted', async () => {
    roomMock.mockResolvedValue(roomDetail({ inspection: { ...idle, status: 'Unable to inspect', inspectionId: 'INS-010', unableReason: 'No access to the room', checkedLines: 2, totalLines: 3 } }))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Inspect this room again' })).toBeTruthy()
    expect(screen.getByText(/No access to the room/)).toBeTruthy()
    expect(screen.getByText(/Your 2 answers from that visit have been kept/)).toBeTruthy()
  })

  it('shows the server message when recording unable fails, and stays on the form', async () => {
    await openWorkspace()
    unableMock.mockRejectedValue(new ApiRequestError('Summer 2027 ended on 2027-08-27, so inspections can no longer be recorded in it.', 409, 'CONFLICT'))
    fireEvent.click(screen.getByRole('button', { name: 'Unable to inspect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Room locked' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record: unable to inspect' }))
    expect(await screen.findByText(/ended on 2027-08-27/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Record: unable to inspect' })).toBeTruthy()
  })
})

describe('AuditInspectionPage: a room with no equipment, and equipment found', () => {
  const emptyView = (confirmed = false) => inspectionView({}, { noEquipmentConfirmed: confirmed }, [])

  async function openEmpty(view = emptyView()) {
    roomMock.mockResolvedValue(roomDetail({ inspection: { ...inProgress, checkedLines: 0, totalLines: 0 }, equipment: [] }))
    getInspectionMock.mockResolvedValue({ data: view })
    renderPage()
    await screen.findByRole('heading', { name: 'No equipment recorded for this room' })
  }

  it('shows the explicit confirmation instead of a checklist, with Complete disabled until it is confirmed', async () => {
    await openEmpty()
    expect(screen.getByText('0 of 0 items checked')).toBeTruthy()
    expect(completeButton().disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Confirm that this room has no equipment/ })).toBeTruthy()
    noneMock.mockResolvedValue({ data: emptyView(true) })
    fireEvent.click(screen.getByLabelText('I confirm there is no equipment in this room'))
    await waitFor(() => expect(completeButton().disabled).toBe(false))
    expect(noneMock).toHaveBeenCalledWith('INS-010', true)
    expect((screen.getByLabelText('I confirm there is no equipment in this room') as HTMLInputElement).checked).toBe(true)
  })

  it('shows the box ticked at once while the change is on its way, and takes the confirmation back', async () => {
    await openEmpty(emptyView(true))
    expect((screen.getByLabelText('I confirm there is no equipment in this room') as HTMLInputElement).checked).toBe(true)
    let finish!: (value: { data: InspectionView }) => void
    noneMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    fireEvent.click(screen.getByLabelText('I confirm there is no equipment in this room'))
    expect((screen.getByLabelText('I confirm there is no equipment in this room') as HTMLInputElement).checked).toBe(false)
    finish({ data: emptyView(false) })
    await waitFor(() => expect(completeButton().disabled).toBe(true))
    expect(noneMock).toHaveBeenCalledWith('INS-010', false)
  })

  it('shows the server refusal when it will not accept the confirmation, and leaves the box as the server has it', async () => {
    await openEmpty()
    noneMock.mockRejectedValue(new ApiRequestError('This room has 1 item of equipment, so it cannot be confirmed as having none.', 409, 'CONFLICT'))
    fireEvent.click(screen.getByLabelText('I confirm there is no equipment in this room'))
    expect(await screen.findByText(/cannot be confirmed as having none/)).toBeTruthy()
    expect((screen.getByLabelText('I confirm there is no equipment in this room') as HTMLInputElement).checked).toBe(false)
  })

  it('does not show the confirmation for a room that has equipment', async () => {
    roomMock.mockResolvedValue(roomDetail({ inspection: inProgress }))
    getInspectionMock.mockResolvedValue({ data: inspectionView() })
    renderPage()
    await screen.findByRole('heading', { level: 3, name: /Projector/ })
    expect(screen.queryByLabelText('I confirm there is no equipment in this room')).toBeNull()
  })

  describe('adding equipment found', () => {
    async function openAdd() {
      roomMock.mockResolvedValue(roomDetail({ inspection: inProgress }))
      getInspectionMock.mockResolvedValue({ data: inspectionView() })
      renderPage()
      await screen.findByRole('heading', { level: 3, name: /Projector/ })
      fireEvent.click(screen.getByRole('button', { name: 'Add equipment found' }))
      await screen.findByRole('heading', { name: 'Add equipment found in this room' })
    }

    it('refuses an empty form, a type that needs a name, and a bad asset tag, without calling the server', async () => {
      await openAdd()
      fireEvent.click(screen.getByRole('button', { name: 'Add to this room' }))
      expect(await screen.findByText(/Choose the type of equipment/, { selector: '.field__error' })).toBeTruthy()
      fireEvent.change(screen.getByLabelText('Type of equipment'), { target: { value: 'other' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add to this room' }))
      expect(await screen.findByText(/name/i, { selector: '.field__error' })).toBeTruthy()
      fireEvent.change(screen.getByLabelText('Type of equipment'), { target: { value: 'projector' } })
      fireEvent.change(screen.getByLabelText(/Asset tag/), { target: { value: 'bad tag!' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add to this room' }))
      expect(await screen.findByText(/letters, digits and hyphens only/i, { selector: '.field__error' })).toBeTruthy()
      expect(addMock).not.toHaveBeenCalled()
    })

    it('shows an asset tag already in use on the asset tag field, and adds nothing', async () => {
      await openAdd()
      addMock.mockRejectedValue(new ApiRequestError('Asset tag AT-1001 is already used by EQP-001.', 409, 'CONFLICT'))
      fireEvent.change(screen.getByLabelText('Type of equipment'), { target: { value: 'projector' } })
      fireEvent.change(screen.getByLabelText(/Asset tag/), { target: { value: 'AT-1001' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add to this room' }))
      expect(await screen.findByText(/already used by EQP-001/, { selector: '.field__error' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Add equipment found in this room' })).toBeTruthy()
    })

    it('adds the equipment once, puts it on the checklist flagged Needs review, and counts it as an unchecked item', async () => {
      await openAdd()
      const withFound = inspectionView({}, {}, [{ ...foundLine, id: 'EQP-004', typeLabel: 'Projector', name: '', assetTag: 'FND-1' }, ...inspectionView().lines])
      addMock.mockResolvedValue({ data: withFound, equipmentItemId: 'EQP-004' })
      fireEvent.change(screen.getByLabelText('Type of equipment'), { target: { value: 'projector' } })
      fireEvent.change(screen.getByLabelText(/Asset tag/), { target: { value: 'FND-1' } })
      const form = screen.getByRole('button', { name: 'Add to this room' }).closest('form')!
      fireEvent.submit(form)
      fireEvent.submit(form)
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add equipment found in this room' })).toBeNull())
      expect(addMock).toHaveBeenCalledTimes(1)
      expect(addMock).toHaveBeenCalledWith('INS-010', { equipmentTypeId: 'projector', name: '', assetTag: 'FND-1', serialNumber: null })
      expect(screen.getByText('0 of 4 items checked')).toBeTruthy()
      expect(screen.getByText('Asset tag FND-1')).toBeTruthy()
    })

    it('can be cancelled without adding anything', async () => {
      await openAdd()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('heading', { name: 'Add equipment found in this room' })).toBeNull()
      expect(addMock).not.toHaveBeenCalled()
    })

    it('says so when the equipment types cannot be loaded, and offers to try again', async () => {
      vi.mocked(getEquipmentTypes).mockRejectedValueOnce(new ApiRequestError('The server could not be reached. Check your connection and try again.', 0))
      roomMock.mockResolvedValue(roomDetail({ inspection: inProgress }))
      getInspectionMock.mockResolvedValue({ data: inspectionView() })
      renderPage()
      await screen.findByRole('heading', { level: 3, name: /Projector/ })
      fireEvent.click(screen.getByRole('button', { name: 'Add equipment found' }))
      expect(await screen.findByText('Equipment types could not be loaded')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('heading', { name: 'Add equipment found in this room' })).toBeTruthy()
    })
  })
})
