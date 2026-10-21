import { SampleBadge } from './SampleBadge'

interface StatCardProps {
  label: string
  value: string | number
  hint: string
  /** True when the figure is hard-coded demo data rather than calculated from the API. */
  sample?: boolean
}

export function StatCard({ label, value, hint, sample = false }: StatCardProps) {
  return (
    <div className="card stat-card">
      <div className="stat-card__top">
        <p className="stat-card__label">{label}</p>
        {sample && <SampleBadge />}
      </div>
      <p className="stat-card__value">{value}</p>
      <p className="stat-card__hint">{hint}</p>
    </div>
  )
}
