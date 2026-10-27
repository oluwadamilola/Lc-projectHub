import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { TASK_STATUSES, UNASSIGNED_FILTER, MAX_SEARCH_LENGTH, isTaskOverdue, toIsoDate, type Task, type TaskStatus } from '@lc-projecthub/shared'
import { getTasks, getTechnicians } from '../api/tasks'
import { useApiResource } from '../hooks/useApiResource'
import { formatDate } from '../lib/format'
import { DeleteTaskDialog } from './DeleteTaskDialog'
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
  // The task whose deletion is being confirmed, and the confirmation shown after one succeeds.
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null)
  const noticeKey = useRef(0)
  const noticeRef = useRef<HTMLParagraphElement>(null)

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
    async (signal) => ({
      tasks: await getTasks(
        projectId,
        { q: search || undefined, status: status || undefined, assignee: assignee || undefined, page, pageSize: PAGE_SIZE },
        signal,
      ),
      // "Overdue" is judged from the day the tasks were loaded, using the one rule shared with the dashboard and All tasks.
      today: toIsoDate(new Date()),
    }),
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

  const data = result.data?.tasks
  const todayIso = result.data?.today ?? ''
  const showError = result.status === 'error'
  const showLoading = result.status === 'loading' && !data
  const addTaskPath = `/projects/${encodeURIComponent(projectId)}/tasks/new`

  // Move focus to the confirmation so keyboard and screen-reader users are not left on a row that no longer exists.
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  function handleDeleted(task: Task) {
    setDeleting(null)
    noticeKey.current += 1
    setNotice({ key: noticeKey.current, text: `Task ${task.id} “${task.title}” was deleted.` })
    // Deleting the only task on a later page would leave an empty page, so step back to the previous one.
    if (data && data.data.length === 1 && page > 1) setPage(page - 1)
    else result.reload()
  }

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

      {deleting && (
        <DeleteTaskDialog
          task={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={handleDeleted}
          onAlreadyGone={result.reload}
        />
      )}

      {notice && (
        <p key={notice.key} ref={noticeRef} className="notice notice--success notice--inline" role="status" tabIndex={-1}>
          {notice.text}
        </p>
      )}

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
                          {isTaskOverdue(task, todayIso) && (
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
                          <button type="button" className="table-link table-link--danger" onClick={() => setDeleting(task)}>
                            Delete{' '}
                            <span className="visually-hidden">
                              task {task.id}: {task.title}
                            </span>
                          </button>
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
