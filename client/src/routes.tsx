import type { RouteObject } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { navItems } from './data/navigation'
import { Dashboard } from './pages/Dashboard'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { ProjectCreatePage } from './pages/ProjectCreatePage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { ProjectEditPage } from './pages/ProjectEditPage'
import { ProjectsPage } from './pages/ProjectsPage'

/** Sections that have their own pages; everything else in the navigation shows "Coming soon". */
const BUILT_PATHS = ['/', '/projects']

/** Kept separate from the router so tests can render the real route tree in a memory router. */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/new', element: <ProjectCreatePage /> },
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'projects/:id/edit', element: <ProjectEditPage /> },
      ...navItems
        .filter((item) => !BUILT_PATHS.includes(item.path))
        .map((item) => ({ path: item.path.slice(1), element: <PlaceholderPage /> })),
      { path: '*', element: <PlaceholderPage /> },
    ],
  },
]
