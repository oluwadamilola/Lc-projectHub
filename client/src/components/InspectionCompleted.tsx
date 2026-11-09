import { Link } from 'react-router-dom'
import type { InspectionView } from '@lc-projecthub/shared'
import { EQUIPMENT_CONDITIONS } from '@lc-projecthub/shared'
import { formatWhen, plural, withCycle } from '../lib/audit'
import { ConditionBadge } from './AuditBadges'

/**
 * What a completed inspection found: counts by condition, the faults, replacements and missing items reported, failed
 * checks, and equipment found that needs review. Reporting only: the issue-management system comes in a later stage.
 */
export function InspectionCompleted({ view }: { view: InspectionView }) {
  const summary = view.summary
  const roomPath = withCycle(`/audit/rooms/${encodeURIComponent(view.room.id)}`, view.cycle.id)
  const floorPath = withCycle(`/audit/blocks/${encodeURIComponent(view.room.blockId)}/floors/${encodeURIComponent(view.room.floorId)}`, view.cycle.id)
  const issueCount = (summary?.issues.length ?? 0) + (summary?.checkIssues.length ?? 0)

  return (
    <>
      <div className="notice notice--success" role="status">
        Inspection completed for room {view.room.code}
        {view.completedAt ? ` on ${formatWhen(view.completedAt)}` : ''}
        {view.inspectorName ? ` by ${view.inspectorName}` : ''}. Every answer has been saved.
      </div>

      {summary && (
        <>
          <section className="card" aria-labelledby="summary-heading">
            <div className="card__header">
              <h2 id="summary-heading">Summary</h2>
            </div>
            <div className="card__body">
              {summary.noEquipmentConfirmed ? (
                <p>You confirmed that this room has no equipment to inspect.</p>
              ) : (
                <>
                  <p>
                    {plural(summary.totalItems, 'item')} checked. {issueCount === 0 ? 'No issues were reported.' : `${plural(issueCount, 'issue')} reported.`}
                  </p>
                  <ul className="summary-counts">
                    {EQUIPMENT_CONDITIONS.map((condition) => (
                      <li key={condition}>
                        <ConditionBadge condition={condition} /> <strong>{summary.counts[condition]}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>

          {issueCount > 0 && (
            <section className="card" aria-labelledby="issues-heading">
              <div className="card__header">
                <h2 id="issues-heading">Issues reported</h2>
              </div>
              <div className="card__body">
                <ul className="issue-list">
                  {summary.issues.map((issue) => (
                    <li key={`${issue.equipmentItemId}-${issue.kind}`}>
                      <strong>{issue.label}</strong> <span className="badge badge--danger">{issue.kind}</span>
                      <span className="check-item__meta">{issue.note}</span>
                    </li>
                  ))}
                  {summary.checkIssues.map((issue) => (
                    <li key={`${issue.equipmentItemId}-${issue.checkId}`}>
                      <strong>{issue.label}</strong> <span className="badge badge--warning">{issue.checkLabel}: {issue.answer}</span>
                      <span className="check-item__meta">{issue.note}</span>
                    </li>
                  ))}
                </ul>
                <p className="muted">These are recorded with the inspection. Following issues up until they are resolved arrives in a later stage.</p>
              </div>
            </section>
          )}

          {summary.foundItems.length > 0 && (
            <section className="card" aria-labelledby="found-heading">
              <div className="card__header">
                <h2 id="found-heading">Equipment found, needing review</h2>
              </div>
              <div className="card__body">
                <ul className="issue-list">
                  {summary.foundItems.map((item) => (
                    <li key={item.equipmentItemId}>{item.label}</li>
                  ))}
                </ul>
                <p className="muted">These were added to the room&apos;s equipment and are flagged until the inventory is reviewed.</p>
              </div>
            </section>
          )}
        </>
      )}

      <div className="form-actions">
        <Link className="btn btn--primary btn--large" to={roomPath}>
          View the room&apos;s equipment and history
        </Link>
        <Link className="btn btn--large" to={floorPath}>
          Back to {view.room.floorName}, {view.room.blockName}
        </Link>
        <Link className="btn btn--large" to={withCycle('/audit', view.cycle.id)}>
          Audit overview
        </Link>
      </div>
    </>
  )
}
