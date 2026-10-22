import type { Technician, TaskPriority, TaskStatus } from '@lc-projecthub/shared'
import type { TaskRecord } from '../domain/taskRepository.js'

/*
  FICTIONAL DEMONSTRATION DATA ONLY.
  Technicians, tasks and dates are invented. No college systems or real records are used.
  Task dates are generated relative to today so the demo always looks current. Each task belongs
  to one of the seeded projects (PRJ-101 to PRJ-112).
*/

export const seedTechnicians: Technician[] = [
  { id: 'TECH-001', name: 'Riley Hart', team: 'Service Desk' },
  { id: 'TECH-002', name: 'Morgan Blake', team: 'Infrastructure' },
  { id: 'TECH-003', name: 'Avery Singh', team: 'Infrastructure' },
  { id: 'TECH-004', name: 'Devon Okoye', team: 'Digital Learning' },
  { id: 'TECH-005', name: 'Sasha Novak', team: 'Information Security' },
  { id: 'TECH-006', name: 'Quinn Mercer', team: 'Estates Technology' },
]

type SeedTask = [
  projectId: string,
  title: string,
  description: string,
  status: TaskStatus,
  priority: TaskPriority,
  assigneeId: string | null,
  startOffsetDays: number,
  dueOffsetDays: number,
]

const seed: SeedTask[] = [
  ['PRJ-101', 'Survey signal coverage', 'Walk each floor and record weak spots.', 'Done', 'High', 'TECH-002', -58, -40],
  ['PRJ-101', 'Order access points', 'Raise the purchase request for 24 access points.', 'Done', 'Medium', 'TECH-003', -45, -30],
  ['PRJ-101', 'Install access points on floors 1 and 2', 'Mount, cable and label each unit.', 'In progress', 'High', 'TECH-002', -10, 6],
  ['PRJ-101', 'Configure wireless controller', 'Create SSIDs and apply the security policy.', 'To do', 'High', 'TECH-003', 3, 14],
  ['PRJ-101', 'Retest coverage and handover', 'Repeat the survey and sign off with the library team.', 'To do', 'Medium', null, 14, 21],
  ['PRJ-102', 'Specify projector and microphone kit', 'Agree the specification with teaching staff.', 'Done', 'High', 'TECH-004', -44, -28],
  ['PRJ-102', 'Get procurement sign-off', 'Waiting on a quote from the supplier.', 'Blocked', 'Critical', 'TECH-004', -20, 3],
  ['PRJ-102', 'Install lecture-capture units', 'Fit capture units in three theatres.', 'To do', 'High', 'TECH-006', 4, 12],
  ['PRJ-102', 'Train teaching staff', 'Run two short sessions on the new equipment.', 'To do', 'Low', 'TECH-001', 10, 14],
  ['PRJ-103', 'Image the loan laptops', 'Apply the standard build to all 40 laptops.', 'In progress', 'High', 'TECH-001', -12, 7],
  ['PRJ-103', 'Build the booking form', 'Self-service form for students to reserve a laptop.', 'Done', 'Medium', 'TECH-004', -50, -20],
  ['PRJ-103', 'Label and shelve devices', 'Barcode every laptop and charger.', 'To do', 'Low', null, 5, 9],
  ['PRJ-104', 'Re-issue the cabling survey', 'The first survey missed two bays.', 'In progress', 'Critical', 'TECH-003', -8, 12],
  ['PRJ-104', 'Run cable trays', 'Fit trays along the north wall.', 'Blocked', 'High', 'TECH-006', -30, -5],
  ['PRJ-104', 'Terminate and test network points', 'Terminate 36 points and certify each run.', 'To do', 'High', 'TECH-002', 8, 25],
  ['PRJ-105', 'Choose screen locations', 'Walk the main entrance with Estates.', 'To do', 'Low', 'TECH-006', 7, 20],
  ['PRJ-105', 'Select content management tool', 'Compare three options against the shortlist.', 'To do', 'Medium', 'TECH-004', 10, 30],
  ['PRJ-106', 'Migrate departmental printers', 'Move each printer to the managed service.', 'Done', 'Medium', 'TECH-001', -110, -60],
  ['PRJ-106', 'Retire old print servers', 'Switch off and wipe the legacy servers.', 'Done', 'Low', 'TECH-002', -70, -25],
  ['PRJ-107', 'Enrol the first pilot group', 'Twenty staff volunteers enrol their devices.', 'Done', 'High', 'TECH-005', -38, -18],
  ['PRJ-107', 'Roll out to teaching departments', 'Enrol staff department by department.', 'In progress', 'Critical', 'TECH-005', -15, 20],
  ['PRJ-107', 'Write the help-desk guide', 'Common problems and fixes for the service desk.', 'To do', 'Medium', 'TECH-001', 5, 18],
  ['PRJ-108', 'Replace cooling unit A', 'Schedule the change outside term time.', 'In progress', 'Critical', 'TECH-006', -14, 10],
  ['PRJ-108', 'Fit temperature sensors', 'Add alerts that email the on-call engineer.', 'To do', 'High', 'TECH-002', 6, 22],
  ['PRJ-110', 'Redesign request forms', 'Cut the number of fields on the top five forms.', 'In progress', 'Medium', 'TECH-004', -20, 14],
  ['PRJ-110', 'Test the new portal with staff', 'Ten staff try the main tasks and give feedback.', 'To do', 'Medium', 'TECH-001', 12, 30],
  ['PRJ-111', 'Choose camera positions', 'Agree coverage with the sports team.', 'Done', 'Low', 'TECH-006', -70, -50],
  ['PRJ-111', 'Install network cameras', 'Waiting for the delayed delivery.', 'Blocked', 'Medium', null, -40, -3],
  ['PRJ-112', 'Wipe and recycle retired laptops', 'Certified wipe, then collect for recycling.', 'Done', 'Low', 'TECH-001', -140, -50],
]

function isoDateFromToday(today: Date, offsetDays: number): string {
  const date = new Date(today)
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

export function buildSeedTasks(today: Date = new Date()): TaskRecord[] {
  return seed.map(([projectId, title, description, status, priority, assigneeId, startOffset, dueOffset], index) => ({
    id: `TASK-${String(index + 1).padStart(3, '0')}`,
    projectId,
    title,
    description,
    status,
    priority,
    assigneeId,
    startDate: isoDateFromToday(today, startOffset),
    dueDate: isoDateFromToday(today, dueOffset),
  }))
}
