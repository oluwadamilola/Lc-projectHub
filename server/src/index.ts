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

const audit = buildSeedAudit()
const auditService = new AuditService(
  new InMemoryBlockRepository(audit.blocks),
  new InMemoryFloorRepository(audit.floors),
  new InMemoryRoomRepository(audit.rooms, audit.floors),
  new InMemoryEquipmentTypeRepository(audit.equipmentTypes),
  new InMemoryEquipmentItemRepository(audit.items),
  new InMemoryCycleRepository(audit.cycles),
  new InMemoryInspectionRepository(audit.inspections),
  technicians,
)

const app = createApp({
  projectService: new ProjectService(projects, tasks),
  taskService: new TaskService(tasks, technicians, projects),
  technicianService: new TechnicianService(technicians),
  auditService,
  clientOrigin,
})

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})
