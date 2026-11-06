import { Router } from 'express'
import type { ApiErrorDetail } from '@lc-projecthub/shared'
import { ValidationError } from '../errors.js'
import type { AuditService } from '../services/auditService.js'
import { parseCycleQuery } from './parseCycleQuery.js'
import { parseReference } from './parseProjectQuery.js'
import { parseRoomQuery } from './parseRoomQuery.js'
import { rejectUnknownParameters } from './queryParsing.js'

/**
 * The Audit module's read-only endpoints, all under /api/audit.
 * Thin HTTP layer, like the project and task routes: parse input, call the service, send what it returns.
 * Endpoints that describe inspection state take an optional `cycle` and default to the open cycle.
 */
export function createAuditRouter(service: AuditService): Router {
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

  router.get('/equipment-types', async (_req, res) => {
    res.json(await service.listEquipmentTypes())
  })

  return router
}
