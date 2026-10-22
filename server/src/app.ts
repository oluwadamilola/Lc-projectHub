import cors from 'cors'
import express, { type ErrorRequestHandler, type Express } from 'express'
import type { ApiErrorResponse } from '@lc-projecthub/shared'
import { AppError } from './errors.js'
import { createProjectRouter } from './http/projectRoutes.js'
import { createTaskRouter, createTechnicianRouter } from './http/taskRoutes.js'
import type { ProjectService } from './services/projectService.js'
import type { TaskService } from './services/taskService.js'
import type { TechnicianService } from './services/technicianService.js'

export interface AppDependencies {
  projectService: ProjectService
  taskService: TaskService
  technicianService: TechnicianService
  clientOrigin: string
}

function errorBody(code: ApiErrorResponse['error']['code'], message: string): ApiErrorResponse {
  return { error: { code, message } }
}

const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const body: ApiErrorResponse = { error: { code: err.code, message: err.message, details: err.details } }
    res.status(err.status).json(body)
    return
  }
  // Malformed JSON and similar client mistakes raised by Express middleware.
  const status = (err as { status?: unknown }).status
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(400).json(errorBody('VALIDATION_ERROR', 'The request could not be understood.'))
    return
  }
  // Log the real cause on the server; never send internals to the client.
  console.error('Unhandled error:', err)
  res.status(500).json(errorBody('INTERNAL_ERROR', 'Something went wrong on the server.'))
}

/** Builds the Express app from its dependencies so tests can run it without a real database or port. */
export function createApp({ projectService, taskService, technicianService, clientOrigin }: AppDependencies): Express {
  const app = express()
  app.disable('x-powered-by')

  app.use(cors({ origin: clientOrigin }))
  app.use(express.json())

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'lc-projecthub-server' })
  })

  // Tasks live under their project; this router is mounted first so /:projectId/tasks never reaches /:id.
  app.use('/api/projects/:projectId/tasks', createTaskRouter(taskService))
  app.use('/api/projects', createProjectRouter(projectService))
  app.use('/api/technicians', createTechnicianRouter(technicianService))

  app.use('/api', (_req, res) => {
    res.status(404).json(errorBody('NOT_FOUND', 'No such API endpoint.'))
  })

  app.use(handleError)
  return app
}
