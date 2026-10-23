import type { Task, TaskListResponse } from '@lc-projecthub/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAllTasks } from './allTasks'
import { ApiRequestError } from './http'
import { getTasks } from './tasks'
import { taskA } from '../test/fixtures'

vi.mock('./tasks', () => ({ getTasks: vi.fn() }))
const getTasksMock = vi.mocked(getTasks)

const make = (projectId: string, n: number): Task => ({ ...taskA, id: `TASK-${projectId}-${n}`, projectId })
const page = (data: Task[], pageNumber: number, totalPages: number): TaskListResponse => ({
  data,
  meta: { page: pageNumber, pageSize: 100, total: data.length, totalPages },
})

beforeEach(() => {
  getTasksMock.mockReset()
})

describe('getAllTasks', () => {
  it('returns an empty list, with no requests, when there are no projects', async () => {
    expect(await getAllTasks([])).toEqual([])
    expect(getTasksMock).not.toHaveBeenCalled()
  })

  it('asks for each project once, using the largest page size, and combines the tasks in project order', async () => {
    getTasksMock.mockImplementation(async (projectId) => page([make(projectId, 1), make(projectId, 2)], 1, 1))
    const tasks = await getAllTasks(['PRJ-1', 'PRJ-2', 'PRJ-3'])
    expect(tasks.map((t) => t.id)).toEqual([
      'TASK-PRJ-1-1', 'TASK-PRJ-1-2', 'TASK-PRJ-2-1', 'TASK-PRJ-2-2', 'TASK-PRJ-3-1', 'TASK-PRJ-3-2',
    ])
    expect(getTasksMock).toHaveBeenCalledTimes(3)
    expect(getTasksMock).toHaveBeenCalledWith('PRJ-2', { page: 1, pageSize: 100 }, expect.any(AbortSignal))
  })

  it('keeps project order even when responses arrive out of order', async () => {
    getTasksMock.mockImplementation(async (projectId) => {
      await new Promise((resolve) => setTimeout(resolve, projectId === 'PRJ-1' ? 30 : 1))
      return page([make(projectId, 1)], 1, 1)
    })
    expect((await getAllTasks(['PRJ-1', 'PRJ-2', 'PRJ-3'])).map((t) => t.projectId)).toEqual(['PRJ-1', 'PRJ-2', 'PRJ-3'])
  })

  it('follows paging until a project’s tasks are all loaded', async () => {
    getTasksMock.mockImplementation(async (_projectId, params) => page([make('PRJ-1', params?.page ?? 0)], params?.page ?? 1, 3))
    const tasks = await getAllTasks(['PRJ-1'])
    expect(tasks.map((t) => t.id)).toEqual(['TASK-PRJ-1-1', 'TASK-PRJ-1-2', 'TASK-PRJ-1-3'])
    expect(getTasksMock.mock.calls.map((call) => call[1]?.page)).toEqual([1, 2, 3])
  })

  it('handles projects with no tasks', async () => {
    getTasksMock.mockImplementation(async () => page([], 1, 0))
    expect(await getAllTasks(['PRJ-1', 'PRJ-2'])).toEqual([])
    expect(getTasksMock).toHaveBeenCalledTimes(2)
  })

  it('never has more than five projects in flight at once', async () => {
    let inFlight = 0
    let highest = 0
    getTasksMock.mockImplementation(async (projectId) => {
      inFlight += 1
      highest = Math.max(highest, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return page([make(projectId, 1)], 1, 1)
    })
    const ids = Array.from({ length: 23 }, (_, i) => `PRJ-${i}`)
    expect(await getAllTasks(ids)).toHaveLength(23)
    expect(highest).toBeLessThanOrEqual(5)
    expect(highest).toBeGreaterThan(1)
  })

  it('fails as a whole when any project fails, rather than returning a partial list', async () => {
    getTasksMock.mockImplementation(async (projectId) => {
      if (projectId === 'PRJ-2') throw new ApiRequestError('The server could not be reached.', 0)
      return page([make(projectId, 1)], 1, 1)
    })
    await expect(getAllTasks(['PRJ-1', 'PRJ-2', 'PRJ-3'])).rejects.toMatchObject({ status: 0, message: 'The server could not be reached.' })
  })

  it('stops asking for further projects after a failure', async () => {
    getTasksMock.mockImplementation(async (projectId) => {
      if (projectId === 'PRJ-0') throw new ApiRequestError('boom', 500)
      await new Promise((resolve) => setTimeout(resolve, 20))
      return page([make(projectId, 1)], 1, 1)
    })
    const ids = Array.from({ length: 40 }, (_, i) => `PRJ-${i}`)
    await expect(getAllTasks(ids)).rejects.toBeInstanceOf(ApiRequestError)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(getTasksMock.mock.calls.length).toBeLessThan(40)
  })

  it('rejects when the caller cancels, and does not keep requesting', async () => {
    const controller = new AbortController()
    getTasksMock.mockImplementation(async (projectId) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return page([make(projectId, 1)], 1, 1)
    })
    const ids = Array.from({ length: 30 }, (_, i) => `PRJ-${i}`)
    const pending = getAllTasks(ids, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const callsAtAbort = getTasksMock.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(getTasksMock.mock.calls.length).toBe(callsAtAbort)
  })

  it('fails instead of silently undercounting when a project has an unreasonable number of pages', async () => {
    getTasksMock.mockImplementation(async (projectId, params) => page([make(projectId, params?.page ?? 0)], params?.page ?? 1, 999_999))
    await expect(getAllTasks(['PRJ-1'])).rejects.toMatchObject({ message: 'Project PRJ-1 has too many tasks to total.' })
    expect(getTasksMock).toHaveBeenCalledTimes(50)
  })
})
