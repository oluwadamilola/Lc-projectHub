import { Router } from 'express'
import type { ProjectResponse } from '@lc-projecthub/shared'
import type { ProjectService } from '../services/projectService.js'
import { parseProjectId, parseProjectQuery } from './parseProjectQuery.js'

/** Thin HTTP layer: parse and validate input, call the service, shape the response. */
export function createProjectRouter(service: ProjectService): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const criteria = parseProjectQuery(req.query)
    res.json(await service.list(criteria))
  })

  router.get('/:id', async (req, res) => {
    const project = await service.getById(parseProjectId(req.params.id))
    const body: ProjectResponse = { data: project }
    res.json(body)
  })

  return router
}
