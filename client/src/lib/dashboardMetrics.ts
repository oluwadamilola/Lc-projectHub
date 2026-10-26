import type { WeekRange } from '@lc-projecthub/shared'

/*
  Dashboard presentation helpers. The rules themselves ("outstanding", "overdue", "due this week") live in the
  shared package so the server's task filters and the dashboard can never disagree; they are re-exported here
  so the dashboard keeps one import.
*/

export {
  countOverdueTasks,
  countTasksDueInWeek,
  isOutstandingAndDueInWeek,
  isTaskOverdue,
  toIsoDate,
  weekRange,
  type WeekRange,
} from '@lc-projecthub/shared'

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

function formatWeekDay(iso: string): string {
  const parts = dayFormat.formatToParts(new Date(`${iso}T00:00:00`))
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')}`
}

/** For example "Mon 8 Jun – Sun 14 Jun". */
export function describeWeek(week: WeekRange): string {
  return `${formatWeekDay(week.start)} – ${formatWeekDay(week.end)}`
}
