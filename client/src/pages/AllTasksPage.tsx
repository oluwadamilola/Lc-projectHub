import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  TASK_DUE_FILTERS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TECHNICIAN_ID_PATTERN,
  UNASSIGNED_FILTER,
  isTaskOverdue,
  toIsoDate,
  type AllTasksParams,
  type AllTasksResponse,
  type TaskDueFilter,
  type TaskPriority,
  type TaskStatus,
} from '@lc-projecthub/shared'
import { getProjects } from '../api/projects'
import { searchTasks } from '../api/taskSearch'
import { getTechnicians } from '../api/tasks'
import { Pagination } from '../components/Pagination'
import { EmptyState, ErrorState, LoadingState } from '../components/StateMessage'
import { PriorityBadge, TaskStatusBadge } from '../components/StatusBadge'
import { useApiResource } from '../hooks/useApiResource'
import { formatDate } from '../lib/format'

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 300
const DUE_LABELS: Record<TaskDueFilter, string> = { overdue: 'Overdue', 'this-week': 'Due this week' }
const PROJECT_REFERENCE = /^[A-Za-z0-9-]{1,32}$/

/* Values read from the address bar are never trusted: anything that is not a known choice is ignored. */
const readChoice = <T extends string>(options: readonly T[], value: string | null): T | undefined =>
  options.find((option) => option === value)
const readPage = (value: string | null): number => {
  const page = Number(value)
  return Number.isInteger(page) && page >= 1 ? page : 1
}
const readProject = (value: string | null) => (value && PROJECT_REFERENCE.test(value) ? value : undefined)
const readAssignee = (value: string | null) =>
  value === UNASSIGNED_FILTER || (value && TECHNICIAN_ID_PATTERN.test(value)) ? (value ?? undefined) : undefined

/** One answer from the server, stamped with the calendar day it was measured against. */
interface LoadedTasks {
  response: AllTasksResponse
  /** "Overdue" is judged from this day, the same day the server used for its counts. */
  today: string
}

async function loadTasks(params: AllTasksParams, signal: AbortSignal): Promise<LoadedTasks> {
  const today = toIsoDate(new Date())
  return { response: await searchTasks({ ...params, today }, signal), today }
}

/** Every task of every project, with search, filters and paging. The filters live in the address so a view can be shared. */
export function AllTasksPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const q = (searchParams.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH)
  const project = readProject(searchParams.get('project'))
  const status = readChoice<TaskStatus>(TASK_STATUSES, searchParams.get('status'))
  const priority = readChoice<TaskPriority>(TASK_PRIORITIES, searchParams.get('priority'))
  const assignee = readAssignee(searchParams.get('assignee'))
  const due = readChoice<TaskDueFilter>(TASK_DUE_FILTERS, searchParams.get('due'))
  const page = readPage(searchParams.get('page'))

  const [searchText, setSearchText] = useState(q)

  const updateParams = useCallback(
    (changes: Record<string, string | number | undefined>) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined || value === '' || (key === 'page' && value === 1)) next.delete(key)
            else next.set(key, String(value))
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  // Wait for a pause in typing before searching, and go back to page 1 for a new search.
  useEffect(() => {
    const trimmed = searchText.trim()
    if (trimmed === q) return
    const timer = window.setTimeout(() => updateParams({ q: trimmed, page: 1 }), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchText, q, updateParams])

  // These only fill the drop-downs; if they fail the table still works and the chosen value is still shown.
  const projects = useApiResource((signal) => getProjects({ pageSize: MAX_PAGE_SIZE }, signal), [])
  const technicians = useApiResource((signal) => getTechnicians(signal), [])

  const result = useApiResource(
    (signal) => loadTasks({ q: q || undefined, project, status, priority, assignee, due, page, pageSize: PAGE_SIZE }, signal),
    [q, project, status, priority, assignee, due, page],
  )

  const filtered = q !== '' || project !== undefined || status !== undefined || priority !== undefined || assignee !== undefined || due !== undefined || page !== 1
  function clearFilters() {
    setSearchText('')
    setSearchParams({}, { replace: true })
  }

  const loaded = result.data
  const data = loaded?.response
  const showLoading = result.status === 'loading' && !data
  // On any failure show only the error: rows left over from a previous query would not match the filters now chosen.
  const showError = result.status === 'error'
  const projectList = projects.data?.data ?? []
  const projectKnown = project === undefined || projectList.some((entry) => entry.id === project)

  return (
    <>
      <div className="page-header">
        <div>
          <h1>All tasks</h1>
          <p>Find and filter tasks across every project.</p>
        </div>
        <div className="page-header__actions">
          <span className="demo-note">Demonstration data</span>
        </div>
      </div>

      <section className="card" aria-label="Task list">
        <form className="toolbar toolbar--all-tasks" role="search" aria-label="Filter tasks" onSubmit={(event) => event.preventDefault()}>
          <div className="field field--wide">
            <label className="field__label" htmlFor="all-tasks-search">
              Search tasks
            </label>
            <input
              id="all-tasks-search"
              className="input"
              type="search"
              placeholder="Title, reference or keyword"
              maxLength={MAX_SEARCH_LENGTH}
              value={searchText}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="all-tasks-project">
              Project
            </label>
            <select
              id="all-tasks-project"
              className="input"
              value={project ?? ''}
              onChange={(event) => updateParams({ project: event.target.value, page: 1 })}
            >
              <option value="">All projects</option>
              {projectList.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.id})
                </option>
              ))}
              {!projectKnown && project && <option value={project}>{project}</option>}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="all-tasks-status">
              Status
            </label>
            <select
              id="all-tasks-status"
              className="input"
              value={status ?? ''}
              onChange={(event) => updateParams({ status: event.target.value, page: 1 })}
            >
              <option value="">All statuses</option>
              {TASK_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="all-tasks-priority">
              Priority
            </label>
            <select
              id="all-tasks-priority"
              className="input"
              value={priority ?? ''}
              onChange={(event) => updateParams({ priority: event.target.value, page: 1 })}
            >
              <option value="">All priorities</option>
              {TASK_PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="all-tasks-assignee">
              Technician
            </label>
            <select
              id="all-tasks-assignee"
              className="input"
              value={assignee ?? ''}
              onChange={(event) => updateParams({ assignee: event.target.value, page: 1 })}
            >
              <option value="">Everyone</option>
              <option value={UNASSIGNED_FILTER}>Unassigned</option>
              {technicians.data?.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
              {assignee && assignee !== UNASSIGNED_FILTER && !technicians.data?.some((technician) => technician.id === assignee) && (
                <option value={assignee}>{assignee}</option>
              )}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="all-tasks-due">
              Due date
            </label>
            <select
              id="all-tasks-due"
              className="input"
              value={due ?? ''}
              onChange={(event) => updateParams({ due: event.target.value, page: 1 })}
            >
              <option value="">Any due date</option>
              {TASK_DUE_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {DUE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" onClick={clearFilters} disabled={!filtered && searchText === ''}>
            Clear filters
          </button>
        </form>

        {showLoading && <LoadingState label="Loading tasks…" />}

        {showError && <ErrorState title="Tasks could not be loaded" message={result.error.message} onRetry={result.reload} />}

        {data && loaded && !showError && (
          <div className="results" aria-busy={result.status === 'loading'}>
            {data.data.length === 0 ? (
              <EmptyState title={filtered ? 'No tasks match your filters' : 'There are no tasks yet'}>
                {filtered ? (
                  <>
                    <p>Try a different search or filter.</p>
                    <button type="button" className="btn" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </>
                ) : (
                  <p>Tasks are added from inside a project.</p>
                )}
              </EmptyState>
            ) : (
              <>
                <p className="results-summary" role="status">
                  Showing {(data.meta.page - 1) * data.meta.pageSize + 1}–
                  {(data.meta.page - 1) * data.meta.pageSize + data.data.length} of {data.meta.total} tasks
                </p>
                <p className="results-counts">
                  Of these tasks:{' '}
                  <strong>{data.summary.outstanding} outstanding</strong> ·{' '}
                  <strong>{data.summary.overdue} overdue</strong>
                </p>
                <div className="table-scroll" tabIndex={0} role="region" aria-label="Tasks table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Task</th>
                        <th scope="col">Project</th>
                        <th scope="col">Status</th>
                        <th scope="col">Priority</th>
                        <th scope="col">Technician</th>
                        <th scope="col">Due</th>
                        <th scope="col">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((task) => (
                        <tr key={task.id}>
                          <th scope="row" className="data-table__primary data-table__wrap">
                            {task.title}
                            <span className="data-table__sub">{task.id}</span>
                          </th>
                          <td className="data-table__wrap">
                            <Link className="table-link" to={`/projects/${encodeURIComponent(task.projectId)}`}>
                              {task.projectName}
                            </Link>
                            <span className="data-table__sub">{task.projectId}</span>
                          </td>
                          <td className="nowrap">
                            <TaskStatusBadge status={task.status} />
                          </td>
                          <td className="nowrap">
                            <PriorityBadge priority={task.priority} />
                          </td>
                          <td className="nowrap">{task.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                          <td className="nowrap">
                            {formatDate(task.dueDate)}
                            {isTaskOverdue(task, loaded.today) && <span className="badge badge--danger badge--inline">Overdue</span>}
                          </td>
                          <td className="nowrap">
                            <Link
                              className="table-link"
                              to={`/projects/${encodeURIComponent(task.projectId)}/tasks/${encodeURIComponent(task.id)}/edit`}
                            >
                              Edit{' '}
                              <span className="visually-hidden">
                                task {task.id}: {task.title}
                              </span>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPageChange={(next) => updateParams({ page: next })} />
          </div>
        )}
      </section>
    </>
  )
}
