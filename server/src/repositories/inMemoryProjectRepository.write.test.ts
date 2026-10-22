import type { ProjectInput } from '@lc-projecthub/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { fixtureProjects } from '../testing/fixtures.js'
import { InMemoryProjectRepository } from './inMemoryProjectRepository.js'

const input: ProjectInput = {
  name: 'Foxtrot Wi-Fi',
  description: 'Add access points to the annexe.',
  location: 'Test Annexe',
  department: 'Infrastructure',
  lead: 'Jamie Cole',
  priority: 'Medium',
  status: 'Planning',
  progress: 0,
  startDate: '2026-05-01',
  dueDate: '2026-08-01',
}

let repo: InMemoryProjectRepository
beforeEach(() => {
  repo = new InMemoryProjectRepository(fixtureProjects)
})

describe('InMemoryProjectRepository.create', () => {
  it('assigns the next reference after the highest existing one', async () => {
    // Fixtures run PRJ-001..003, PRJ-010, PRJ-011.
    const created = await repo.create(input)
    expect(created).toEqual({ ...input, id: 'PRJ-012' })
  })

  it('starts at PRJ-001 for an empty repository', async () => {
    expect((await new InMemoryProjectRepository([]).create(input)).id).toBe('PRJ-001')
  })

  it('assigns a unique reference every time, including simultaneous calls', async () => {
    const created = await Promise.all(Array.from({ length: 50 }, () => repo.create(input)))
    const ids = created.map((project) => project.id)
    expect(new Set(ids).size).toBe(50)
    expect(ids[0]).toBe('PRJ-012')
    expect(ids[49]).toBe('PRJ-061')
    expect((await repo.list({ page: 1, pageSize: 100 })).total).toBe(55)
  })

  it('never reuses a reference', async () => {
    const first = await repo.create(input)
    const second = await repo.create(input)
    expect(second.id).not.toBe(first.id)
  })

  it('keeps references unique past three digits', async () => {
    const big = new InMemoryProjectRepository([{ ...fixtureProjects[0], id: 'PRJ-999' }])
    expect((await big.create(input)).id).toBe('PRJ-1000')
    expect((await big.create(input)).id).toBe('PRJ-1001')
    const order = (await big.list({ page: 1, pageSize: 10 })).items.map((p) => p.id)
    expect(order).toEqual(['PRJ-999', 'PRJ-1000', 'PRJ-1001'])
  })

  it('makes the new project findable and listed in order', async () => {
    const created = await repo.create(input)
    expect(await repo.findById(created.id)).toEqual(created)
    const ids = (await repo.list({ page: 1, pageSize: 50 })).items.map((p) => p.id)
    expect(ids.at(-1)).toBe('PRJ-012')
    expect(await repo.list({ page: 1, pageSize: 50, search: 'foxtrot' })).toMatchObject({ total: 1 })
  })

  it('does not keep a reference to the caller’s object or hand out its own', async () => {
    const mutable = { ...input }
    const created = await repo.create(mutable)
    mutable.name = 'Changed after create'
    created.name = 'Changed result'
    expect((await repo.findById(created.id))?.name).toBe('Foxtrot Wi-Fi')
  })

  it('ignores an id smuggled into the input', async () => {
    const created = await repo.create({ ...input, id: 'PRJ-001' } as ProjectInput)
    expect(created.id).toBe('PRJ-012')
    expect((await repo.findById('PRJ-001'))?.name).toBe('Alpha Network')
  })
})

describe('InMemoryProjectRepository.update', () => {
  it('replaces every editable field and keeps the reference', async () => {
    const updated = await repo.update('PRJ-002', input)
    expect(updated).toEqual({ ...input, id: 'PRJ-002' })
    expect(await repo.findById('PRJ-002')).toEqual({ ...input, id: 'PRJ-002' })
  })

  it('leaves every other project untouched', async () => {
    await repo.update('PRJ-002', input)
    for (const original of fixtureProjects.filter((p) => p.id !== 'PRJ-002')) {
      expect(await repo.findById(original.id)).toEqual(original)
    }
    expect((await repo.list({ page: 1, pageSize: 50 })).total).toBe(5)
  })

  it('returns null for a missing project and changes nothing', async () => {
    expect(await repo.update('PRJ-999', input)).toBeNull()
    expect((await repo.list({ page: 1, pageSize: 50 })).total).toBe(5)
  })

  it('cannot change the reference through the input', async () => {
    const updated = await repo.update('PRJ-002', { ...input, id: 'PRJ-001' } as ProjectInput)
    expect(updated?.id).toBe('PRJ-002')
    expect((await repo.findById('PRJ-001'))?.name).toBe('Alpha Network')
  })

  it('is reflected in filters and search', async () => {
    await repo.update('PRJ-002', { ...input, status: 'Complete', progress: 100 })
    expect((await repo.list({ page: 1, pageSize: 50, status: 'Complete' })).total).toBe(2)
    expect((await repo.list({ page: 1, pageSize: 50, search: 'bravo' })).total).toBe(0)
    expect((await repo.list({ page: 1, pageSize: 50, search: 'foxtrot' })).total).toBe(1)
  })

  it('returns copies', async () => {
    const updated = await repo.update('PRJ-002', input)
    updated!.name = 'Changed result'
    expect((await repo.findById('PRJ-002'))?.name).toBe('Foxtrot Wi-Fi')
  })

  it('does not change the objects it was constructed with', async () => {
    await repo.update('PRJ-002', input)
    expect(fixtureProjects[1].name).toBe('Bravo Laptops')
  })
})
