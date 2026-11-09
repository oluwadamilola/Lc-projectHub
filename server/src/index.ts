import { createApp } from './app.js'
import { buildSeedAudit } from './data/seedAudit.js'
import { buildSeedProjects } from './data/seedProjects.js'
import { buildSeedTasks, seedTechnicians } from './data/seedTasks.js'
import {
  InMemoryBlockRepository,
  InMemoryCycleRepository,
  InMemoryEquipmentItemRepository,
  InMemoryEquipmentTypeRepository,
  InMemoryFloorRepository,
  InMemoryInspectionRepository,
  InMemoryRoomRepository,
} from './repositories/inMemoryAuditRepositories.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { InMemoryTaskRepository } from './repositories/inMemoryTaskRepository.js'
import { InMemoryTechnicianRepository } from './repositories/inMemoryTechnicianRepository.js'
import { AuditService } from './services/auditService.js'
import { InspectionService } from './services/inspectionService.js'
import { ProjectService } from './services/projectService.js'
import { TaskService } from './services/taskService.js'
import { TechnicianService } from './services/technicianService.js'

const port = Number(process.env.PORT ?? 4000)
const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

// Composition root: the only place that chooses concrete repositories.
// SQL Server repositories would be swapped in here.
const projects = new InMemoryProjectRepository(buildSeedProjects())
const tasks = new InMemoryTaskRepository(buildSeedTasks())
const technicians = new InMemoryTechnicianRepository(seedTechnicians)

// The Audit data is rebuilt from the fictional seed every time the server starts, so anything recorded through
// the inspection endpoints (inspections, equipment found) is demonstration data and is lost on restart.
const audit = buildSeedAudit()
const auditBlocks = new InMemoryBlockRepository(audit.blocks)
const auditFloors = new InMemoryFloorRepository(audit.floors)
const auditRooms = new InMemoryRoomRepository(audit.rooms, audit.floors)
const auditTypes = new InMemoryEquipmentTypeRepository(audit.equipmentTypes)
const auditItems = new InMemoryEquipmentItemRepository(audit.items)
const auditCycles = new InMemoryCycleRepository(audit.cycles)
const auditInspections = new InMemoryInspectionRepository(audit.inspections)
// Both services share the same repositories, so what an inspector records is what the pages read.
const auditService = new AuditService(auditBlocks, auditFloors, auditRooms, auditTypes, auditItems, auditCycles, auditInspections, technicians)
// Inspections can only be recorded between a cycle's start and end dates. For demonstrations and automated tests
// outside that window, AUDIT_CLOCK_NOW (an ISO date or date-time) makes the audit clock start at that moment and
// then run at normal speed. Unset, the real clock is used.
const clockStart = process.env.AUDIT_CLOCK_NOW ? new Date(process.env.AUDIT_CLOCK_NOW) : null
if (clockStart && Number.isNaN(clockStart.getTime())) throw new Error(`AUDIT_CLOCK_NOW is not a valid date: ${process.env.AUDIT_CLOCK_NOW}`)
const bootedAt = Date.now()
const auditClock = clockStart ? () => new Date(clockStart.getTime() + (Date.now() - bootedAt)) : undefined
if (clockStart) console.log(`Audit clock set to start at ${clockStart.toISOString()} (AUDIT_CLOCK_NOW).`)
const inspectionService = new InspectionService(auditBlocks, auditFloors, auditRooms, auditTypes, auditItems, auditCycles, auditInspections, technicians, auditClock)

const app = createApp({
  projectService: new ProjectService(projects, tasks),
  taskService: new TaskService(tasks, technicians, projects),
  technicianService: new TechnicianService(technicians),
  auditService,
  inspectionService,
  clientOrigin,
})

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})
