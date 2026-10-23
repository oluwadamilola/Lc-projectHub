import { Link } from 'react-router-dom'
import { PROJECT_STATUSES, type Project, type ProjectStatus } from '@lc-projecthub/shared'
import { getProjects } from '../api/projects'
import { ProgressBar } from '../components/ProgressBar'
import { ErrorState, LoadingState } from '../components/StateMessage'
import { SampleBadge } from '../components/SampleBadge'
import { StatCard } from '../components/StatCard'
import { StatusBadge } from '../components/StatusBadge'
import { OverdueTasksCard } from '../components/OverdueTasksCard'
import { TasksDueThisWeekCard } from '../components/TasksDueThisWeekCard'
import { demoActivity, demoMilestones, demoStats } from '../data/demoData'
import { useApiResource } from '../hooks/useApiResource'
import { useDashboardTasks } from '../hooks/useDashboardTasks'
import { formatDate } from '../lib/format'

const statusFills: Record<ProjectStatus, string> = {
  'On track': 'var(--chart-1)',
  'At risk': 'var(--chart-3)',
  Delayed: 'var(--chart-5)',
  Planning: 'var(--chart-2)',
  Complete: 'var(--chart-4)',
}

const GLANCE_COUNT = 6
// The dashboard summarises every project, so ask for the largest page the API allows.
const DASHBOARD_PAGE_SIZE = 100

export function Dashboard() {
  const result = useApiResource((signal) => getProjects({ pageSize: DASHBOARD_PAGE_SIZE }, signal), [])
  const data = result.data

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>An overview of IT project activity.</p>
        </div>
        <span className="demo-note">Demonstration data</span>
      </div>

      {!data && result.status === 'loading' && <LoadingState label="Loading dashboard…" />}
      {!data && result.status === 'error' && (
        <section className="card">
          <ErrorState title="The dashboard could not be loaded" message={result.error.message} onRetry={result.reload} />
        </section>
      )}

      {data && <DashboardContent projects={data.data} total={data.meta.total} />}
    </>
  )
}

function DashboardContent({ projects, total }: { projects: Project[]; total: number }) {
  // The API returns at most one page, so for very large datasets the figures below cover only part of the data.
  const partial = total > projects.length
  // One load of every task serves all the task figures below, so they always agree and add no extra requests.
  const tasks = useDashboardTasks(projects)
  const active = projects.filter((project) => project.status !== 'Complete')
  const attention = projects.filter((project) => project.status === 'At risk' || project.status === 'Delayed')
  const counts = PROJECT_STATUSES.map((status) => ({
    status,
    count: projects.filter((project) => project.status === status).length,
  }))
  // Unfinished projects, soonest deadline first.
  const upcoming = [...active].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, GLANCE_COUNT)

  return (
    <>
      {partial && (
        <p className="notice" role="note">
          Project figures on this page are based on the first {projects.length} of {total} projects.
        </p>
      )}
      <section className="stat-grid" aria-label="Key figures">
        <StatCard label="Active projects" value={active.length} hint={`${total} projects in total`} />
        <StatCard label="Need attention" value={attention.length} hint="At risk or delayed" />
        <TasksDueThisWeekCard result={tasks} projectCount={projects.length} partialProjects={partial} />
        <OverdueTasksCard result={tasks} projectCount={projects.length} partialProjects={partial} />
        <StatCard
          label="Equipment deployed"
          value={`${demoStats.equipmentDeployed} / ${demoStats.equipmentTotal}`}
          hint="Items assigned to projects"
          sample
        />
      </section>

      <div className="dashboard-grid">
        <section className="card" aria-labelledby="projects-heading">
          <div className="card__header">
            <h2 id="projects-heading">Projects at a glance</h2>
            <p className="section-note">Unfinished projects, nearest deadline first.</p>
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
                  {upcoming.map((project) => (
                    <tr key={project.id}>
                      <th scope="row" className="data-table__primary">
                        <Link className="table-link" to={`/projects/${project.id}`}>
                          {project.name}
                        </Link>
                      </th>
                      <td>{project.location}</td>
                      <td>{project.lead}</td>
                      <td className="nowrap">
                        <StatusBadge status={project.status} />
                      </td>
                      <td className="nowrap">
                        <ProgressBar value={project.progress} />
                      </td>
                      <td className="nowrap">{formatDate(project.dueDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="results-summary">
              <Link to="/projects">View all {total} projects</Link>
            </p>
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
            <div className="card__header card__header--split">
              <h2 id="milestones-heading">Upcoming milestones</h2>
              <SampleBadge />
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
        <div className="card__header card__header--split">
          <h2 id="activity-heading">Recent activity</h2>
          <SampleBadge />
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
