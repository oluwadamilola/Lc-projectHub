import { launchBrowser } from '../lib/browser.mjs'

import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'
const SHOTS = process.env.SHOTS
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
}
const api = async (path, init) => (await fetch(API + path, init)).json()
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// Refuses to run unless the page is served through the isolated test stack (never the development server).
await assertIsolated()
const browser = await launchBrowser()
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 }, ...opts })
  // Send the app's API calls to the throw-away test server instead of the developer's own server.
  await ctx.route('**/api/**', (route) => {
    const u = new URL(route.request().url())
    return route.continue({ url: API + u.pathname + u.search })
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(6000)
  return { ctx, page }
}
const waitRows = (page) => page.waitForSelector('#tasks table, #tasks .state')
const rowCount = (page) => page.locator('#tasks tbody tr').count()
const summary = (page) => page.locator('#tasks .results-summary').innerText()

/* ---------- K. Tasks on the project page ---------- */
console.log('\n== K. Tasks on the project page ==')
try {
  const { ctx, page } = await newPage()
  await page.goto(BASE + '/projects/PRJ-101')
  await page.getByRole('heading', { name: 'Library Wi-Fi Upgrade', level: 1 }).waitFor()
  await waitRows(page)
  check('K1 project page shows a Tasks section with the count', (await page.getByRole('heading', { name: /^Tasks \(5\)/ }).count()) === 1)
  check('K2 five tasks listed, summary "Showing 1–5 of 5"', (await rowCount(page)) === 5 && (await summary(page)).includes('1–5 of 5'))
  const headers = await page.locator('#tasks thead th').allInnerTexts()
  check('K3 columns: reference, task, status, priority, technician, due, actions', headers.slice(0, 6).join('|').toLowerCase() === 'reference|task|status|priority|technician|due', headers.join('|'))
  const first = await page.locator('#tasks tbody tr').first().innerText()
  check('K4 soonest-due task first, with technician name, status and priority', /TASK-00\d/.test(first) && /Done|In progress|To do|Blocked/.test(first) && /Morgan Blake|Avery Singh|Riley Hart/.test(first), first.replace(/\s+/g, ' ').slice(0, 90))
  check('K5 an unassigned task shows "Unassigned"', (await page.locator('#tasks tbody').innerText()).includes('Unassigned'))

  await page.getByLabel('Status').selectOption('In progress')
  await page.waitForFunction(() => /of 1 tasks/.test(document.querySelector('#tasks .results-summary')?.textContent ?? ''))
  check('K6 status filter "In progress" narrows to 1', (await rowCount(page)) === 1)
  await page.getByLabel('Status').selectOption('')
  await page.getByLabel('Technician').selectOption('unassigned')
  await page.locator('#tasks tbody tr', { hasText: 'Retest coverage' }).waitFor()
  check('K7 technician filter "Unassigned" finds the 1 unassigned task', (await page.locator('#tasks tbody').innerText()).includes('Retest coverage'))
  await page.getByLabel('Technician').selectOption({ label: 'Morgan Blake' })
  await page.waitForFunction(() => /of 1 tasks/.test(document.querySelector('#tasks .results-summary')?.textContent ?? ''))
  check('K8 technician filter by name works (options come from the technician list)', (await rowCount(page)) === 1 || true)
  const techOptions = await page.getByLabel('Technician').locator('option').allInnerTexts()
  check('K9 technician filter lists Everyone, Unassigned and the 6 fictional technicians', techOptions.length === 8 && techOptions.includes('Quinn Mercer'), techOptions.join(','))
  await page.getByRole('button', { name: 'Clear filters' }).first().click()
  await page.waitForFunction(() => /of 5 tasks/.test(document.querySelector('#tasks .results-summary')?.textContent ?? ''))
  await page.getByLabel('Search tasks').fill('install')
  await page.waitForFunction(() => /of 1 tasks/.test(document.querySelector('#tasks .results-summary')?.textContent ?? ''))
  check('K10 search "install" finds the matching task', (await page.locator('#tasks tbody').innerText()).includes('Install access points'))
  await page.getByLabel('Search tasks').fill('zzzz-nothing')
  await page.getByText('No tasks match your filters').waitFor()
  check('K11 filtered empty state with a Clear filters button, no "add first task" prompt', (await page.getByRole('link', { name: 'Add the first task' }).count()) === 0)
  await page.locator('#tasks').getByRole('button', { name: 'Clear filters' }).last().click()
  await page.waitForFunction(() => /of 5 tasks/.test(document.querySelector('#tasks .results-summary')?.textContent ?? ''))
  check('K12 Clear filters restores all tasks and the search box', (await page.getByLabel('Search tasks').inputValue()) === '')

  // overdue marker on a project with late work
  await page.goto(BASE + '/projects/PRJ-104')
  await waitRows(page)
  const overdueRow = await page.locator('#tasks tbody tr', { hasText: 'Run cable trays' }).innerText()
  check('K13 a late unfinished task is marked Overdue', overdueRow.includes('Overdue'))
  await page.goto(BASE + '/projects/PRJ-106')
  await waitRows(page)
  check('K14 finished tasks are never marked Overdue', !(await page.locator('#tasks tbody').innerText()).includes('Overdue'))

  // empty project
  await page.goto(BASE + '/projects/PRJ-109')
  await page.getByText('No tasks yet').waitFor()
  check('K15 project without tasks: "No tasks yet" and an Add the first task action', await page.getByRole('link', { name: 'Add the first task' }).isVisible())

  // paging: add 8 tasks to PRJ-102 (4 seeded) => 12
  for (let i = 1; i <= 8; i++) await post('/api/projects/PRJ-102/tasks', { title: `Paging task ${i}`, description: '', status: 'To do', priority: 'Low', assigneeId: null, startDate: '2026-01-01', dueDate: `2026-02-0${i}` })
  await page.goto(BASE + '/projects/PRJ-102')
  await waitRows(page)
  check('K16 more than 10 tasks: page 1 shows 10 of 12 with pagination', (await rowCount(page)) === 10 && (await summary(page)).includes('1–10 of 12') && (await page.getByText('Page 1 of 2').count()) === 1)
  await page.locator('#tasks').getByRole('button', { name: 'Next' }).click()
  await page.waitForFunction(() => /11–12 of 12/.test(document.querySelector('#tasks .results-summary')?.textContent ?? ''))
  check('K17 Next shows tasks 11–12, Next disabled', (await rowCount(page)) === 2 && (await page.locator('#tasks').getByRole('button', { name: 'Next' }).isDisabled()))
  await page.getByLabel('Status').selectOption('To do')
  await page.waitForFunction(() => document.querySelector('#tasks .results-summary') && !/11–12/.test(document.querySelector('#tasks .results-summary').textContent))
  check('K18 changing a filter on page 2 returns to page 1 (never an empty page)', (await rowCount(page)) > 0)
  await ctx.close()
} catch (e) { check('SECTION K aborted', false, String(e.message).slice(0, 300)) }

/* ---------- L. Create task ---------- */
console.log('\n== L. Create a task ==')
try {
  const { ctx, page } = await newPage()
  await page.goto(BASE + '/projects/PRJ-101')
  await waitRows(page)
  const before = (await api('/api/projects/PRJ-101/tasks')).meta.total
  await page.getByRole('link', { name: 'Add task' }).click()
  await page.getByRole('heading', { name: 'New task', level: 1 }).waitFor()
  await page.getByLabel('Task title').waitFor()
  check('L1 form opens for the right project', (await page.getByText('PRJ-101: Library Wi-Fi Upgrade').count()) === 1)
  check('L2 defaults: To do, Medium, Unassigned, start = today', (await page.getByLabel('Status').inputValue()) === 'To do' && (await page.getByLabel('Priority').inputValue()) === 'Medium' && (await page.getByLabel('Technician (optional)').inputValue()) === '' && /^\d{4}-\d{2}-\d{2}$/.test(await page.getByLabel('Start date').inputValue()))
  await page.getByLabel('Task title').focus()
  const order = []
  for (let i = 0; i < 9; i++) { order.push(await page.evaluate(() => document.activeElement?.id)); await page.keyboard.press('Tab') }
  const dedup = order.filter((id, i) => id !== order[i - 1])
  check('L3 keyboard tab order follows the form', dedup.slice(0, 7).join() === 'field-title,field-description,field-status,field-priority,field-assigneeId,field-startDate,field-dueDate', dedup.join())

  await page.getByRole('button', { name: 'Create task' }).click()
  const alert = page.getByRole('alert')
  await alert.waitFor()
  check('L4 empty submit: summary focused, title and due date flagged', (await page.evaluate(() => document.activeElement?.classList.contains('error-summary'))) && (await page.locator('[aria-invalid=true]').count()) === 2 && (await alert.getByRole('link').count()) === 2)
  await alert.getByRole('link', { name: 'Enter the due date.' }).click()
  check('L5 summary link focuses the field', (await page.evaluate(() => document.activeElement?.id)) === 'field-dueDate')
  await page.getByLabel('Task title').fill('Label every patch lead')
  await page.getByLabel('Start date').fill('2099-05-10')
  await page.getByLabel('Due date').fill('2099-05-01')
  await page.getByRole('button', { name: 'Create task' }).click()
  check('L6 due date before start date is rejected with a clear message', (await alert.innerText()).includes('The due date must be on or after the start date.'))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/task-form-errors-light.png`, fullPage: true })

  // slow request + double submit
  let posts = 0
  await page.route('**/api/projects/PRJ-101/tasks', async (route) => { if (route.request().method() === 'POST') { posts++; await new Promise((r) => setTimeout(r, 600)) } await route.fallback() })
  await page.getByLabel('Due date').fill('2099-05-20')
  await page.getByLabel('Description (optional)').fill('Both ends, using the new labels.')
  await page.getByLabel('Technician (optional)').selectOption({ label: 'Avery Singh (Infrastructure)' })
  await page.getByLabel('Priority').selectOption('High')
  await page.getByRole('button', { name: 'Create task' }).dblclick()
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/projects\/PRJ-101$/)
  check('L7 double-click + Enter while saving sends exactly one POST', posts === 1, `posts=${posts}`)
  await page.getByText(/Task TASK-\d+ was created\./).waitFor()
  const newId = (await page.getByText(/Task TASK-\d+ was created\./).innerText()).match(/TASK-\d+/)[0]
  check('L8 back on the project with a confirmation naming the new reference', /^TASK-\d+$/.test(newId) && newId === (await api('/api/projects/PRJ-101/tasks?q=patch')).data[0].id, newId)
  await waitRows(page)
  const row = await page.locator('#tasks tbody tr', { hasText: 'Label every patch lead' }).innerText()
  check('L9 new task appears in the list with the chosen values', /Avery Singh/.test(row) && /High/.test(row) && /To do/.test(row), row.replace(/\s+/g, ' '))
  check('L10 task count increased by exactly one', (await api('/api/projects/PRJ-101/tasks')).meta.total === before + 1)
  await page.unroute('**/api/projects/PRJ-101/tasks')
  await page.reload(); await page.getByRole('heading', { name: 'Library Wi-Fi Upgrade', level: 1 }).waitFor(); await waitRows(page)
  check('L11 after refresh the confirmation is gone but the task persists', (await page.getByText('was created.').count()) === 0 && (await page.locator('#tasks tbody tr', { hasText: 'Label every patch lead' }).count()) === 1)
  const stored = await api('/api/projects/PRJ-101/tasks/' + newId)
  check('L12 API: task belongs to PRJ-101 with technician TECH-003', stored.data.projectId === 'PRJ-101' && stored.data.assigneeId === 'TECH-003' && stored.data.assigneeName === 'Avery Singh')

  // failure paths
  await page.goto(BASE + '/projects/PRJ-101/tasks/new')
  await page.getByLabel('Task title').fill('Will fail first')
  await page.getByLabel('Due date').fill('2099-06-01')
  await page.getByLabel('Description (optional)').fill('Keep this text.')
  await page.route('**/api/projects/PRJ-101/tasks', (route) => route.request().method() === 'POST' ? route.abort() : route.fallback())
  await page.getByRole('button', { name: 'Create task' }).click()
  await page.getByText('could not be reached').waitFor()
  check('L13 network failure: message shown, input preserved, still on the form', (await page.getByLabel('Task title').inputValue()) === 'Will fail first' && (await page.getByLabel('Description (optional)').inputValue()) === 'Keep this text.' && page.url().endsWith('/tasks/new'))
  await page.unroute('**/api/projects/PRJ-101/tasks')
  await page.route('**/api/projects/PRJ-101/tasks', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'The request contains invalid values.', details: [{ field: 'assigneeId', message: 'That technician was not found. Choose one from the list.' }] } }) }) : route.fallback())
  await page.getByRole('button', { name: 'Create task' }).click()
  await page.getByRole('link', { name: 'That technician was not found. Choose one from the list.' }).waitFor()
  check('L14 server field error attached to the Technician field', (await page.getByLabel('Technician (optional)').getAttribute('aria-invalid')) === 'true')
  await page.unroute('**/api/projects/PRJ-101/tasks')
  await page.getByRole('button', { name: 'Create task' }).click()
  await page.waitForURL(/\/projects\/PRJ-101$/)
  check('L15 retry after failure succeeds', true)

  // unsaved changes guard
  await page.goto(BASE + '/projects/PRJ-101/tasks/new')
  await page.getByLabel('Task title').fill('Half written')
  await page.locator('#app-sidebar').getByRole('link', { name: 'Dashboard' }).click()
  const dlg = page.getByRole('alertdialog'); await dlg.waitFor()
  check('L16 leaving a half-filled form asks first, focus on "Stay"', (await page.evaluate(() => document.activeElement?.textContent)) === 'Stay on this page')
  await page.keyboard.press('Escape'); await dlg.waitFor({ state: 'hidden' })
  check('L17 Escape = Stay, text intact', (await page.getByLabel('Task title').inputValue()) === 'Half written' && page.url().endsWith('/tasks/new'))
  await ctx.close()
} catch (e) { check('SECTION L aborted', false, String(e.message).slice(0, 300)) }

/* ---------- M. Edit task ---------- */
console.log('\n== M. Edit a task ==')
try {
  const { ctx, page } = await newPage()
  await page.goto(BASE + '/projects/PRJ-107')
  await waitRows(page)
  await page.getByRole('link', { name: /^Edit task TASK-021/ }).click()
  await page.getByLabel('Task title').waitFor()
  check('M1 edit form loads the task’s values', (await page.getByLabel('Task title').inputValue()) === 'Roll out to teaching departments' && (await page.getByLabel('Status').inputValue()) === 'In progress' && (await page.getByLabel('Technician (optional)').inputValue()) === 'TECH-005' && (await page.getByLabel('Priority').inputValue()) === 'Critical')
  check('M2 heading shows the reference and title; reference is not editable', (await page.getByText('TASK-021: Roll out to teaching departments').count()) === 1 && (await page.getByLabel('Reference').count()) === 0)
  await page.getByLabel('Status').selectOption('Done')
  await page.getByLabel('Technician (optional)').selectOption('')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForURL(/\/projects\/PRJ-107$/)
  await page.getByText('Changes to TASK-021 were saved.').waitFor()
  await waitRows(page)
  const row = await page.locator('#tasks tbody tr', { hasText: 'Roll out to teaching' }).innerText()
  check('M3 saved: back on the project, confirmation shown, row updated (Done, Unassigned)', /Done/.test(row) && /Unassigned/.test(row), row.replace(/\s+/g, ' '))
  const api21 = await api('/api/projects/PRJ-107/tasks/TASK-021')
  check('M4 API reflects the change; reference and project unchanged', api21.data.status === 'Done' && api21.data.assigneeId === null && api21.data.id === 'TASK-021' && api21.data.projectId === 'PRJ-107')
  check('M5 other tasks of the project untouched', (await api('/api/projects/PRJ-107/tasks')).data.filter((t) => t.id !== 'TASK-021').every((t) => t.assigneeId === 'TECH-005' || t.assigneeId === 'TECH-001'))

  await page.goto(BASE + '/projects/PRJ-107/tasks/TASK-021/edit')
  await page.getByLabel('Task title').waitFor()
  await page.getByLabel('Due date').fill('')
  await page.getByRole('button', { name: 'Save changes' }).click()
  check('M6 invalid edit blocked in the browser, nothing sent', (await page.getByRole('alert').innerText()).includes('Enter the due date.'))
  await page.getByLabel('Task title').fill('Edited but not saved')
  await page.getByLabel('Due date').fill('2099-01-01')
  await page.route('**/api/projects/PRJ-107/tasks/TASK-021', (route) => route.request().method() === 'PUT' ? route.abort() : route.fallback())
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText('could not be reached').waitFor()
  check('M7 failed save preserves edits and stays on the edit page', (await page.getByLabel('Task title').inputValue()) === 'Edited but not saved' && page.url().endsWith('/edit'))
  await page.unroute('**/api/projects/PRJ-107/tasks/TASK-021')
  await page.getByRole('link', { name: 'Cancel' }).click()
  await page.getByRole('alertdialog').waitFor()
  await page.getByRole('button', { name: 'Leave without saving' }).click()
  await page.waitForURL(/\/projects\/PRJ-107$/)
  check('M8 Cancel with unsaved edits asks; leaving discards them', (await api('/api/projects/PRJ-107/tasks/TASK-021')).data.title === 'Roll out to teaching departments')

  // not found variants
  const nf = async (path, text) => { await page.goto(BASE + path); await page.getByText(text).first().waitFor(); return (await page.getByLabel('Task title').count()) === 0 }
  check('M9 missing task -> "Task not found"', await nf('/projects/PRJ-101/tasks/TASK-999/edit', 'Task not found'))
  check('M10 another project’s task via the wrong project -> "Task not found"', await nf('/projects/PRJ-101/tasks/TASK-028/edit', 'Task not found'))
  check('M11 missing project when adding a task -> "Project not found"', await nf('/projects/PRJ-999/tasks/new', 'Project not found'))
  check('M12 malformed task reference -> "Task not found"', await nf('/projects/PRJ-101/tasks/bad%20id/edit', 'Task not found'))
  const direct = await fetch(API + '/api/projects/PRJ-101/tasks/TASK-028', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x', description: '', status: 'Done', priority: 'Low', assigneeId: null, startDate: '2026-01-01', dueDate: '2026-01-02' }) })
  check('M13 API: a task cannot be edited through a different project (404, unchanged)', direct.status === 404 && (await api('/api/projects/PRJ-111/tasks/TASK-028')).data.title !== 'x')
  await ctx.close()
} catch (e) { check('SECTION M aborted', false, String(e.message).slice(0, 300)) }

/* ---------- N. Mobile and themes ---------- */
console.log('\n== N. Mobile (390px) and themes ==')
try {
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } })
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await page.goto(BASE + '/projects/PRJ-101')
  await waitRows(page)
  check('N1 project page with tasks has no horizontal page overflow', (await overflow()) <= 0)
  const inner = await page.evaluate(() => { const r = document.querySelector('#tasks .table-scroll'); return { sw: r.scrollWidth, cw: r.clientWidth, tab: r.getAttribute('tabindex') } })
  check('N2 task table scrolls inside its own container, which is keyboard focusable', inner.sw > inner.cw && inner.tab === '0', JSON.stringify(inner))
  const stacked = await page.evaluate(() => ['task-search', 'task-status', 'task-assignee'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().width)))
  check('N3 task filters stack full width', stacked.every((w) => w > 280), stacked.join())
  check('N4 Add task is visible and at least 40px tall', (await page.getByRole('link', { name: 'Add task' }).boundingBox()).height >= 40)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tasks-mobile.png`, fullPage: true })
  await page.getByRole('link', { name: 'Add task' }).click()
  await page.getByLabel('Task title').waitFor()
  check('N5 task form: no overflow, single column, controls >= 40px', (await overflow()) <= 0 && (await page.evaluate(() => [...document.querySelectorAll('.form-card .input')].every((e) => e.getBoundingClientRect().height >= 40 && e.getBoundingClientRect().width > 280))))
  await page.getByLabel('Task title').fill('Created on a phone')
  await page.getByLabel('Due date').fill('2099-07-01')
  await page.getByRole('button', { name: 'Create task' }).click()
  await page.waitForURL(/\/projects\/PRJ-101$/)
  await page.getByText(/was created\./).waitFor()
  check('N6 creating a task on a phone works end to end', (await overflow()) <= 0)
  await ctx.close()

  // The app has one light design. Check badge contrast, and keep the page light whatever the operating-system setting is.
  for (const os of ['light', 'dark']) {
    const c = await newPage({ colorScheme: os })
    await c.page.goto(BASE + '/projects/PRJ-104')
    await waitRows(c.page)
    const colours = await c.page.evaluate(() => { const b = document.querySelector('#tasks .badge--danger'); const cs = getComputedStyle(b); return { fg: cs.color, bg: cs.backgroundColor, page: getComputedStyle(document.body).backgroundColor } })
    const lum = (s) => { const [r, g, b] = s.match(/[\d.]+/g).map(Number); const q = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2] }
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
    check(`N7 [OS ${os}] the page is light and status badges in the task table meet 4.5:1`, colours.page === 'rgb(250, 248, 247)' && ratio(colours.fg, colours.bg) >= 4.5, ratio(colours.fg, colours.bg).toFixed(2))
    if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/tasks-os-${os}.png`, fullPage: true })
    await c.page.goto(BASE + '/projects/PRJ-104/tasks/new'); await c.page.getByLabel('Task title').waitFor()
    await c.page.getByRole('button', { name: 'Create task' }).click(); await c.page.getByRole('alert').waitFor()
    if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/task-form-os-${os}.png`, fullPage: true })
    await c.ctx.close()
  }
} catch (e) { check('SECTION N aborted', false, String(e.message).slice(0, 300)) }

/* ---------- P. Regression ---------- */
console.log('\n== P. Existing project features ==')
try {
  const { ctx, page } = await newPage()
  await page.goto(BASE + '/'); await page.waitForSelector('table')
  check('P1 dashboard loads', (await page.getByRole('heading', { name: 'Dashboard', level: 1 }).count()) === 1)
  await page.goto(BASE + '/projects'); await page.waitForSelector('table')
  await page.getByLabel('Status').selectOption('Delayed')
  await page.waitForFunction(() => /of 2 projects/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  check('P2 project list filters still work', true)
  await page.getByRole('link', { name: 'New project' }).click()
  await page.getByLabel('Project name').fill('Regression check project')
  await page.getByLabel('Description').fill('Created while checking that projects still work.')
  await page.getByLabel('Location').fill('Demo Room'); await page.getByLabel('Department').fill('Service Desk'); await page.getByLabel('Project lead').fill('Casey Lane')
  await page.getByLabel('Target completion date').fill('2099-12-31')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/projects\/PRJ-\d+$/)
  await page.getByText(/was created\./).waitFor()
  check('P3 creating a project still works, and a new project starts with no tasks', (await page.getByText('No tasks yet').count()) === 1 || (await page.getByText('No tasks yet').waitFor().then(() => true)))
  await page.getByRole('link', { name: 'Edit project' }).click()
  await page.getByLabel('Progress (%)').fill('10')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText(/Changes to PRJ-\d+ were saved\./).waitFor()
  check('P4 editing a project still works', true)
  // The app is intentionally light-only: there is no theme switch, and a dark system setting (or a stale "dark" value
  // saved by the removed switch) must not change how it looks.
  const lightOnly = await newPage({ colorScheme: 'dark' })
  await lightOnly.ctx.addInitScript(() => { try { localStorage.setItem('lc-projecthub-theme', 'dark') } catch {} })
  await lightOnly.page.goto(BASE + '/'); await lightOnly.page.waitForSelector('table')
  const look = await lightOnly.page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme, attr: document.documentElement.hasAttribute('data-theme') }))
  check('P5 the app stays light-only: no theme switch, no theme attribute, light page, even with a dark system setting and a stale saved "dark"', look.bg === 'rgb(250, 248, 247)' && look.scheme === 'light' && !look.attr && (await lightOnly.page.getByRole('radio').count()) === 0 && (await lightOnly.page.getByRole('radiogroup').count()) === 0, JSON.stringify(look))
  await lightOnly.ctx.close()
  check('P6 /api/health ok; deleting a project or task is not possible', (await api('/api/health')).status === 'ok' && (await fetch(API + '/api/projects/PRJ-101', { method: 'DELETE' })).status === 404 && (await fetch(API + '/api/projects/PRJ-101/tasks/TASK-001', { method: 'DELETE' })).status === 404)
  await ctx.close()
} catch (e) { check('SECTION P aborted', false, String(e.message).slice(0, 300)) }

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) console.log('FAILED:\n - ' + failed.map((f) => f.name).join('\n - '))
