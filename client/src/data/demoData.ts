/*
  FICTIONAL DEMONSTRATION DATA ONLY.
  Names, places and figures are invented. No college systems or real records are used.
  Dates are generated relative to today so the demo always looks current.
*/

export type ProjectStatus = 'On track' | 'At risk' | 'Delayed' | 'Planning' | 'Complete'

export interface DemoProject {
  id: string
  name: string
  location: string
  lead: string
  status: ProjectStatus
  progress: number
  dueDate: string
}

export interface DemoMilestone {
  id: string
  title: string
  project: string
  dueDate: string
}

export interface DemoActivity {
  id: string
  summary: string
  actor: string
  when: string
}

function daysFromNow(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export const demoUser = { name: 'Demo User', initials: 'DU' }

export const demoProjects: DemoProject[] = [
  {
    id: 'PRJ-101',
    name: 'Library Wi-Fi Upgrade',
    location: 'Demo Library',
    lead: 'Alex Morgan',
    status: 'On track',
    progress: 72,
    dueDate: daysFromNow(21),
  },
  {
    id: 'PRJ-102',
    name: 'Lecture Theatre AV Refresh',
    location: 'Demo Block A',
    lead: 'Priya Shah',
    status: 'At risk',
    progress: 45,
    dueDate: daysFromNow(14),
  },
  {
    id: 'PRJ-103',
    name: 'Student Laptop Loan Scheme',
    location: 'Demo Learning Hub',
    lead: 'Sam Okafor',
    status: 'On track',
    progress: 88,
    dueDate: daysFromNow(9),
  },
  {
    id: 'PRJ-104',
    name: 'Workshop Network Cabling',
    location: 'Demo Engineering Workshop',
    lead: 'Jordan Ellis',
    status: 'Delayed',
    progress: 31,
    dueDate: daysFromNow(-6),
  },
  {
    id: 'PRJ-105',
    name: 'Digital Signage Rollout',
    location: 'Demo Main Entrance',
    lead: 'Taylor Brooks',
    status: 'Planning',
    progress: 8,
    dueDate: daysFromNow(75),
  },
  {
    id: 'PRJ-106',
    name: 'Print Service Consolidation',
    location: 'Demo Block B',
    lead: 'Alex Morgan',
    status: 'Complete',
    progress: 100,
    dueDate: daysFromNow(-20),
  },
]

export const demoMilestones: DemoMilestone[] = [
  {
    id: 'MS-1',
    title: 'Access points installed',
    project: 'Library Wi-Fi Upgrade',
    dueDate: daysFromNow(4),
  },
  {
    id: 'MS-2',
    title: 'Projector procurement signed off',
    project: 'Lecture Theatre AV Refresh',
    dueDate: daysFromNow(7),
  },
  {
    id: 'MS-3',
    title: 'Loan pool imaging complete',
    project: 'Student Laptop Loan Scheme',
    dueDate: daysFromNow(10),
  },
  {
    id: 'MS-4',
    title: 'Cabling survey re-issued',
    project: 'Workshop Network Cabling',
    dueDate: daysFromNow(12),
  },
]

export const demoActivity: DemoActivity[] = [
  { id: 'A-1', summary: 'Updated progress on Library Wi-Fi Upgrade to 72%', actor: 'Alex Morgan', when: '2 hours ago' },
  { id: 'A-2', summary: 'Flagged Lecture Theatre AV Refresh as at risk', actor: 'Priya Shah', when: 'Yesterday' },
  { id: 'A-3', summary: 'Added 12 laptops to the loan pool', actor: 'Sam Okafor', when: 'Yesterday' },
  { id: 'A-4', summary: 'Closed Print Service Consolidation', actor: 'Alex Morgan', when: '3 days ago' },
]

export const demoStats = {
  tasksDueThisWeek: 14,
  equipmentDeployed: 126,
  equipmentTotal: 160,
}
