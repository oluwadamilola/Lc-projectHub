import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getProject } from '../api/projects'
import { createTask, getTechnicians } from '../api/tasks'
import { ProjectLoadFailure } from '../components/ProjectLoadFailure'
import { ErrorState, LoadingState } from '../components/StateMessage'
import { TaskForm } from '../components/TaskForm'
import { useApiResource } from '../hooks/useApiResource'
import { emptyTaskFormValues } from '../lib/taskForm'

export function TaskCreatePage() {
  const { id: projectId = '' } = useParams()
  const navigate = useNavigate()
  const project = useApiResource((signal) => getProject(projectId, signal), [projectId])
  const technicians = useApiResource((signal) => getTechnicians(signal), [])
  // Computed once so the "unsaved changes" comparison has a stable starting point.
  const [initialValues] = useState(() => emptyTaskFormValues())
  const projectPath = `/projects/${encodeURIComponent(projectId)}`

  return (
    <>
      <Link className="back-link" to={projectPath}>
        ← Back to project
      </Link>
      <div className="page-header">
        <div>
          <h1>New task</h1>
          <p>{project.data ? `${project.data.id}: ${project.data.name}` : 'Add a task to this project.'}</p>
        </div>
        <span className="demo-note">Demonstration data</span>
      </div>

      {project.status === 'error' ? (
        <ProjectLoadFailure id={projectId} error={project.error} onRetry={project.reload} />
      ) : technicians.status === 'error' ? (
        <section className="card">
          <ErrorState title="Technicians could not be loaded" message={technicians.error.message} onRetry={technicians.reload} />
        </section>
      ) : !project.data || !technicians.data ? (
        <LoadingState label="Loading…" />
      ) : (
        <TaskForm
          initialValues={initialValues}
          technicians={technicians.data}
          submitLabel="Create task"
          savingLabel="Creating…"
          cancelTo={projectPath}
          onSubmit={(input) => createTask(project.data!.id, input)}
          onSaved={(task) => navigate(projectPath, { state: { notice: `Task ${task.id} was created.` } })}
        />
      )}
    </>
  )
}
