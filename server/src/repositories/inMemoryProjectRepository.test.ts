import { describe, expect, it } from 'vitest'
import { fixtureProjects } from '../testing/fixtures.js'
import { InMemoryProjectRepository } from './inMemoryProjectRepository.js'

const repo = new InMemoryProjectRepository(fixtureProjects)
const all = { page: 1, pageSize: 50 }

describe('InMemoryProjectRepository', () => {
  it('returns every project ordered by reference, numerically', async () => {
    const { items, total } = await repo.list(all)
    expect(total).toBe(5)
    expect(items.map((p) => p.id)).toEqual(['PRJ-001', 'PRJ-002', 'PRJ-003', 'PRJ-010', 'PRJ-011'])
  })

  it('orders by reference even when seeded out of order', async () => {
    const shuffled = new InMemoryProjectRepository([...fixtureProjects].reverse())
    const { items } = await shuffled.list(all)
    expect(items[0].id).toBe('PRJ-001')
    expect(items[4].id).toBe('PRJ-011')
  })

  it('filters by status', async () => {
    const { items, total } = await repo.list({ ...all, status: 'Delayed' })
    expect(total).toBe(1)
    expect(items[0].name).toBe('Delta Cabling')
  })

  it('searches name, lead, location, department, description and reference without regard to case', async () => {
    const ids = async (search: string) => (await repo.list({ ...all, search })).items.map((p) => p.id)
    expect(await ids('ALPHA')).toEqual(['PRJ-001'])
    expect(await ids('robin park')).toEqual(['PRJ-002', 'PRJ-010'])
    expect(await ids('test workshop')).toEqual(['PRJ-010'])
    expect(await ids('digital learning')).toEqual(['PRJ-003'])
    expect(await ids('loan laptop')).toEqual(['PRJ-002'])
    expect(await ids('prj-011')).toEqual(['PRJ-011'])
  })

  it('combines search and status filters', async () => {
    const { items } = await repo.list({ ...all, search: 'casey', status: 'Planning' })
    expect(items.map((p) => p.id)).toEqual(['PRJ-003'])
  })

  it('returns an empty page with a zero total when nothing matches', async () => {
    expect(await repo.list({ ...all, search: 'no such project' })).toEqual({ items: [], total: 0 })
  })

  it('pages results while reporting the unpaged total', async () => {
    const first = await repo.list({ page: 1, pageSize: 2 })
    const last = await repo.list({ page: 3, pageSize: 2 })
    expect(first.total).toBe(5)
    expect(first.items.map((p) => p.id)).toEqual(['PRJ-001', 'PRJ-002'])
    expect(last.items.map((p) => p.id)).toEqual(['PRJ-011'])
  })

  it('returns an empty page, not an error, beyond the last page', async () => {
    const result = await repo.list({ page: 9, pageSize: 2 })
    expect(result.items).toEqual([])
    expect(result.total).toBe(5)
  })

  it('finds a project by reference, or returns null', async () => {
    expect((await repo.findById('PRJ-002'))?.name).toBe('Bravo Laptops')
    expect(await repo.findById('PRJ-999')).toBeNull()
  })

  it('hands out copies so callers cannot change stored data', async () => {
    const project = await repo.findById('PRJ-001')
    project!.name = 'Changed'
    expect((await repo.findById('PRJ-001'))?.name).toBe('Alpha Network')
  })
})
