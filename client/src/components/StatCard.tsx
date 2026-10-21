interface StatCardProps {
  label: string
  value: string | number
  hint: string
}

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="card stat-card">
      <p className="stat-card__label">{label}</p>
      <p className="stat-card__value">{value}</p>
      <p className="stat-card__hint">{hint}</p>
    </div>
  )
}
