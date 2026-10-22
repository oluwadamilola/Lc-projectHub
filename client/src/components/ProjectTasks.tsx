import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TASK_STATUSES, UNASSIGNED_FILTER, MAX_SEARCH_LENGTH, type TaskStatus } from '@lc-projecthub/shared'
import { getTasks, getTechnicians } from '../api/tasks'
import { useApiResource } from '../hooks/useApiResource'
import { formatDate, isOverdue } from '../lib/format'
import { Pagination } from './Pagination'
import { EmptyState, ErrorState, LoadingState } from './StateMessage'
import { PriorityBadge, TaskStatusBadge } from './StatusBadge'

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 300

/** The tasks of one project: search, filters, paging, and links to add and edit. Loads independently of the project itself. */
export function ProjectTasks({ projectId }: { projectId: string }) {
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<TaskStatus | ''>('')
  const [assignee, setAssignee] = useState('')
  const [page, setPage] = useState(1)

  // Wait for a pause in typing before searching, and go back to page 1 for a new search.
  useEffect(() => {
    const trimmed = searchText.trim()
    if (trimmed === search) return
    const timer = window.setTimeout(() => {
      setSearch(trimmed)
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchText, search])

  const technicians = useApiResource((signal) => getTechnicians(signal), [])
  const result = useApiResource(
    (signal) =>
      getTasks(
        projectId,
        { q: search || undefined, status: status || undefined, assignee: assignee || undefined, page, pageSize: PAGE_SIZE },
        signal,
      ),
    [projectId, search, status, assignee, page],
  )

  const filtered = search !== '' || status !== '' || assignee !== ''
  function clearFilters() {
    setSearchText('')
    setSearch('')
    setStatus('')
    setAssignee('')
    setPage(1)
  }

  const data = result.data
  const showError = result.status === 'error'
  const showLoading = result.status === 'loading' && !data
  const addTaskPath = `/projects/${encodeURIComponent(projectId)}/tasks/new`

  return (
    <section className="card" aria-labelledby="tasks-heading" id="tasks">
      <div className="card__header card__header--split">
        <h2 id="tasks-heading">
          Tasks
          {data && data.meta.total > 0 && !filtered ? (
            <>
              {' '}
              <span className="count">({data.meta.total})</span>
            </>
          ) : null}
        </h2>
        <Link className="btn btn--primary" to={addTaskPath}>
          Add task
        </Link>
      </div>

      <form className="toolbar toolbar--tasks" role="search" aria-label="Filter tasks" onSubmit={(event) => event.preventDefault()}>
        <div className="field">
          <label className="field__label" htmlFor="task-search">
            Search tasks
          </label>
          <input
            id="task-search"
            className="input"
            type="search"
            placeholder="Title, reference or keyword"
            maxLength={MAX_SEARCH_LENGTH}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="task-status">
            Status
          </label>
          <select
            id="task-status"
            className="input"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as TaskStatus | '')
              setPage(1)
            }}
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
          <label className="field__label" htmlFor="task-assignee">
            Technician
          </label>
          <select
            id="task-assignee"
            className="input"
            value={assignee}
            onChange={(event) => {
              setAssignee(event.target.value)
              setPage(1)
            }}
          >
            <option value="">Everyone</option>
            <option value={UNASSIGNED_FILTER}>Unassigned</option>
            {technicians.data?.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.name}
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

      {data && !showError && (
        <div className="results" aria-busy={result.status === 'loading'}>
          {data.data.length === 0 ? (
            <EmptyState title={filtered ? 'No tasks match your filters' : 'No tasks yet'}>
              {filtered ? (
                <>
                  <p>Try a different search, status or technician.</p>
                  <button type="button" className="btn" onClick={clearFilters}>
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <p>Break this project down into tasks and assign them to technicians.</p>
                  <Link className="btn btn--primary" to={addTaskPath}>
                    Add the first task
                  </Link>
                </>
              )}
            </EmptyState>
          ) : (
            <>
              <p className="results-summary" role="status">
                Showing {(data.meta.page - 1) * data.meta.pageSize + 1}–
                {(data.meta.page - 1) * data.meta.pageSize + data.data.length} of {data.meta.total} tasks
              </p>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Tasks table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Reference</th>
                      <th scope="col">Task</th>
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
                        <td className="nowrap">{task.id}</td>
                        <th scope="row" className="data-table__primary data-table__wrap">
                          {task.title}
                        </th>
                        <td className="nowrap">
                          <TaskStatusBadge status={task.status} />
                        </td>
                        <td className="nowrap">
                          <PriorityBadge priority={task.priority} />
                        </td>
                        <td className="nowrap">{task.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                        <td className="nowrap">
                          {formatDate(task.dueDate)}
                          {isOverdue(task.dueDate, task.status === 'Done') && (
                            <span className="badge badge--danger badge--inline">Overdue</span>
                          )}
                        </td>
                        <td className="nowrap">
                          <Link className="table-link" to={`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.id)}/edit`}>
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
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPageChange={setPage} />
        </div>
      )}
    </section>
  )
}
