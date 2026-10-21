import { StatCard } from '../components/StatCard'
import { StatusBadge } from '../components/StatusBadge'
import {
  demoActivity,
  demoMilestones,
  demoProjects,
  demoStats,
  type ProjectStatus,
} from '../data/demoData'

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const formatDate = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00`))

const statusFills: Record<ProjectStatus, string> = {
  'On track': 'var(--chart-1)',
  'At risk': 'var(--chart-3)',
  Delayed: 'var(--chart-5)',
  Planning: 'var(--chart-2)',
  Complete: 'var(--chart-4)',
}
const statusOrder: ProjectStatus[] = ['On track', 'At risk', 'Delayed', 'Planning', 'Complete']

export function Dashboard() {
  const active = demoProjects.filter((project) => project.status !== 'Complete')
  const attention = demoProjects.filter((project) => project.status === 'At risk' || project.status === 'Delayed')
  const counts = statusOrder.map((status) => ({
    status,
    count: demoProjects.filter((project) => project.status === status).length,
  }))

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>An overview of IT project activity.</p>
        </div>
        <span className="demo-note">Demonstration data</span>
      </div>

      <section className="stat-grid" aria-label="Key figures">
        <StatCard label="Active projects" value={active.length} hint={`${demoProjects.length} projects in total`} />
        <StatCard label="Need attention" value={attention.length} hint="At risk or delayed" />
        <StatCard label="Tasks due this week" value={demoStats.tasksDueThisWeek} hint="Across all projects" />
        <StatCard
          label="Equipment deployed"
          value={`${demoStats.equipmentDeployed} / ${demoStats.equipmentTotal}`}
          hint="Items assigned to projects"
        />
      </section>

      <div className="dashboard-grid">
        <section className="card" aria-labelledby="projects-heading">
          <div className="card__header">
            <h2 id="projects-heading">Projects at a glance</h2>
          </div>
          <div className="card__body card__body--flush">
            <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="projects-heading">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Location</th>
                    <th scope="col">Lead</th>
                    <th scope="col">Status</th>
                    <th scope="col">Progress</th>
                    <th scope="col">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {demoProjects.map((project) => (
                    <tr key={project.id}>
                      <th scope="row" className="data-table__primary">
                        {project.name}
                      </th>
                      <td>{project.location}</td>
                      <td>{project.lead}</td>
                      <td className="nowrap">
                        <StatusBadge status={project.status} />
                      </td>
                      <td className="nowrap">
                        <div className="progress">
                          <div className="progress__track" aria-hidden="true">
                            <div className="progress__fill" style={{ width: `${project.progress}%` }} />
                          </div>
                          <span className="progress__label">{project.progress}%</span>
                        </div>
                      </td>
                      <td className="nowrap">{formatDate(project.dueDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div className="stack">
          <section className="card" aria-labelledby="status-heading">
            <div className="card__header">
              <h2 id="status-heading">Status breakdown</h2>
            </div>
            <div className="card__body">
              <div className="status-bar" aria-hidden="true">
                {counts
                  .filter(({ count }) => count > 0)
                  .map(({ status, count }) => (
                    <div
                      key={status}
                      className="status-bar__segment"
                      style={{ flexGrow: count, background: statusFills[status] }}
                    />
                  ))}
              </div>
              <ul className="legend">
                {counts.map(({ status, count }) => (
                  <li key={status}>
                    <span className="legend__swatch" style={{ background: statusFills[status] }} aria-hidden="true" />
                    {status}
                    <span className="legend__count">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="card" aria-labelledby="milestones-heading">
            <div className="card__header">
              <h2 id="milestones-heading">Upcoming milestones</h2>
            </div>
            <div className="card__body">
              <ul>
                {demoMilestones.map((milestone) => (
                  <li key={milestone.id} className="list-item">
                    <div>
                      <p className="list-item__title">{milestone.title}</p>
                      <p className="list-item__meta">{milestone.project}</p>
                    </div>
                    <time className="list-item__date" dateTime={milestone.dueDate}>
                      {formatDate(milestone.dueDate)}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>

      <section className="card" aria-labelledby="activity-heading" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card__header">
          <h2 id="activity-heading">Recent activity</h2>
        </div>
        <div className="card__body">
          <ul>
            {demoActivity.map((entry) => (
              <li key={entry.id} className="list-item">
                <div>
                  <p className="list-item__title">{entry.summary}</p>
                  <p className="list-item__meta">{entry.actor}</p>
                </div>
                <span className="list-item__date">{entry.when}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}
