import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MAX_SEARCH_LENGTH, PROJECT_STATUSES, type ProjectStatus } from '@lc-projecthub/shared'
import { getProjects } from '../api/projects'
import { Pagination } from '../components/Pagination'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState, ErrorState, LoadingState } from '../components/StateMessage'
import { useApiResource } from '../hooks/useApiResource'

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 300

function readStatus(value: string | null): ProjectStatus | undefined {
  return PROJECT_STATUSES.find((status) => status === value)
}

function readPage(value: string | null): number {
  const page = Number(value)
  return Number.isInteger(page) && page >= 1 ? page : 1
}

export function ProjectsPage() {
  // Filters live in the URL so a filtered view can be bookmarked, shared and used with Back.
  const [searchParams, setSearchParams] = useSearchParams()
  const q = (searchParams.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH)
  const status = readStatus(searchParams.get('status'))
  const page = readPage(searchParams.get('page'))

  const [searchText, setSearchText] = useState(q)

  // Functional form keeps this function stable, so the debounce effect below only restarts when typing changes.
  const updateParams = useCallback(
    (changes: { q?: string; status?: string; page?: number }) => {
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

  const result = useApiResource(
    (signal) => getProjects({ q: q || undefined, status, page, pageSize: PAGE_SIZE }, signal),
    [q, status, page],
  )

  const filtered = q !== '' || status !== undefined || page !== 1
  function clearFilters() {
    setSearchText('')
    setSearchParams({}, { replace: true })
  }

  const data = result.data
  const showLoading = result.status === 'loading' && !data
  // On any failure show only the error: rows left over from a previous query would not match the filters now chosen.
  const showError = result.status === 'error'

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p>Browse and search IT projects across the college.</p>
        </div>
        <div className="page-header__actions">
          <span className="demo-note">Demonstration data</span>
          <Link className="btn btn--primary" to="/projects/new">
            New project
          </Link>
        </div>
      </div>

      <section className="card" aria-label="Project list">
        <form className="toolbar" role="search" onSubmit={(event) => event.preventDefault()}>
          <div className="field">
            <label className="field__label" htmlFor="project-search">
              Search projects
            </label>
            <input
              id="project-search"
              className="input"
              type="search"
              placeholder="Name, reference, location, lead or keyword"
              maxLength={MAX_SEARCH_LENGTH}
              value={searchText}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="project-status">
              Status
            </label>
            <select
              id="project-status"
              className="input"
              value={status ?? ''}
              onChange={(event) => updateParams({ status: event.target.value, page: 1 })}
            >
              <option value="">All statuses</option>
              {PROJECT_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" onClick={clearFilters} disabled={!filtered && searchText === ''}>
            Clear filters
          </button>
        </form>

        {showLoading && <LoadingState label="Loading projects…" />}

        {showError && (
          <ErrorState
            title="Projects could not be loaded"
            message={result.error.message}
            onRetry={result.reload}
          />
        )}

        {data && !showError && (
          <div className="results" aria-busy={result.status === 'loading'}>
            {data.data.length === 0 ? (
              <EmptyState title={filtered ? 'No projects match your filters' : 'There are no projects yet'}>
                {filtered && (
                  <>
                    <p>Try a different search or status.</p>
                    <button type="button" className="btn" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </>
                )}
              </EmptyState>
            ) : (
              <>
                <p className="results-summary" role="status">
                  Showing {(data.meta.page - 1) * data.meta.pageSize + 1}–
                  {(data.meta.page - 1) * data.meta.pageSize + data.data.length} of {data.meta.total} projects
                </p>
                <div className="table-scroll" tabIndex={0} role="region" aria-label="Projects table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Reference</th>
                        <th scope="col">Project</th>
                        <th scope="col">Location</th>
                        <th scope="col">Lead</th>
                        <th scope="col">Priority</th>
                        <th scope="col">Status</th>
                        <th scope="col">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((project) => (
                        <tr key={project.id}>
                          <td className="nowrap">{project.id}</td>
                          <th scope="row" className="data-table__primary">
                            <Link className="table-link" to={`/projects/${project.id}`}>
                              {project.name}
                            </Link>
                          </th>
                          <td>{project.location}</td>
                          <td>{project.lead}</td>
                          <td className="nowrap">
                            <PriorityBadge priority={project.priority} />
                          </td>
                          <td className="nowrap">
                            <StatusBadge status={project.status} />
                          </td>
                          <td className="nowrap">
                            <ProgressBar value={project.progress} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <Pagination
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              onPageChange={(next) => updateParams({ page: next })}
            />
          </div>
        )}
      </section>
    </>
  )
}
