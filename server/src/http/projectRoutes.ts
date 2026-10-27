import { Router } from 'express'
import type { ProjectResponse } from '@lc-projecthub/shared'
import type { ProjectService } from '../services/projectService.js'
import { parseProjectId, parseProjectQuery } from './parseProjectQuery.js'

/** Thin HTTP layer: parse input, call the service, shape the response. */
export function createProjectRouter(service: ProjectService): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const criteria = parseProjectQuery(req.query)
    res.json(await service.list(criteria))
  })

  router.post('/', async (req, res) => {
    const project = await service.create(req.body)
    const body: ProjectResponse = { data: project }
    res.status(201).location(`/api/projects/${project.id}`).json(body)
  })

  router.get('/:id', async (req, res) => {
    const project = await service.getById(parseProjectId(req.params.id))
    const body: ProjectResponse = { data: project }
    res.json(body)
  })

  router.put('/:id', async (req, res) => {
    const project = await service.update(parseProjectId(req.params.id), req.body)
    const body: ProjectResponse = { data: project }
    res.json(body)
  })

  // Deleting a project also deletes its tasks; the answer says how many went with it.
  router.delete('/:id', async (req, res) => {
    res.json(await service.delete(parseProjectId(req.params.id)))
  })

  return router
}
