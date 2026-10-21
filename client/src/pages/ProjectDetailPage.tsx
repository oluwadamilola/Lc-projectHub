import { Link, useParams } from 'react-router-dom'
import { getProject } from '../api/projects'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState, ErrorState, LoadingState } from '../components/StateMessage'
import { useApiResource } from '../hooks/useApiResource'
import { describeDeadline, formatDate } from '../lib/format'

function BackLink() {
  return (
    <Link className="back-link" to="/projects">
      ← Back to projects
    </Link>
  )
}

export function ProjectDetailPage() {
  const { id = '' } = useParams()
  const result = useApiResource((signal) => getProject(id, signal), [id])

  if (result.status === 'loading' && !result.data) {
    return (
      <>
        <BackLink />
        <LoadingState label="Loading project…" />
      </>
    )
  }

  if (result.status === 'error') {
    // 404 (no such project) and 400 (malformed reference) both mean "there is no such project".
    const notFound = result.error.status === 404 || result.error.status === 400
    return (
      <>
        <BackLink />
        {notFound ? (
          <section className="card">
            <EmptyState title="Project not found">
              <p>There is no project with the reference “{id}”. It may have been removed or the link may be wrong.</p>
              <Link className="btn btn--primary" to="/projects">
                View all projects
              </Link>
            </EmptyState>
          </section>
        ) : (
          <section className="card">
            <ErrorState title="Project could not be loaded" message={result.error.message} onRetry={result.reload} />
          </section>
        )}
      </>
    )
  }

  const project = result.data!
  const deadline = describeDeadline(project.dueDate, project.status)

  return (
    <>
      <BackLink />
      <div className="page-header">
        <div>
          <p className="detail-ref">{project.id}</p>
          <h1>{project.name}</h1>
          <div className="detail-meta">
            <StatusBadge status={project.status} />
            <PriorityBadge priority={project.priority} />
          </div>
        </div>
        <span className="demo-note">Demonstration data</span>
      </div>

      <div className="detail-grid">
        <section className="card" aria-labelledby="overview-heading">
          <div className="card__header">
            <h2 id="overview-heading">Overview</h2>
          </div>
          <div className="card__body">
            <p>{project.description}</p>
          </div>
          <div className="card__body">
            <dl className="facts">
              <div>
                <dt>Project lead</dt>
                <dd>{project.lead}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{project.department}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{project.location}</dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd>{project.priority}</dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="stack">
          <section className="card" aria-labelledby="progress-heading">
            <div className="card__header">
              <h2 id="progress-heading">Progress</h2>
            </div>
            <div className="card__body">
              <ProgressBar value={project.progress} />
            </div>
          </section>

          <section className="card" aria-labelledby="schedule-heading">
            <div className="card__header">
              <h2 id="schedule-heading">Schedule</h2>
            </div>
            <div className="card__body">
              <dl className="facts">
                <div>
                  <dt>Start date</dt>
                  <dd>
                    <time dateTime={project.startDate}>{formatDate(project.startDate)}</time>
                  </dd>
                </div>
                <div>
                  <dt>Due date</dt>
                  <dd>
                    <time dateTime={project.dueDate}>{formatDate(project.dueDate)}</time>
                  </dd>
                </div>
              </dl>
              {deadline && <p className="section-note">{deadline}</p>}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
