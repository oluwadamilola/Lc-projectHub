import { useRef, useState } from 'react'
import type { Task } from '@lc-projecthub/shared'
import { ApiRequestError } from '../api/http'
import { deleteTask } from '../api/tasks'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'

interface DeleteTaskDialogProps {
  task: Pick<Task, 'id' | 'projectId' | 'title'>
  onCancel: () => void
  /** The server confirmed the deletion. The caller closes the dialog and refreshes its list. */
  onDeleted: (task: Task) => void
  /** The server says the task is already gone (404), so the caller should refresh its list. */
  onAlreadyGone: () => void
}

/** Confirms, then deletes one task. Success is only reported after the server has said so. */
export function DeleteTaskDialog({ task, onCancel, onDeleted, onAlreadyGone }: DeleteTaskDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A ref, not state: two quick clicks must not both get through before React re-renders.
  const submittingRef = useRef(false)

  async function confirm() {
    if (submittingRef.current) return
    submittingRef.current = true
    setBusy(true)
    setError(null)
    try {
      onDeleted(await deleteTask(task.projectId, task.id))
    } catch (failure) {
      const gone = failure instanceof ApiRequestError && failure.status === 404
      const message = failure instanceof ApiRequestError ? failure.message : 'Something went wrong. Please try again.'
      setError(gone ? `${message} It may already have been deleted, so the list has been refreshed.` : message)
      if (gone) onAlreadyGone()
      submittingRef.current = false
      setBusy(false)
    }
  }

  return (
    <ConfirmDeleteDialog
      title={`Delete task ${task.id}?`}
      confirmLabel="Delete task"
      busyLabel="Deleting…"
      busy={busy}
      error={error}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <p>
        This permanently deletes the task “{task.title}” ({task.id}). This cannot be undone.
      </p>
    </ConfirmDeleteDialog>
  )
}
