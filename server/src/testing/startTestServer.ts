import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Technician } from '@lc-projecthub/shared'
import { createApp } from '../app.js'
import type { ProjectRepository } from '../domain/projectRepository.js'
import type { TaskRepository } from '../domain/taskRepository.js'
import type { TechnicianRepository } from '../domain/technicianRepository.js'
import { InMemoryTaskRepository } from '../repositories/inMemoryTaskRepository.js'
import { InMemoryTechnicianRepository } from '../repositories/inMemoryTechnicianRepository.js'
import { ProjectService } from '../services/projectService.js'
import { TaskService } from '../services/taskService.js'
import { TechnicianService } from '../services/technicianService.js'

export interface RunningApp {
  baseUrl: string
  close: () => Promise<void>
}

export interface TestServerOptions {
  /** Defaults to an empty repository. */
  tasks?: TaskRepository
  /** Defaults to an empty list. */
  technicians?: TechnicianRepository | readonly Technician[]
}

/** Starts the real Express app on a free local port, backed by the given repositories. */
export async function startTestServer(
  projects: ProjectRepository,
  { tasks, technicians }: TestServerOptions = {},
): Promise<RunningApp> {
  const taskRepository = tasks ?? new InMemoryTaskRepository([])
  const technicianRepository: TechnicianRepository =
    technicians && 'list' in technicians ? technicians : new InMemoryTechnicianRepository(technicians ?? [])
  const app = createApp({
    projectService: new ProjectService(projects, taskRepository),
    taskService: new TaskService(taskRepository, technicianRepository, projects),
    technicianService: new TechnicianService(technicianRepository),
    clientOrigin: 'http://localhost:5173',
  })
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
