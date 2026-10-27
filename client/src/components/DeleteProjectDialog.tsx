import { useRef, useState } from 'react'
import type { Project, ProjectDeleteResponse } from '@lc-projecthub/shared'
import { ApiRequestError } from '../api/http'
import { deleteProject } from '../api/projects'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'

interface DeleteProjectDialogProps {
  project: Pick<Project, 'id' | 'name'>
  onCancel: () => void
  /** The server confirmed the deletion, and says how many tasks went with the project. */
  onDeleted: (result: ProjectDeleteResponse) => void
  /** The server says the project is already gone (404). */
  onAlreadyGone: () => void
}

/** Confirms, then deletes a project and all of its tasks. Names the project and says what else will be lost. */
export function DeleteProjectDialog({ project, onCancel, onDeleted, onAlreadyGone }: DeleteProjectDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  async function confirm() {
    if (submittingRef.current) return
    submittingRef.current = true
    setBusy(true)
    setError(null)
    try {
      onDeleted(await deleteProject(project.id))
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 404) {
        onAlreadyGone()
        return
      }
      setError(failure instanceof ApiRequestError ? failure.message : 'Something went wrong. Please try again.')
      submittingRef.current = false
      setBusy(false)
    }
  }

  return (
    <ConfirmDeleteDialog
      title={`Delete project ${project.id}?`}
      confirmLabel="Delete project and its tasks"
      busyLabel="Deleting…"
      busy={busy}
      error={error}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <p>
        This permanently deletes the project “{project.name}” ({project.id}) <strong>and all tasks associated with it</strong>.
        This cannot be undone.
      </p>
    </ConfirmDeleteDialog>
  )
}
