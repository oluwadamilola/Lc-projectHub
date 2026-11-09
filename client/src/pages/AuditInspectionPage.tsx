import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { InspectionView, RoomDetail } from '@lc-projecthub/shared'
import { getAuditRoom, getInspection } from '../api/audit'
import { InspectionCompleted } from '../components/InspectionCompleted'
import { InspectionWorkspace } from '../components/InspectionWorkspace'
import { StartInspectionPanel } from '../components/StartInspectionPanel'
import { ErrorState, LoadingState } from '../components/StateMessage'
import { useApiResource } from '../hooks/useApiResource'
import { readCycle, withCycle } from '../lib/audit'

function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link className="back-link" to={to}>
      {children}
    </Link>
  )
}

/** Loads an inspection by reference (resuming after a reload) and shows it, or what went wrong. */
function ResumeInspection({ inspectionId, onUnable }: { inspectionId: string; onUnable: (view: InspectionView) => void }) {
  const loaded = useApiResource((signal) => getInspection(inspectionId, signal), [inspectionId])
  if (loaded.status === 'loading' && !loaded.data) return <LoadingState label="Opening the inspection…" />
  if (loaded.status === 'error') return <ErrorState title="The inspection could not be opened" message={loaded.error.message} onRetry={loaded.reload} />
  const view = loaded.data!.data
  return view.status === 'Completed' ? <InspectionCompleted view={view} /> : <InspectionWorkspace initial={view} onUnable={onUnable} />
}

/** What the page shows after the technician recorded that the room could not be inspected. */
interface UnableOutcome {
  reason: string
  keptAnswers: number
}

/**
 * Carrying out one room's inspection. It reads the room first, then decides what the technician needs: to start, to
 * carry on (this is also what a reload does), or to read the summary of a completed inspection. The server holds the
 * state, so nothing is lost by reloading or coming back later.
 */
export function AuditInspectionPage() {
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  const cycleParam = readCycle(searchParams.get('cycle'))
  const result = useApiResource((signal) => getAuditRoom(id, cycleParam, signal), [id, cycleParam ?? ''])
  const [started, setStarted] = useState<InspectionView | null>(null)
  const [unable, setUnable] = useState<UnableOutcome | null>(null)

  const back = (
    <BackLink to={withCycle(`/audit/rooms/${encodeURIComponent(id)}`, cycleParam)}>{`← Back to room ${id}`}</BackLink>
  )

  if (result.status === 'loading' && !result.data) {
    return (
      <>
        {back}
        <LoadingState label="Loading room…" />
      </>
    )
  }
  if (result.status === 'error') {
    const notFound = result.error.status === 404
    return (
      <>
        <BackLink to={withCycle('/audit', cycleParam)}>← Back to audit overview</BackLink>
        <section className="card">
          <ErrorState
            title={notFound ? 'Room or cycle not found' : 'The room could not be loaded'}
            message={notFound ? `There is no room ${id}, or that inspection cycle does not exist.` : result.error.message}
            onRetry={notFound ? undefined : result.reload}
          />
        </section>
      </>
    )
  }

  const room: RoomDetail = result.data!.data
  const cycle = result.data!.cycle
  const cycleId = cycleParam ?? cycle?.id ?? ''
  const { inspection } = room
  const roomBack = <BackLink to={withCycle(`/audit/rooms/${encodeURIComponent(room.id)}`, cycleId)}>{`← Back to room ${room.code}`}</BackLink>

  // An inspection being carried out on this screen takes over, whatever the room read said when the page loaded.
  if (started) {
    return (
      <>
        {roomBack}
        <InspectionWorkspace key={started.id} initial={started} onUnable={(view) => {
          setUnable({ reason: view.attempts[view.attempts.length - 1]?.reason ?? '', keptAnswers: view.progress.checked })
          setStarted(null)
        }} />
      </>
    )
  }

  const refuse = (title: string, message: string) => (
    <>
      {roomBack}
      <section className="card">
        <ErrorState title={title} message={message} />
      </section>
    </>
  )
  if (!cycle) return refuse('No inspection cycle', 'There is no inspection cycle to record an inspection in.')
  if (cycle.status !== 'Open') return refuse(`${cycle.name} is closed`, 'Closed cycles are kept as a record and cannot be inspected in. Choose the open cycle.')
  if (!room.active || !inspection.inScope) return refuse('This room is not being inspected', `Room ${room.code} is not part of ${cycle.name}.`)

  const showStart = unable !== null || inspection.status === 'Not started' || inspection.status === 'Unable to inspect'
  return (
    <>
      {roomBack}
      {showStart ? (
        <>
          <div className="page-header">
            <div>
              <p className="detail-ref">{cycle.name}</p>
              <h1>Inspect room {room.code}</h1>
              <div className="detail-meta">
                <span>
                  {room.blockName}, {room.floorName}
                </span>
                {room.displayName && <span>{room.displayName}</span>}
              </div>
            </div>
            <span className="demo-note">Demonstration data</span>
          </div>
          <StartInspectionPanel
            room={room}
            cycleId={cycle.id}
            earlierReason={unable?.reason ?? inspection.unableReason}
            keptAnswers={unable?.keptAnswers ?? inspection.checkedLines}
            onStarted={(view) => {
              setUnable(null)
              setStarted(view)
            }}
          />
        </>
      ) : (
        <ResumeInspection
          inspectionId={inspection.inspectionId ?? ''}
          onUnable={(view) => setUnable({ reason: view.attempts[view.attempts.length - 1]?.reason ?? '', keptAnswers: view.progress.checked })}
        />
      )}
    </>
  )
}
