import type { Technician } from '@lc-projecthub/shared'

/** Read-only access to the people tasks can be assigned to. */
export interface TechnicianRepository {
  list(): Promise<Technician[]>
  findById(id: string): Promise<Technician | null>
}
