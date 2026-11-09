import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addInspectionEquipment,
  completeInspection,
  getEquipmentTypes,
  getInspection,
  markInspectionUnable,
  saveInspectionResult,
  setInspectionNoEquipment,
  startInspection,
} from './audit'
import { ApiRequestError } from './http'

/*
  The write calls only send what the screens give them to the right address with the right method; every rule is the
  server's. These tests pin the addresses, methods and bodies so a screen can never quietly talk to the wrong place.
*/

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'INS-001' } }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body as string) }
}

describe('Audit write calls', () => {
  it('starts an inspection with POST to the room, sending the technician and cycle', async () => {
    await startInspection('ROOM-001', { inspectorId: 'TECH-001', cycleId: 'CYC-003' })
    expect(lastCall()).toEqual({ url: '/api/audit/rooms/ROOM-001/inspection', method: 'POST', body: { inspectorId: 'TECH-001', cycleId: 'CYC-003' } })
  })

  it('reads an inspection and the equipment types with GET', async () => {
    await getInspection('INS-001')
    expect(lastCall()).toMatchObject({ url: '/api/audit/inspections/INS-001', method: 'GET' })
    await getEquipmentTypes()
    expect(lastCall()).toMatchObject({ url: '/api/audit/equipment-types', method: 'GET' })
  })

  it('saves one line with PUT to its item', async () => {
    await saveInspectionResult('INS-001', 'EQP-002', { condition: 'Not working', note: 'Lamp', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }] })
    expect(lastCall()).toEqual({
      url: '/api/audit/inspections/INS-001/results/EQP-002',
      method: 'PUT',
      body: { condition: 'Not working', note: 'Lamp', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }] },
    })
  })

  it('adds equipment with POST, confirms or withdraws "no equipment" with PUT, records unable with POST, completes with POST', async () => {
    await addInspectionEquipment('INS-001', { equipmentTypeId: 'projector', assetTag: 'AT-1' })
    expect(lastCall()).toEqual({ url: '/api/audit/inspections/INS-001/equipment', method: 'POST', body: { equipmentTypeId: 'projector', assetTag: 'AT-1' } })
    await setInspectionNoEquipment('INS-001', true)
    expect(lastCall()).toEqual({ url: '/api/audit/inspections/INS-001/no-equipment', method: 'PUT', body: { confirmed: true } })
    await setInspectionNoEquipment('INS-001', false)
    expect(lastCall().body).toEqual({ confirmed: false })
    await markInspectionUnable('INS-001', { reason: 'Room locked', inspectorId: 'TECH-002' })
    expect(lastCall()).toEqual({ url: '/api/audit/inspections/INS-001/unable', method: 'POST', body: { reason: 'Room locked', inspectorId: 'TECH-002' } })
    await completeInspection('INS-001')
    expect(lastCall()).toMatchObject({ url: '/api/audit/inspections/INS-001/complete', method: 'POST' })
  })

  it('encodes references so they cannot change the address', async () => {
    await getInspection('INS/../x')
    expect(lastCall().url).toBe('/api/audit/inspections/INS%2F..%2Fx')
  })

  it('turns an error body into an ApiRequestError with its status, code and field details', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Fix these', details: [{ field: 'assetTag', message: 'Bad tag' }] } }), { status: 400 }),
    )
    const error = await addInspectionEquipment('INS-001', { equipmentTypeId: 'x' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: [{ field: 'assetTag', message: 'Bad tag' }] })
  })

  it('reports a failure to reach the server as status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await completeInspection('INS-001').catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 0 })
  })
})
