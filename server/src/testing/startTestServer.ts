import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app.js'
import type { ProjectRepository } from '../domain/projectRepository.js'
import { ProjectService } from '../services/projectService.js'

export interface RunningApp {
  baseUrl: string
  close: () => Promise<void>
}

/** Starts the real Express app on a free local port, backed by the given repository. */
export async function startTestServer(repository: ProjectRepository): Promise<RunningApp> {
  const app = createApp({ projectService: new ProjectService(repository), clientOrigin: 'http://localhost:5173' })
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
