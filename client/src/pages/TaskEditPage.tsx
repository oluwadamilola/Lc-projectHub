import { Link, useNavigate, useParams } from 'react-router-dom'
import { getTask, getTechnicians, updateTask } from '../api/tasks'
import { EmptyState, ErrorState, LoadingState } from '../components/StateMessage'
import { TaskForm } from '../components/TaskForm'
import { useApiResource } from '../hooks/useApiResource'
import { valuesFromTask } from '../lib/taskForm'

export function TaskEditPage() {
  const { id: projectId = '', taskId = '' } = useParams()
  const navigate = useNavigate()
  const task = useApiResource((signal) => getTask(projectId, taskId, signal), [projectId, taskId])
  const technicians = useApiResource((signal) => getTechnicians(signal), [])
  const projectPath = `/projects/${encodeURIComponent(projectId)}`

  // 404 (no such task in this project) and 400 (malformed reference) both mean "there is no such task".
  const notFound = task.status === 'error' && (task.error.status === 404 || task.error.status === 400)

  return (
    <>
      <Link className="back-link" to={projectPath}>
        ← Back to project
      </Link>
      <div className="page-header">
        <div>
          <h1>Edit task</h1>
          {task.data && (
            <p>
              {task.data.id}: {task.data.title}
            </p>
          )}
        </div>
        <span className="demo-note">Demonstration data</span>
      </div>

      {notFound ? (
        <section className="card">
          <EmptyState title="Task not found">
            <p>
              There is no task with the reference “{taskId}” in project {projectId}. It may have been removed or the link may be wrong.
            </p>
            <Link className="btn btn--primary" to={projectPath}>
              Back to the project
            </Link>
          </EmptyState>
        </section>
      ) : task.status === 'error' ? (
        <section className="card">
          <ErrorState title="Task could not be loaded" message={task.error.message} onRetry={task.reload} />
        </section>
      ) : technicians.status === 'error' ? (
        <section className="card">
          <ErrorState title="Technicians could not be loaded" message={technicians.error.message} onRetry={technicians.reload} />
        </section>
      ) : !task.data || !technicians.data ? (
        <LoadingState label="Loading task…" />
      ) : (
        // Keyed by reference so moving between tasks always starts from that task's values.
        <TaskForm
          key={task.data.id}
          initialValues={valuesFromTask(task.data)}
          technicians={technicians.data}
          submitLabel="Save changes"
          savingLabel="Saving…"
          cancelTo={projectPath}
          onSubmit={(input) => updateTask(projectId, task.data!.id, input)}
          onSaved={(saved) => navigate(projectPath, { state: { notice: `Changes to ${saved.id} were saved.` } })}
        />
      )}
    </>
  )
}
