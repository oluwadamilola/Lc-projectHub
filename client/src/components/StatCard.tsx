import { SampleBadge } from './SampleBadge'

interface StatCardProps {
  label: string
  value: string | number
  hint: string
  /** True when the figure is hard-coded demo data rather than calculated from the API. */
  sample?: boolean
  /**
   * "ready" shows the value. While data is "loading" or has failed ("error") the value is a dash and the
   * hint explains why, so an unknown figure is never shown as a number (especially not as 0).
   */
  state?: 'ready' | 'loading' | 'error'
  /** Offered when state is "error". */
  onRetry?: () => void
}

export function StatCard({ label, value, hint, sample = false, state = 'ready', onRetry }: StatCardProps) {
  return (
    <div className="card stat-card" aria-busy={state === 'loading'}>
      <div className="stat-card__top">
        <p className="stat-card__label">{label}</p>
        {sample && <SampleBadge />}
      </div>
      <p className="stat-card__value">
        {state === 'ready' ? value : <span aria-hidden="true">—</span>}
      </p>
      <p className="stat-card__hint" role={state === 'error' ? 'alert' : state === 'loading' ? 'status' : undefined}>
        {hint}
      </p>
      {state === 'error' && onRetry && (
        <button type="button" className="btn btn--small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
