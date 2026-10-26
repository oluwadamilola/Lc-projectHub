import type { RouteObject } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { navItems } from './data/navigation'
import { AllTasksPage } from './pages/AllTasksPage'
import { Dashboard } from './pages/Dashboard'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { ProjectCreatePage } from './pages/ProjectCreatePage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ProjectEditPage } from './pages/ProjectEditPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { TaskCreatePage } from './pages/TaskCreatePage'
import { TaskEditPage } from './pages/TaskEditPage'

/** Sections that have their own pages; everything else in the navigation shows "Coming soon". */
const BUILT_PATHS = ['/', '/projects', '/tasks']

/** Kept separate from the router so tests can render the real route tree in a memory router. */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'tasks', element: <AllTasksPage /> },
      { path: 'projects/new', element: <ProjectCreatePage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'projects/:id/edit', element: <ProjectEditPage /> },
      { path: 'projects/:id/tasks/new', element: <TaskCreatePage /> },
      { path: 'projects/:id/tasks/:taskId/edit', element: <TaskEditPage /> },
      ...navItems
        .filter((item) => !BUILT_PATHS.includes(item.path))
        .map((item) => ({ path: item.path.slice(1), element: <PlaceholderPage /> })),
      { path: '*', element: <PlaceholderPage /> },
    ],
  },
]
