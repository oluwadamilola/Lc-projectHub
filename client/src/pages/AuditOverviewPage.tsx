import { Link, useSearchParams } from 'react-router-dom'
import { getAuditBlocks } from '../api/audit'
import { CycleBar } from '../components/CycleBar'
import { ProgressBar } from '../components/ProgressBar'
import { EmptyState, ErrorState, LoadingState } from '../components/StateMessage'
import { StatCard } from '../components/StatCard'
import { useApiResource } from '../hooks/useApiResource'
import { describeProgress, describeRemaining, plural, readCycle, withCycle } from '../lib/audit'

/**
 * The Audit overview: how far the chosen inspection cycle has got, and a row per block.
 * The cycle is in the address (?cycle=CYC-002); without it the open cycle is shown.
 */
export function AuditOverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const cycleParam = readCycle(searchParams.get('cycle'))
  const result = useApiResource((signal) => getAuditBlocks(cycleParam, signal), [cycleParam ?? ''])
  const data = result.data
  const showError = result.status === 'error'
  const showLoading = result.status === 'loading' && !data
  const state = showLoading ? 'loading' : 'ready'
  const summary = data?.summary
  const progress = summary?.progress
  const cycle = data?.cycle ?? null
  // The cycle in use, taken from the answer: when no cycle was asked for, this is the open one.
  const cycleId = cycleParam ?? cycle?.id

  const hint = (text: string) => (showLoading ? 'Loading…' : text)
  const untouched = !!progress && progress.scope > 0 && progress.completed + progress.inProgress + progress.unableToInspect === 0

  function chooseCycle(id: string) {
    setSearchParams({ cycle: id })
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Audit</h1>
          <p>Annual room-by-room equipment inspection across the college blocks.</p>
        </div>
        <span className="demo-note">Demonstration data</span>
      </div>

      {!showError && <CycleBar current={cycle} onChange={chooseCycle} />}

      {/* On a failed load only the one error below is shown: cards could only show dashes, and each would announce itself. */}
      {!showError && (
        <section className="stat-grid" aria-label="Inspection progress">
          <StatCard
            label="Rooms to inspect"
            value={progress?.scope ?? 0}
            hint={hint(summary ? `${plural(summary.blocks, 'block')}, ${plural(summary.floors, 'floor')}; retired rooms are not counted` : '')}
            state={state}
          />
          <StatCard
            label="Completed"
            value={progress ? (progress.percentComplete === null ? 'No rooms' : `${progress.completed} (${progress.percentComplete}%)`) : 0}
            hint={hint(progress ? describeProgress(progress) : '')}
            state={state}
          />
          <StatCard
            label="Still to inspect"
            value={progress ? progress.notStarted + progress.inProgress : 0}
            hint={hint(progress ? `${progress.notStarted} not started · ${progress.inProgress} in progress` : '')}
            state={state}
          />
          <StatCard
            label="Unable to inspect"
            value={progress?.unableToInspect ?? 0}
            hint={hint(progress ? (progress.unableToInspect > 0 ? 'Rooms visited but not inspected, with a reason' : 'No rooms have been skipped') : '')}
            state={state}
          />
        </section>
      )}

      {untouched && cycle?.status === 'Open' && (
        <p className="section-note">No inspections have been recorded in this cycle yet. Every room below is waiting to be inspected.</p>
      )}

      <section className="card" aria-labelledby="blocks-heading">
        <div className="card__header">
          <h2 id="blocks-heading">Blocks</h2>
        </div>

        {showLoading && <LoadingState label="Loading blocks…" />}

        {showError && (
          <ErrorState
            title={result.error.status === 404 ? 'Inspection cycle not found' : 'Blocks could not be loaded'}
            message={result.error.status === 404 ? 'That inspection cycle does not exist. Choose one from the audit overview.' : result.error.message}
            onRetry={result.error.status === 404 ? undefined : result.reload}
          />
        )}
        {showError && result.error.status === 404 && cycleParam && (
          <p className="card__body">
            <Link className="table-link" to="/audit">
              Show the current cycle
            </Link>
          </p>
        )}

        {data && !showError && (
          <div className="results" aria-busy={result.status === 'loading'}>
            {data.data.length === 0 ? (
              <EmptyState title="There are no blocks yet">
                <p>Blocks and rooms appear here once the room inventory has been set up.</p>
              </EmptyState>
            ) : (
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Blocks table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Block</th>
                      <th scope="col">Floors</th>
                      <th scope="col">Rooms</th>
                      <th scope="col">Inspection progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((block) => (
                      <tr key={block.id}>
                        <th scope="row" className="data-table__primary">
                          <Link className="table-link" to={withCycle(`/audit/blocks/${encodeURIComponent(block.id)}`, cycleId)}>
                            {block.name}
                          </Link>
                        </th>
                        <td className="nowrap">{block.floorCount}</td>
                        <td className="nowrap">
                          {block.roomCount}
                          {block.retiredRoomCount > 0 && <span className="muted"> (+{block.retiredRoomCount} retired)</span>}
                        </td>
                        <td className="nowrap">
                          {block.progress.percentComplete === null ? (
                            <span className="muted">No rooms to inspect</span>
                          ) : (
                            <>
                              <ProgressBar value={block.progress.percentComplete} />
                              <span className="data-table__sub">
                                {describeProgress(block.progress)}
                                {describeRemaining(block.progress) && ` · ${describeRemaining(block.progress)}`}
                              </span>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  )
}
