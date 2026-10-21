import type { Technician } from '@lc-projecthub/shared'
import type { TechnicianRepository } from '../domain/technicianRepository.js'

export class TechnicianService {
  private readonly repository: TechnicianRepository

  constructor(repository: TechnicianRepository) {
    this.repository = repository
  }

  list(): Promise<Technician[]> {
    return this.repository.list()
  }
}
