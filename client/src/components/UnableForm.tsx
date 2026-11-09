import { useRef, useState, type FormEvent } from 'react'
import { UNABLE_REASON_MAX, UNABLE_REASON_SUGGESTIONS, validateUnableToInspectInput } from '@lc-projecthub/shared'
import { ApiRequestError } from '../api/http'
import { FormField } from './FormField'

interface UnableFormProps {
  /** Records the reason with the server. Rejects with an ApiRequestError when it cannot. */
  onSubmit: (reason: string) => Promise<void>
  onCancel: () => void
}

/** Records why a room could not be inspected. Answers already given are kept and the room can be started again. */
export function UnableForm({ onSubmit, onCancel }: UnableFormProps) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submittingRef.current) return
    const checked = validateUnableToInspectInput({ reason: reason.trim() })
    if (!checked.ok) {
      setError(checked.errors[0]?.message)
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError(undefined)
    try {
      await onSubmit(checked.value.reason)
    } catch (failure) {
      setError(failure instanceof ApiRequestError ? failure.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
      submittingRef.current = false
    }
  }

  return (
    <form className="card form-card" onSubmit={submit} noValidate aria-labelledby="unable-heading">
      <h2 id="unable-heading">Unable to inspect this room</h2>
      <p className="form-note">
        Say why. Anything you have already answered is kept, and the room stays on the list so it can be inspected again.
      </p>
      <div className="chip-row" role="group" aria-label="Common reasons">
        {UNABLE_REASON_SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" className="btn btn--small" onClick={() => setReason(suggestion)} disabled={submitting}>
            {suggestion}
          </button>
        ))}
      </div>
      <FormField name="unableReason" label="Reason" error={error} wide>
        {(props) => (
          <input {...props} className="input" type="text" value={reason} maxLength={UNABLE_REASON_MAX + 50} onChange={(event) => setReason(event.target.value)} autoComplete="off" />
        )}
      </FormField>
      <div className="form-actions">
        <button type="submit" className="btn btn--primary btn--large" disabled={submitting}>
          {submitting ? 'Recording…' : 'Record: unable to inspect'}
        </button>
        <button type="button" className="btn btn--large" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  )
}
