import type { CycleSummary, InspectionCycle } from '@lc-projecthub/shared'
import { getAuditCycles } from '../api/audit'
import { useApiResource } from '../hooks/useApiResource'
import { formatDate } from '../lib/format'

interface CycleBarProps {
  /** The cycle the page is describing (from the page own response), or null if there are no cycles. */
  current: InspectionCycle | null
  /** Called with the chosen cycle reference. */
  onChange: (cycleId: string) => void
}

/**
 * Chooses which inspection cycle the page describes, and says whether it is open or closed. If the list of cycles
 * cannot be loaded the current cycle is still named, so the page never loses track of what it is showing.
 */
export function CycleBar({ current, onChange }: CycleBarProps) {
  const cycles = useApiResource((signal) => getAuditCycles(signal), [])
  const list: CycleSummary[] = cycles.data?.data ?? []
  if (!current) return null
  return (
    <div className="cycle-bar">
      <div className="field">
        <label className="field__label" htmlFor="audit-cycle">
          Inspection cycle
        </label>
        {list.length > 1 ? (
          <select id="audit-cycle" className="input" value={current.id} onChange={(event) => onChange(event.target.value)}>
            {list.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name} ({cycle.status.toLowerCase()})
              </option>
            ))}
          </select>
        ) : (
          <p id="audit-cycle" className="cycle-bar__single">
            {current.name}
          </p>
        )}
      </div>
      <p className="cycle-bar__note">
        <span className={`badge badge--${current.status === 'Open' ? 'info' : 'neutral'}`}>{current.status}</span>{' '}
        {formatDate(current.startDate)} to {formatDate(current.endDate)}
        {current.status === 'Closed' && ' · Closed: kept as a record.'}
      </p>
    </div>
  )
}
