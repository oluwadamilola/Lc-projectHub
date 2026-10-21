import { createApp } from './app.js'
import { buildSeedProjects } from './data/seedProjects.js'
import { InMemoryProjectRepository } from './repositories/inMemoryProjectRepository.js'
import { ProjectService } from './services/projectService.js'

const port = Number(process.env.PORT ?? 4000)
const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

// Composition root: the only place that chooses a concrete repository.
// A SQL Server repository would be swapped in here.
const repository = new InMemoryProjectRepository(buildSeedProjects())
const app = createApp({ projectService: new ProjectService(repository), clientOrigin })

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})
