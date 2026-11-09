import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Technician } from '@lc-projecthub/shared'
import { createApp } from '../app.js'
import type { ProjectRepository } from '../domain/projectRepository.js'
import type { TaskRepository } from '../domain/taskRepository.js'
import type { TechnicianRepository } from '../domain/technicianRepository.js'
import {
  InMemoryBlockRepository,
  InMemoryCycleRepository,
  InMemoryEquipmentItemRepository,
  InMemoryEquipmentTypeRepository,
  InMemoryFloorRepository,
  InMemoryInspectionRepository,
  InMemoryRoomRepository,
} from '../repositories/inMemoryAuditRepositories.js'
import { InMemoryTaskRepository } from '../repositories/inMemoryTaskRepository.js'
import { InMemoryTechnicianRepository } from '../repositories/inMemoryTechnicianRepository.js'
import { AuditService } from '../services/auditService.js'
import { InspectionService } from '../services/inspectionService.js'
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
  /** Defaults to an empty inventory. */
  audit?: AuditService
  /** Defaults to an empty inventory. Pass one built over the same repositories as `audit`. */
  inspections?: InspectionService
}

function emptyInspectionService(technicians: TechnicianRepository): InspectionService {
  return new InspectionService(
    new InMemoryBlockRepository([]),
    new InMemoryFloorRepository([]),
    new InMemoryRoomRepository([], []),
    new InMemoryEquipmentTypeRepository([]),
    new InMemoryEquipmentItemRepository([]),
    new InMemoryCycleRepository([]),
    new InMemoryInspectionRepository([]),
    technicians,
  )
}

function emptyAuditService(technicians: TechnicianRepository): AuditService {
  return new AuditService(
    new InMemoryBlockRepository([]),
    new InMemoryFloorRepository([]),
    new InMemoryRoomRepository([], []),
    new InMemoryEquipmentTypeRepository([]),
    new InMemoryEquipmentItemRepository([]),
    new InMemoryCycleRepository([]),
    new InMemoryInspectionRepository([]),
    technicians,
  )
}

/** Starts the real Express app on a free local port, backed by the given repositories. */
export async function startTestServer(
  projects: ProjectRepository,
  { tasks, technicians, audit, inspections }: TestServerOptions = {},
): Promise<RunningApp> {
  const taskRepository = tasks ?? new InMemoryTaskRepository([])
  const technicianRepository: TechnicianRepository =
    technicians && 'list' in technicians ? technicians : new InMemoryTechnicianRepository(technicians ?? [])
  const app = createApp({
    projectService: new ProjectService(projects, taskRepository),
    taskService: new TaskService(taskRepository, technicianRepository, projects),
    technicianService: new TechnicianService(technicianRepository),
    auditService: audit ?? emptyAuditService(technicianRepository),
    inspectionService: inspections ?? emptyInspectionService(technicianRepository),
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
