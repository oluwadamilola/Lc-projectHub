import { Link } from 'react-router-dom'
import type { ApiRequestError } from '../api/http'
import { EmptyState, ErrorState } from './StateMessage'

interface ProjectLoadFailureProps {
  id: string
  error: ApiRequestError
  onRetry: () => void
}

/** Shown when a single project cannot be loaded: "not found" for a missing project, otherwise an error with retry. */
export function ProjectLoadFailure({ id, error, onRetry }: ProjectLoadFailureProps) {
  // 404 (no such project) and 400 (malformed reference) both mean "there is no such project".
  const notFound = error.status === 404 || error.status === 400
  return (
    <section className="card">
      {notFound ? (
        <EmptyState title="Project not found">
          <p>There is no project with the reference “{id}”. It may have been removed or the link may be wrong.</p>
          <Link className="btn btn--primary" to="/projects">
            View all projects
          </Link>
        </EmptyState>
      ) : (
        <ErrorState title="Project could not be loaded" message={error.message} onRetry={onRetry} />
      )}
    </section>
  )
}
