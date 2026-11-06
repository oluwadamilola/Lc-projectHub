import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { EquipmentLine, ResultSummary } from '@lc-projecthub/shared'
import { getAuditRoom } from '../api/audit'
import { ConditionBadge, InspectionStatusBadge, ReviewBadge, RoomStatusBadge } from '../components/AuditBadges'
import { CycleBar } from '../components/CycleBar'
import { ErrorState, LoadingState } from '../components/StateMessage'
import { useApiResource } from '../hooks/useApiResource'
import { checkWords, formatWhen, readCycle, withCycle } from '../lib/audit'

function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link className="back-link" to={to}>
      {children}
    </Link>
  )
}

/** One recorded answer: its condition, any check answers, the note, and where it came from. */
function Answer({ result, showCycle }: { result: ResultSummary; showCycle: boolean }) {
  const when = [showCycle ? result.cycleName : '', formatWhen(result.checkedAt), result.inspectorName ?? ''].filter(Boolean).join(' · ')
  return (
    <div className="answer">
      <ConditionBadge condition={result.condition} />
      {result.corrected && <span className="badge badge--info">Corrected</span>}
      {result.checks.length > 0 && (
        <ul className="answer__checks">
          {result.checks.map((check) => (
            <li key={check.checkId}>
              {check.label}: {checkWords(check)}
              {check.note && <span className="muted"> ({check.note})</span>}
            </li>
          ))}
        </ul>
      )}
      {result.note && <span className="data-table__sub">{result.note}</span>}
      {when && <span className="data-table__sub">{when}</span>}
    </div>
  )
}

function ItemCell({ line }: { line: EquipmentLine }) {
  return (
    <>
      <span className="data-table__primary">{line.name ? `${line.typeLabel}: ${line.name}` : line.typeLabel}</span>{' '}
      <ReviewBadge status={line.reviewStatus} />
      {(line.assetTag || line.serialNumber) && (
        <span className="data-table__sub">
          {[line.assetTag && `Asset tag ${line.assetTag}`, line.serialNumber && `Serial ${line.serialNumber}`].filter(Boolean).join(' · ')}
        </span>
      )}
      {line.source === 'Found during inspection' && <span className="data-table__sub">Found during an inspection</span>}
    </>
  )
}

/**
 * One room: where it is, how its inspection stands in the chosen cycle, and its equipment checklist with this
 * cycle answer beside the answer from last time. Read-only: recording an inspection comes in a later stage.
 */
export function AuditRoomPage() {
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const cycleParam = readCycle(searchParams.get('cycle'))
  const result = useApiResource((signal) => getAuditRoom(id, cycleParam, signal), [id, cycleParam ?? ''])

  if (result.status === 'loading' && !result.data) {
    return (
      <>
        <BackLink to={withCycle('/audit', cycleParam)}>← Back to audit overview</BackLink>
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
            message={notFound ? `There is no room ${id}, or that inspection cycle does not exist. Choose a room from a block in the audit overview.` : result.error.message}
            onRetry={notFound ? undefined : result.reload}
          />
        </section>
      </>
    )
  }

  const room = result.data!.data
  const cycle = result.data!.cycle
  const cycleId = cycleParam ?? cycle?.id
  const blockPath = `/audit/blocks/${encodeURIComponent(room.blockId)}`
  const { inspection } = room
  const answered = (line: EquipmentLine) => line.current !== null && line.current.condition !== 'Not checked'

  return (
    <>
      <BackLink to={withCycle(`${blockPath}/floors/${encodeURIComponent(room.floorId)}`, cycleId)}>{`← Back to ${room.blockName}, ${room.floorName}`}</BackLink>
      <div className="page-header">
        <div>
          <p className="detail-ref">{room.id}</p>
          <h1>{room.code}</h1>
          <div className="detail-meta">
            <RoomStatusBadge active={room.active} />
            {room.displayName && <span>{room.displayName}</span>}
          </div>
        </div>
        <span className="demo-note">Demonstration data</span>
      </div>

      <CycleBar current={cycle} onChange={(next) => setSearchParams({ cycle: next })} />

      <div className="detail-grid">
        <section className="card" aria-labelledby="location-heading">
          <div className="card__header">
            <h2 id="location-heading">Location</h2>
          </div>
          <div className="card__body">
            <dl className="facts">
              <div>
                <dt>Block</dt>
                <dd>
                  <Link className="table-link" to={withCycle(blockPath, cycleId)}>
                    {room.blockName}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Floor</dt>
                <dd>{room.floorName}</dd>
              </div>
              <div>
                <dt>Room code</dt>
                <dd>{room.code}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{room.active ? 'Active' : 'Retired: kept on record, not inspected'}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="card" aria-labelledby="inspection-heading">
          <div className="card__header">
            <h2 id="inspection-heading">Inspection{cycle ? `: ${cycle.name}` : ''}</h2>
          </div>
          <div className="card__body">
            <p>
              <InspectionStatusBadge inspection={inspection} />
            </p>
            {!inspection.inScope && <p className="muted">This room was not part of this cycle.</p>}
            {inspection.inScope && inspection.status === 'Not started' && (
              <p className="muted">{cycle?.status === 'Open' ? 'This room has not been inspected yet.' : 'This room was never inspected in this cycle.'}</p>
            )}
            {inspection.inspectorName && (
              <dl className="facts">
                <div>
                  <dt>Inspector</dt>
                  <dd>{inspection.inspectorName}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatWhen(inspection.startedAt)}</dd>
                </div>
                {inspection.completedAt && (
                  <div>
                    <dt>Completed</dt>
                    <dd>{formatWhen(inspection.completedAt)}</dd>
                  </div>
                )}
              </dl>
            )}
            {inspection.status === 'Unable to inspect' && inspection.unableReason && (
              <p>
                <strong>Reason:</strong> {inspection.unableReason}
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="equipment-heading">
        <div className="card__header">
          <h2 id="equipment-heading">Equipment checklist</h2>
        </div>
        {room.equipment.length === 0 ? (
          <div className="card__body">
            <p>No equipment is recorded for this room.</p>
            {room.noEquipmentConfirmed === true && <p className="muted">An inspector confirmed in this cycle that the room has no equipment.</p>}
          </div>
        ) : (
          <>
            <p className="results-summary">
              {room.equipment.length === 1 ? '1 item' : `${room.equipment.length} items`}
              {inspection.inScope && ` · ${room.equipment.filter(answered).length} answered in ${cycle?.name ?? 'this cycle'}`}
              {room.itemsNeedingReview > 0 && ` · ${room.itemsNeedingReview} to review`}
            </p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Equipment table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">This cycle{cycle ? ` (${cycle.name})` : ''}</th>
                    <th scope="col">Last time</th>
                  </tr>
                </thead>
                <tbody>
                  {room.equipment.map((line) => (
                    <tr key={line.id}>
                      <th scope="row">
                        <ItemCell line={line} />
                      </th>
                      <td>
                        {answered(line) ? (
                          <Answer result={line.current!} showCycle={false} />
                        ) : line.current ? (
                          <ConditionBadge condition="Not checked" />
                        ) : (
                          <span className="muted">{inspection.inScope ? 'No answer yet' : 'Not part of this cycle'}</span>
                        )}
                      </td>
                      <td>
                        {line.previous ? <Answer result={line.previous} showCycle /> : <span className="muted">No earlier inspection</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  )
}
