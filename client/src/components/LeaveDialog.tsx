import type { Ref } from 'react'

interface LeaveDialogProps {
  onStay: () => void
  onLeave: () => void
  stayButtonRef: Ref<HTMLButtonElement>
}

/** Shown when the user tries to leave a form with unsaved changes. Escape means "stay". */
export function LeaveDialog({ onStay, onLeave, stayButtonRef }: LeaveDialogProps) {
  return (
    <div
      className="leave-dialog card"
      role="alertdialog"
      aria-labelledby="leave-title"
      aria-describedby="leave-text"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onStay()
      }}
    >
      <h2 id="leave-title">Leave without saving?</h2>
      <p id="leave-text">You have unsaved changes. If you leave this page they will be lost.</p>
      <div className="form-actions">
        <button type="button" ref={stayButtonRef} className="btn btn--primary" onClick={onStay}>
          Stay on this page
        </button>
        <button type="button" className="btn" onClick={onLeave}>
          Leave without saving
        </button>
      </div>
    </div>
  )
}
