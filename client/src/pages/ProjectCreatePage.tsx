import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createProject } from '../api/projects'
import { ProjectForm } from '../components/ProjectForm'
import { emptyFormValues } from '../lib/projectForm'

export function ProjectCreatePage() {
  const navigate = useNavigate()
  // Computed once so the "unsaved changes" comparison has a stable starting point.
  const [initialValues] = useState(() => emptyFormValues())

  return (
    <>
      <Link className="back-link" to="/projects">
        ← Back to projects
      </Link>
      <div className="page-header">
        <div>
          <h1>New project</h1>
          <p>Add a project. A reference is assigned automatically when it is saved.</p>
        </div>
        <span className="demo-note">Demonstration data</span>
      </div>

      <ProjectForm
        initialValues={initialValues}
        submitLabel="Create project"
        savingLabel="Creating…"
        cancelTo="/projects"
        onSubmit={createProject}
        onSaved={(project) =>
          navigate(`/projects/${project.id}`, { state: { notice: `Project ${project.id} was created.` } })
        }
      />
    </>
  )
}
