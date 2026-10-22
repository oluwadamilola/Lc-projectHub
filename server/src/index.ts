import { createApp } from './app.js'
import { buildSeedProjects } from './data/seedProjects.js'
import { buildSeedTasks, seedTechnicians } from './data/seedTasks.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { InMemoryTaskRepository } from './repositories/inMemoryTaskRepository.js'
import { InMemoryTechnicianRepository } from './repositories/inMemoryTechnicianRepository.js'
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

const app = createApp({
  projectService: new ProjectService(projects),
  taskService: new TaskService(tasks, technicians, projects),
  technicianService: new TechnicianService(technicians),
  clientOrigin,
})

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})
