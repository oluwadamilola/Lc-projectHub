import { Router } from 'express'
import type { TaskResponse, TechnicianListResponse } from '@lc-projecthub/shared'
import type { TaskService } from '../services/taskService.js'
import type { TechnicianService } from '../services/technicianService.js'
import { parseReference } from './parseProjectQuery.js'
import { parseTaskQuery } from './parseTaskQuery.js'

/** Route parameters: `projectId` comes from the parent path this router is mounted on. */
interface ProjectParams {
  projectId: string
}
interface TaskParams extends ProjectParams {
  taskId: string
}

/**
 * Tasks live under their project: /api/projects/:projectId/tasks.
 * Thin HTTP layer, like the project routes: parse input, call the service, shape the response.
 */
export function createTaskRouter(service: TaskService): Router {
  const router = Router({ mergeParams: true })

  router.get<ProjectParams>('/', async (req, res) => {
    const projectId = parseReference(req.params.projectId, 'projectId')
    res.json(await service.list(parseTaskQuery(projectId, req.query)))
  })

  router.post<ProjectParams>('/', async (req, res) => {
    const projectId = parseReference(req.params.projectId, 'projectId')
    const task = await service.create(projectId, req.body)
    const body: TaskResponse = { data: task }
    res.status(201).location(`/api/projects/${projectId}/tasks/${task.id}`).json(body)
  })

  router.get<TaskParams>('/:taskId', async (req, res) => {
    const projectId = parseReference(req.params.projectId, 'projectId')
    const body: TaskResponse = { data: await service.get(projectId, parseReference(req.params.taskId, 'taskId')) }
    res.json(body)
  })

  router.put<TaskParams>('/:taskId', async (req, res) => {
    const projectId = parseReference(req.params.projectId, 'projectId')
    const task = await service.update(projectId, parseReference(req.params.taskId, 'taskId'), req.body)
    const body: TaskResponse = { data: task }
    res.json(body)
  })

  return router
}

export function createTechnicianRouter(service: TechnicianService): Router {
  const router = Router()
  router.get('/', async (_req, res) => {
    const body: TechnicianListResponse = { data: await service.list() }
    res.json(body)
  })
  return router
}
