import { Router } from 'express'
import type { ApiErrorDetail } from '@lc-projecthub/shared'
import { ValidationError } from '../errors.js'
import type { AuditService } from '../services/auditService.js'
import type { InspectionService } from '../services/inspectionService.js'
import { parseCycleQuery } from './parseCycleQuery.js'
import { parseReference } from './parseProjectQuery.js'
import { parseRoomQuery } from './parseRoomQuery.js'
import { rejectUnknownParameters } from './queryParsing.js'

/**
 * The Audit module's endpoints, all under /api/audit.
 * Thin HTTP layer, like the project and task routes: parse input, call the service, send what it returns.
 * Endpoints that describe inspection state take an optional `cycle` and default to the open cycle.
 * The inventory and progress endpoints only read. Carrying out an inspection (Stage 2a) is under /inspections,
 * apart from starting one, which belongs to the room: POST /rooms/:roomId/inspection.
 */
export function createAuditRouter(service: AuditService, inspections: InspectionService): Router {
  const router = Router()

  router.get('/cycles', async (req, res) => {
    const errors: ApiErrorDetail[] = []
    rejectUnknownParameters(req.query, [], errors)
    if (errors.length > 0) throw new ValidationError(errors)
    res.json(await service.listCycles())
  })

  router.get('/cycles/:cycleId', async (req, res) => {
    res.json(await service.getCycle(parseReference(req.params.cycleId, 'cycleId')))
  })

  router.get('/blocks', async (req, res) => {
    res.json(await service.listBlocks(parseCycleQuery(req.query)))
  })

  router.get('/blocks/:blockId', async (req, res) => {
    const blockId = parseReference(req.params.blockId, 'blockId')
    res.json(await service.getBlock(blockId, parseCycleQuery(req.query)))
  })

  router.get('/blocks/:blockId/floors', async (req, res) => {
    const blockId = parseReference(req.params.blockId, 'blockId')
    res.json(await service.listFloors(blockId, parseCycleQuery(req.query)))
  })

  router.get('/blocks/:blockId/floors/:floorId', async (req, res) => {
    const blockId = parseReference(req.params.blockId, 'blockId')
    const floorId = parseReference(req.params.floorId, 'floorId')
    res.json(await service.getFloor(blockId, floorId, parseCycleQuery(req.query)))
  })

  router.get('/rooms', async (req, res) => {
    res.json(await service.listRooms(parseRoomQuery(req.query)))
  })

  router.get('/rooms/:roomId', async (req, res) => {
    const roomId = parseReference(req.params.roomId, 'roomId')
    res.json(await service.getRoom(roomId, parseCycleQuery(req.query)))
  })

  /* ---- Carrying out an inspection ---- */

  // Starts the inspection, or returns the one already in progress (200); 201 only when a new record was made.
  router.post('/rooms/:roomId/inspection', async (req, res) => {
    const roomId = parseReference(req.params.roomId, 'roomId')
    const { data, created } = await inspections.start(roomId, req.body)
    res.status(created ? 201 : 200).location(`/api/audit/inspections/${data.id}`).json({ data })
  })

  router.get('/inspections/:inspectionId', async (req, res) => {
    const errors: ApiErrorDetail[] = []
    rejectUnknownParameters(req.query, [], errors)
    if (errors.length > 0) throw new ValidationError(errors)
    res.json(await inspections.get(parseReference(req.params.inspectionId, 'inspectionId')))
  })

  router.put('/inspections/:inspectionId/results/:itemId', async (req, res) => {
    const inspectionId = parseReference(req.params.inspectionId, 'inspectionId')
    const itemId = parseReference(req.params.itemId, 'itemId')
    res.json(await inspections.saveResult(inspectionId, itemId, req.body))
  })

  router.post('/inspections/:inspectionId/equipment', async (req, res) => {
    const body = await inspections.addEquipment(parseReference(req.params.inspectionId, 'inspectionId'), req.body)
    res.status(201).location(`/api/audit/inspections/${body.data.id}`).json(body)
  })

  router.put('/inspections/:inspectionId/no-equipment', async (req, res) => {
    res.json(await inspections.setNoEquipment(parseReference(req.params.inspectionId, 'inspectionId'), req.body))
  })

  router.post('/inspections/:inspectionId/unable', async (req, res) => {
    res.json(await inspections.markUnable(parseReference(req.params.inspectionId, 'inspectionId'), req.body))
  })

  router.post('/inspections/:inspectionId/complete', async (req, res) => {
    res.json(await inspections.complete(parseReference(req.params.inspectionId, 'inspectionId')))
  })

  router.get('/equipment-types', async (_req, res) => {
    res.json(await service.listEquipmentTypes())
  })

  return router
}
