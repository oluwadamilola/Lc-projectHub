import { Link, useNavigate, useParams } from 'react-router-dom'
import { getProject, updateProject } from '../api/projects'
import { ProjectForm } from '../components/ProjectForm'
import { ProjectLoadFailure } from '../components/ProjectLoadFailure'
import { LoadingState } from '../components/StateMessage'
import { useApiResource } from '../hooks/useApiResource'
import { valuesFromProject } from '../lib/projectForm'

export function ProjectEditPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const result = useApiResource((signal) => getProject(id, signal), [id])
  const project = result.data
  const detailPath = `/projects/${encodeURIComponent(id)}`

  return (
    <>
      <Link className="back-link" to={project ? detailPath : '/projects'}>
        {project ? '← Back to project' : '← Back to projects'}
      </Link>
      <div className="page-header">
        <div>
          <h1>Edit project</h1>
          {project && <p>{project.id}: {project.name}</p>}
        </div>
        <span className="demo-note">Demonstration data</span>
      </div>

      {!project && result.status === 'loading' && <LoadingState label="Loading project…" />}
      {!project && result.status === 'error' && (
        <ProjectLoadFailure id={id} error={result.error} onRetry={result.reload} />
      )}

      {project && (
        // Keyed by reference so moving between projects always starts from that project's values.
        <ProjectForm
          key={project.id}
          initialValues={valuesFromProject(project)}
          submitLabel="Save changes"
          savingLabel="Saving…"
          cancelTo={detailPath}
          onSubmit={(input) => updateProject(project.id, input)}
          onSaved={(saved) =>
            navigate(`/projects/${saved.id}`, { state: { notice: `Changes to ${saved.id} were saved.` } })
          }
        />
      )}
    </>
  )
}
