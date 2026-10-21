import { PROJECT_PRIORITIES, PROJECT_STATUSES } from '@lc-projecthub/shared'
import { describe, expect, it } from 'vitest'
import { buildSeedProjects } from './seedProjects.js'

describe('demo seed data', () => {
  const projects = buildSeedProjects(new Date('2026-06-01T12:00:00Z'))

  it('has unique references', () => {
    expect(new Set(projects.map((p) => p.id)).size).toBe(projects.length)
  })

  it('uses only valid statuses, priorities and progress values', () => {
    for (const p of projects) {
      expect(PROJECT_STATUSES).toContain(p.status)
      expect(PROJECT_PRIORITIES).toContain(p.priority)
      expect(p.progress).toBeGreaterThanOrEqual(0)
      expect(p.progress).toBeLessThanOrEqual(100)
    }
  })

  it('is internally consistent', () => {
    for (const p of projects) {
      if (p.status === 'Complete') expect(p.progress).toBe(100)
      expect(p.startDate <= p.dueDate).toBe(true)
    }
  })

  it('generates dates relative to the supplied day', () => {
    expect(projects.find((p) => p.id === 'PRJ-101')?.dueDate).toBe('2026-06-22')
  })

  it('covers every status so the demo exercises each UI state', () => {
    for (const status of PROJECT_STATUSES) expect(projects.some((p) => p.status === status)).toBe(true)
  })
})
