import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { InspectionView } from '@lc-projecthub/shared'
import { completeInspection, getInspection, markInspectionUnable, setInspectionNoEquipment } from '../api/audit'
import { ApiRequestError } from '../api/http'
import { useChecklistAutosave } from '../hooks/useChecklistAutosave'
import { formatDate } from '../lib/format'
import { withCycle } from '../lib/audit'
import { describeChecked, draftFromLine, percentChecked, problemTarget } from '../lib/inspection'
import { AddEquipmentForm } from './AddEquipmentForm'
import { InspectionCompleted } from './InspectionCompleted'
import { InspectionItem } from './InspectionItem'
import { ProgressBar } from './ProgressBar'
import { UnableForm } from './UnableForm'

interface InspectionWorkspaceProps {
  initial: InspectionView
  /** Called after the room has been recorded as unable to inspect. */
  onUnable: (view: InspectionView) => void
}

const failureMessage = (error: unknown) => (error instanceof ApiRequestError ? error.message : 'Something went wrong. Please try again.')

/** Moves the keyboard focus to a part of the page (an item card, the no-equipment panel) and scrolls it into view. */
function jumpTo(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  target.scrollIntoView?.({ block: 'center' })
  const focusable = target.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), [tabindex]') ?? target
  focusable.focus({ preventScroll: true })
}

/**
 * The technician's walk-round: every item of the room to check, in one list, with large controls and everything saved
 * as it is entered. All rules (what is required, when the inspection can be completed) are the server's; this screen
 * shows what the server reports and sends what the technician does.
 */
export function InspectionWorkspace({ initial, onUnable }: InspectionWorkspaceProps) {
  const [view, setView] = useState(initial)
  const [panel, setPanel] = useState<'none' | 'add' | 'unable'>('none')
  const [actionError, setActionError] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  const [togglingNone, setTogglingNone] = useState(false)
  /** What the box shows while a change is on its way to the server, so it responds at once. */
  const [noneShown, setNoneShown] = useState<boolean | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)
  const guard = useRef(false)

  const autosave = useChecklistAutosave({ inspectionId: view.id, onSaved: setView })

  // Warn before the browser closes the tab with answers that have not reached the server yet.
  const unsettled = autosave.status === 'saving' || autosave.status === 'error'
  useEffect(() => {
    if (!unsettled) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsettled])

  // After equipment is added, take the technician to its card.
  useEffect(() => {
    if (justAdded) {
      jumpTo(`item-${justAdded}`)
      document.getElementById(`item-${justAdded}-title`)?.focus({ preventScroll: true })
    }
  }, [justAdded])

  /** Runs one action at a time, so a double click or tap cannot send it twice. */
  const exclusive = useCallback(async (setBusy: (busy: boolean) => void, work: () => Promise<void>) => {
    if (guard.current) return
    guard.current = true
    setBusy(true)
    setActionError(null)
    try {
      await work()
    } catch (error) {
      setActionError(failureMessage(error))
    } finally {
      guard.current = false
      setBusy(false)
    }
  }, [])

  if (view.status === 'Completed') return <InspectionCompleted view={view} />

  const { room, lines, progress, completion } = view
  const noEquipment = lines.length === 0
  const canComplete = completion.canComplete && !unsettled && !completing

  const complete = () =>
    exclusive(setCompleting, async () => {
      const saved = await autosave.settle()
      if (!saved) {
        setActionError('Some answers have not been saved yet. Use "Try again" on the items marked Not saved, then complete the inspection.')
        return
      }
      try {
        const response = await completeInspection(view.id)
        setView(response.data)
        window.scrollTo({ top: 0 })
      } catch (error) {
        if (error instanceof ApiRequestError && (error.status === 409 || error.status === 400)) {
          // Someone (or an earlier tap) already completed it, or the server found something still missing. Take its word for it.
          const latest = await getInspection(view.id).catch(() => null)
          if (latest) setView(latest.data)
          if (latest?.data.status === 'Completed') return
        }
        throw error
      }
    })

  const setNone = (confirmed: boolean) =>
    exclusive(setTogglingNone, async () => {
      setNoneShown(confirmed)
      try {
        const response = await setInspectionNoEquipment(view.id, confirmed)
        setView(response.data)
      } finally {
        setNoneShown(null)
      }
    })

  const recordUnable = async (reason: string) => {
    await autosave.settle()
    const response = await markInspectionUnable(view.id, { reason, inspectorId: view.inspectorId })
    onUnable(response.data)
  }

  const statusText =
    autosave.status === 'saving' ? 'Saving…' : autosave.status === 'error' ? 'Some answers are not saved' : autosave.status === 'saved' ? 'All changes saved' : 'Answers are saved as you go'

  return (
    <>
      <div className="page-header">
        <div>
          <p className="detail-ref">
            {view.id} · {view.cycle.name}
          </p>
          <h1>Inspect room {room.code}</h1>
          <div className="detail-meta">
            <span>
              {room.blockName}, {room.floorName}
            </span>
            {room.displayName && <span>{room.displayName}</span>}
            <span>Inspector: {view.inspectorName ?? view.inspectorId}</span>
            <span>
              Cycle {formatDate(view.cycle.startDate)} to {formatDate(view.cycle.endDate)}
            </span>
          </div>
        </div>
        <div className="page-header__actions">
          <Link className="btn" to={withCycle(`/audit/rooms/${encodeURIComponent(room.id)}`, view.cycle.id)}>
            Room equipment and history
          </Link>
        </div>
      </div>

      {view.attempts.length > 0 && (
        <p className="notice">
          Earlier visit: {view.attempts[view.attempts.length - 1]!.reason}. Your earlier answers have been kept.
        </p>
      )}

      <div className="inspection-bar" role="region" aria-label="Inspection progress">
        <div className="inspection-bar__progress">
          <p>
            <strong>{describeChecked(progress)}</strong>
          </p>
          <div
            role="progressbar"
            aria-label="Items checked"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.checked}
            aria-valuetext={describeChecked(progress)}
          >
            <ProgressBar value={percentChecked(progress)} />
          </div>
        </div>
        <div className="inspection-bar__status" role="status" aria-live="polite">
          <span className={`save-state save-state--${autosave.status}`}>{statusText}</span>
          {autosave.status === 'error' && (
            <button type="button" className="btn btn--small" onClick={autosave.retry}>
              Try again
            </button>
          )}
        </div>
        <div className="inspection-bar__actions">
          <button type="button" className="btn btn--large" onClick={() => setPanel(panel === 'unable' ? 'none' : 'unable')} aria-expanded={panel === 'unable'}>
            Unable to inspect
          </button>
          <button type="button" className="btn btn--primary btn--large" disabled={!canComplete} onClick={complete} aria-describedby="complete-help">
            {completing ? 'Completing…' : 'Complete inspection'}
          </button>
        </div>
      </div>

      {actionError && (
        <div className="error-summary" role="alert">
          <h2>That did not work</h2>
          <p>{actionError}</p>
        </div>
      )}

      {panel === 'unable' && <UnableForm onSubmit={recordUnable} onCancel={() => setPanel('none')} />}

      <p id="complete-help" className="complete-help">
        {canComplete
          ? 'Everything is answered. You can complete the inspection.'
          : completion.problems.length > 0
            ? `Still needed before you can complete (${completion.problems.length}):`
            : 'Waiting for your answers to save…'}
      </p>
      {!completion.canComplete && completion.problems.length > 0 && (
        <ul className="problem-list">
          {completion.problems.map((problem) => {
            const target = problemTarget(problem.field)
            return (
              <li key={`${problem.field}-${problem.message}`}>
                {target ? (
                  <button type="button" className="link-button" onClick={() => jumpTo(target)}>
                    {problem.message}
                  </button>
                ) : (
                  problem.message
                )}
              </li>
            )
          })}
        </ul>
      )}

      {noEquipment && (
        <section className="card" id="no-equipment" aria-labelledby="no-equipment-heading" tabIndex={-1}>
          <div className="card__header">
            <h2 id="no-equipment-heading">No equipment recorded for this room</h2>
          </div>
          <div className="card__body">
            <p>If the room really has nothing to inspect, confirm it. If you find equipment, add it below.</p>
            <label className="confirm-box">
              <input type="checkbox" checked={noneShown ?? view.noEquipmentConfirmed} disabled={togglingNone} onChange={(event) => setNone(event.target.checked)} />
              <span>I confirm there is no equipment in this room</span>
            </label>
          </div>
        </section>
      )}

      {panel === 'add' && (
        <AddEquipmentForm
          inspectionId={view.id}
          roomId={room.id}
          onCancel={() => setPanel('none')}
          onAdded={(response) => {
            setView(response.data)
            setPanel('none')
            setJustAdded(response.equipmentItemId)
          }}
        />
      )}

      <section className="card" aria-labelledby="checklist-heading">
        <div className="card__header card__header--split">
          <h2 id="checklist-heading">
            Equipment checklist <span className="count">({lines.length})</span>
          </h2>
          <button type="button" className="btn btn--large" onClick={() => setPanel(panel === 'add' ? 'none' : 'add')} aria-expanded={panel === 'add'}>
            Add equipment found
          </button>
        </div>
        {lines.length > 0 && (
          <ol className="checklist">
            {lines.map((line) => (
              <InspectionItem
                key={line.id}
                line={line}
                draft={autosave.drafts[line.id] ?? draftFromLine(line)}
                save={autosave.saves[line.id]}
                disabled={completing}
                onChange={(patch, options) => autosave.change(line.id, draftFromLine(line), patch, options)}
                onRetry={autosave.retry}
              />
            ))}
          </ol>
        )}
      </section>
    </>
  )
}
