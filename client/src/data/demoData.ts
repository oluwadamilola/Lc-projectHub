/*
  FICTIONAL DEMONSTRATION DATA ONLY.
  Names, places and figures are invented. No college systems or real records are used.
  Projects now come from the API; this file holds the dashboard content that has no API yet
  (milestones, activity and equipment figures). Task figures are calculated from the tasks API.
*/

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
  equipmentDeployed: 126,
  equipmentTotal: 160,
}
