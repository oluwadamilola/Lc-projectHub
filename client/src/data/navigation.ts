import type { IconName } from '../components/Icon'

export interface NavItem {
  label: string
  path: string
  icon: IconName
  description: string
}

export const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    path: '/',
    icon: 'dashboard',
    description: 'A summary of project activity across IT.',
  },
  {
    label: 'Projects',
    path: '/projects',
    icon: 'projects',
    description: 'Browse, create and manage IT projects.',
  },
  {
    label: 'Tasks',
    path: '/tasks',
    icon: 'tasks',
    description: 'Track tasks, owners and deadlines.',
  },
  {
    label: 'Locations',
    path: '/locations',
    icon: 'locations',
    description: 'See which buildings and rooms each project touches.',
  },
  {
    label: 'Equipment',
    path: '/equipment',
    icon: 'equipment',
    description: 'Manage hardware and assets assigned to projects.',
  },
  {
    label: 'Reports',
    path: '/reports',
    icon: 'reports',
    description: 'Generate progress and workload reports.',
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: 'settings',
    description: 'Configure the application and your preferences.',
  },
]
