import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ConfirmDeleteDialogProps {
  /** Names what is about to be deleted, for example `Delete task TASK-007?`. */
  title: string
  /** What will happen, in plain words. Shown under the title and read out with it. */
  children: ReactNode
  confirmLabel: string
  busyLabel: string
  busy: boolean
  /** Why the last attempt failed, or null. The dialog stays open so the attempt can be repeated. */
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks for explicit confirmation before something is deleted. Same look and behaviour as the unsaved-changes
 * dialog: it opens in the page, Escape means "keep it", and focus starts on the safe choice (Cancel),
 * then returns to where it was when the dialog closes. While a request is running both buttons are off,
 * so it cannot be sent twice.
 */
export function ConfirmDeleteDialog({ title, children, confirmLabel, busyLabel, busy, error, onConfirm, onCancel }: ConfirmDeleteDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return (
    <div
      className="confirm-dialog card"
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel()
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <div id={`${id}-text`} className="confirm-dialog__text">
        {children}
      </div>
      {error && (
        <p className="confirm-dialog__error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" ref={cancelRef} className="btn btn--primary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--danger" onClick={onConfirm} disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </div>
  )
}
