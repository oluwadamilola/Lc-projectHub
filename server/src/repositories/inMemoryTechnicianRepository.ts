import type { Technician } from '@lc-projecthub/shared'
import type { TechnicianRepository } from '../domain/technicianRepository.js'

export class InMemoryTechnicianRepository implements TechnicianRepository {
  private readonly technicians: readonly Technician[]

  constructor(technicians: readonly Technician[]) {
    this.technicians = technicians.map((technician) => ({ ...technician }))
  }

  async list(): Promise<Technician[]> {
    return this.technicians.map((technician) => ({ ...technician }))
  }

  async findById(id: string): Promise<Technician | null> {
    const technician = this.technicians.find((candidate) => candidate.id === id)
    return technician ? { ...technician } : null
  }
}
