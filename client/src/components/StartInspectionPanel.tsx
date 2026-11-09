import { useRef, useState, type FormEvent } from 'react'
import type { InspectionView, RoomDetail } from '@lc-projecthub/shared'
import { startInspection } from '../api/audit'
import { ApiRequestError } from '../api/http'
import { getTechnicians } from '../api/tasks'
import { useApiResource } from '../hooks/useApiResource'
import { ErrorState, LoadingState } from './StateMessage'
import { FormField } from './FormField'

const REMEMBER_KEY = 'lc.audit.inspector'

function remembered(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? ''
  } catch {
    return ''
  }
}

interface StartInspectionPanelProps {
  room: RoomDetail
  cycleId: string
  /** The reason from an earlier visit that could not inspect the room, if there was one. */
  earlierReason: string | null
  /** Answers saved before that visit was recorded as unable to inspect. */
  keptAnswers: number
  onStarted: (view: InspectionView) => void
}

/**
 * Starting (or starting again) a room's inspection: the technician chooses who is inspecting, then one button starts it.
 * Nothing is created until then, and starting twice is harmless: the server returns the inspection already under way.
 */
export function StartInspectionPanel({ room, cycleId, earlierReason, keptAnswers, onStarted }: StartInspectionPanelProps) {
  const technicians = useApiResource((signal) => getTechnicians(signal), [])
  const [chosen, setChosen] = useState(remembered)
  const [error, setError] = useState<string | undefined>()
  const [problem, setProblem] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (startingRef.current) return
    if (!chosen) {
      setError('Choose who is inspecting.')
      return
    }
    startingRef.current = true
    setStarting(true)
    setError(undefined)
    setProblem(null)
    try {
      const response = await startInspection(room.id, { inspectorId: chosen, cycleId })
      try {
        localStorage.setItem(REMEMBER_KEY, chosen)
      } catch {
        /* remembering the technician is a convenience only */
      }
      onStarted(response.data)
    } catch (failure) {
      const details = failure instanceof ApiRequestError ? failure.details : []
      const inspectorProblem = details.find((entry) => entry.field === 'inspectorId')
      if (inspectorProblem) setError(inspectorProblem.message)
      else setProblem(failure instanceof ApiRequestError ? failure.message : 'Something went wrong. Please try again.')
      startingRef.current = false
      setStarting(false)
    }
  }

  if (technicians.status === 'loading' && !technicians.data) return <LoadingState label="Loading technicians…" />
  if (technicians.status === 'error') {
    return <ErrorState title="The list of technicians could not be loaded" message={technicians.error.message} onRetry={technicians.reload} />
  }

  const resuming = keptAnswers > 0
  return (
    <section className="card" aria-labelledby="start-heading">
      <div className="card__header">
        <h2 id="start-heading">{earlierReason ? 'Inspect this room again' : 'Start the inspection'}</h2>
      </div>
      <div className="card__body">
        {earlierReason && (
          <p className="notice" role="status">
            The last visit was recorded as unable to inspect: {earlierReason}.{' '}
            {resuming ? `Your ${keptAnswers === 1 ? 'answer' : `${keptAnswers} answers`} from that visit ${keptAnswers === 1 ? 'has' : 'have'} been kept.` : ''}
          </p>
        )}
        <p>
          Room <strong>{room.code}</strong> has {room.equipmentCount === 0 ? 'no equipment recorded' : room.equipmentCount === 1 ? '1 item to check' : `${room.equipmentCount} items to check`}.
          Starting opens the checklist; every answer is saved as you go.
        </p>
        {problem && (
          <div className="error-summary" role="alert">
            <h2>The inspection could not be started</h2>
            <p>{problem}</p>
          </div>
        )}
        <form onSubmit={submit} noValidate className="start-form">
          <FormField name="inspector" label="Who is inspecting?" error={error}>
            {(props) => (
              <select {...props} className="input input--large" value={chosen} onChange={(event) => setChosen(event.target.value)} disabled={starting}>
                <option value="">Choose a technician…</option>
                {(technicians.data ?? []).map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <button type="submit" className="btn btn--primary btn--large" disabled={starting}>
            {starting ? 'Starting…' : earlierReason ? 'Start inspection again' : 'Start inspection'}
          </button>
        </form>
      </div>
    </section>
  )
}
