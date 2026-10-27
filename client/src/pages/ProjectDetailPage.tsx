import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { ProjectDeleteResponse } from '@lc-projecthub/shared'
import { getProject } from '../api/projects'
import { DeleteProjectDialog } from '../components/DeleteProjectDialog'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { ProgressBar } from '../components/ProgressBar'
import { LoadingState } from '../components/StateMessage'
import { ProjectLoadFailure } from '../components/ProjectLoadFailure'
import { ProjectTasks } from '../components/ProjectTasks'
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
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Leave the page of a project that no longer exists. The projects list, All tasks and the dashboard
  // load their data when opened, so they show the change without any extra refresh.
  function leaveAfterDelete(text: string) {
    navigate('/projects', { replace: true, state: { notice: text } })
  }
  function handleDeleted({ data: removed, meta }: ProjectDeleteResponse) {
    const count = meta.deletedTasks
    leaveAfterDelete(
      count === 0
        ? `Project ${removed.id} “${removed.name}” was deleted. It had no tasks.`
        : `Project ${removed.id} “${removed.name}” and its ${count} ${count === 1 ? 'task were' : 'tasks were'} deleted.`,
    )
  }

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
          <button type="button" className="btn btn--danger" onClick={() => setConfirmingDelete(true)}>
            Delete project
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <DeleteProjectDialog
          project={project}
          onCancel={() => setConfirmingDelete(false)}
          onDeleted={handleDeleted}
          onAlreadyGone={() => leaveAfterDelete(`Project ${project.id} had already been deleted.`)}
        />
      )}

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

      <div className="detail-tasks">
        <ProjectTasks projectId={project.id} />
      </div>
    </>
  )
}
