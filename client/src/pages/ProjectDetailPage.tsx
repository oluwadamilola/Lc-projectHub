import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { getProject } from '../api/projects'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { ProgressBar } from '../components/ProgressBar'
import { LoadingState } from '../components/StateMessage'
import { ProjectLoadFailure } from '../components/ProjectLoadFailure'
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
  const location = useLocation()
  const navigate = useNavigate()
  // A confirmation passed along by the page that just saved (for example "Project PRJ-113 was created.").
  // It belongs to this project only, so it is remembered together with the reference it was shown for.
  const [notice] = useState(() => {
    const text = (location.state as { notice?: string } | null)?.notice
    return text ? { id, text } : undefined
  })
  const clearedRef = useRef(false)
  useEffect(() => {
    // Clear it from the history entry so a refresh or Back does not show it again.
    if (notice && !clearedRef.current) {
      clearedRef.current = true
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [notice, navigate, location.pathname])
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
    return (
      <>
        <BackLink />
        <ProjectLoadFailure id={id} error={result.error} onRetry={result.reload} />
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
        <div className="page-header__actions">
          <span className="demo-note">Demonstration data</span>
          <Link className="btn btn--primary" to={`/projects/${encodeURIComponent(project.id)}/edit`}>
            Edit project
          </Link>
        </div>
      </div>

      {notice?.id === project.id && (
        <p className="notice notice--success" role="status">
          {notice.text}
        </p>
      )}

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
