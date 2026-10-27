import { launchBrowser } from '../lib/browser.mjs'

import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'
const SHOTS = process.env.SHOTS
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) }
const raw = (path, init) => fetch(API + path, init)
const api = async (path, init) => (await raw(path, init)).json()
const send = (method, path, body) => raw(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const post = async (path, body) => (await send('POST', path, body)).json()
const del = (path) => send('DELETE', path)

// ---- independent expectations: worked out from the per-project task API, never from /api/tasks ----
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (offset) => { const n = new Date(); return iso(new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset)) }
function week() {
  const n = new Date(); const back = (n.getDay() + 6) % 7
  const mon = new Date(n.getFullYear(), n.getMonth(), n.getDate() - back)
  return { start: iso(mon), end: iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)) }
}
async function expected() {
  const w = week(), today = day(0)
  const projects = (await api('/api/projects?pageSize=100')).data
  const tasks = []
  for (const p of projects) for (const t of (await api(`/api/projects/${p.id}/tasks?pageSize=100`)).data) tasks.push(t)
  const outstanding = tasks.filter((t) => t.status !== 'Done')
  return {
    projects, tasks,
    total: tasks.length,
    outstanding: outstanding.length,
    overdue: outstanding.filter((t) => t.dueDate < today).length,
    thisWeek: outstanding.filter((t) => t.dueDate >= w.start && t.dueDate <= w.end).length,
    active: projects.filter((p) => p.status !== 'Complete').length,
  }
}
const projectInput = (name) => ({ name, description: 'Fictional project for the deletion tests.', location: 'Test Annexe', department: 'Infrastructure', lead: 'Casey Lane', priority: 'Low', status: 'On track', progress: 10, startDate: '2026-01-05', dueDate: '2026-12-30' })
const taskInput = (title, due, status = 'To do') => ({ title, description: '', status, priority: 'Low', assigneeId: null, startDate: '2020-01-01', dueDate: due })
async function makeProject(name, tasks = []) {
  const project = (await post('/api/projects', projectInput(name))).data
  const made = []
  for (const [title, due, status] of tasks) made.push((await post(`/api/projects/${project.id}/tasks`, taskInput(title, due, status))).data)
  return { project, tasks: made }
}

// Refuses to run unless the page is served through the isolated test stack (never the development server).
await assertIsolated()
const browser = await launchBrowser()
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts })
  const requests = []
  await ctx.route('**/api/**', (route) => { const r = route.request(); const u = new URL(r.url()); requests.push(`${r.method()} ${u.pathname}${u.search}`); return route.continue({ url: API + u.pathname + u.search }) })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  return { ctx, page, requests }
}
const deletes = (requests) => requests.filter((r) => r.startsWith('DELETE '))
const rows = (page) => page.locator('table tbody tr')
const dialog = (page) => page.getByRole('alertdialog')
const projectPage = async (page, id) => { await page.goto(`${BASE}/projects/${id}`); await page.waitForSelector('#tasks table, #tasks .state') }
const taskRow = (page, title) => page.locator('table tbody tr', { hasText: title })
const deleteButtonFor = (page, task) => page.getByRole('button', { name: new RegExp(`Delete task ${task.id}:`) })
const urlNow = (page) => { const u = new URL(page.url()); return u.pathname + u.search }
const dashSettled = async (page) => {
  await page.goto(BASE + '/'); await page.waitForSelector('table')
  await page.waitForFunction(() => [...document.querySelectorAll('.stat-card')].filter((c) => /Overdue tasks|Tasks due this week/.test(c.textContent)).every((c) => c.getAttribute('aria-busy') === 'false'))
}
const stat = async (page, label) => Number((await page.locator('.stat-card', { hasText: label }).locator('.stat-card__value').innerText()).trim())
const allTasksNumbers = async (page, query = '') => {
  await page.goto(`${BASE}/tasks${query}`); await page.waitForSelector('.results[aria-busy="false"], .state')
  const summary = await page.locator('.results-summary').innerText().catch(() => '')
  const counts = await page.locator('.results-counts').innerText().catch(() => '')
  const m = /(\d+) outstanding\s*·\s*(\d+) overdue/.exec(counts)
  return { total: Number(/of (\d+) tasks/.exec(summary)?.[1] ?? 0), outstanding: m ? Number(m[1]) : 0, overdue: m ? Number(m[2]) : 0 }
}
const errorBody = (message) => JSON.stringify({ error: { code: 'INTERNAL_ERROR', message } })

const baseline = await expected()
console.log(`     (baseline from the API: ${baseline.projects.length} projects, ${baseline.total} tasks, ${baseline.overdue} overdue, ${baseline.thisWeek} due this week, today ${day(0)})`)

console.log('\n== A. Deleting a task from its project page ==')
try {
  const { project, tasks } = await makeProject('Deletion A', [['A overdue task', day(-3)], ['A task due today', day(0)], ['A finished task', day(-5), 'Done']])
  const [overdue, today, done] = tasks
  const { ctx, page, requests } = await open()
  await projectPage(page, project.id)
  check('A1 every task row has a Delete button that names its task', (await page.getByRole('button', { name: /^Delete task TASK-\d+:/ }).count()) === 3)

  await deleteButtonFor(page, overdue).focus()
  await deleteButtonFor(page, overdue).click()
  const d = dialog(page)
  await d.waitFor()
  const dText = await d.innerText()
  check('A2 clicking Delete asks first: the dialog names the task and says it is permanent', (await d.getByRole('heading').innerText()) === `Delete task ${overdue.id}?` && dText.includes(overdue.title) && /permanently/i.test(dText) && /cannot be undone/i.test(dText), dText.replace(/\s+/g, ' ').slice(0, 120))
  check('A3 nothing has been deleted yet (no DELETE request) and focus starts on Cancel', deletes(requests).length === 0 && (await page.evaluate(() => document.activeElement.textContent)) === 'Cancel')
  await d.getByRole('button', { name: 'Cancel' }).click()
  check('A4 Cancel closes it and leaves the task, the list and the server untouched', (await dialog(page).count()) === 0 && (await rows(page).count()) === 3 && deletes(requests).length === 0 && (await raw(`/api/projects/${project.id}/tasks/${overdue.id}`)).status === 200)
  check('A5 and focus goes back to the Delete button that was used', await page.evaluate((id) => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent.includes(id), overdue.id))

  await deleteButtonFor(page, today).click(); await dialog(page).waitFor()
  await page.keyboard.press('Escape')
  check('A6 Escape also cancels', (await dialog(page).count()) === 0 && deletes(requests).length === 0 && (await rows(page).count()) === 3)

  await deleteButtonFor(page, overdue).click(); await dialog(page).waitFor()
  await dialog(page).getByRole('button', { name: 'Delete task' }).click()
  await page.getByText(/was deleted/).waitFor()
  check('A7 confirming sends exactly one DELETE for that task', deletes(requests).length === 1 && deletes(requests)[0] === `DELETE /api/projects/${project.id}/tasks/${overdue.id}`, deletes(requests).join(' '))
  check('A8 the row is gone, the others stay, and a success message names the task', (await rows(page).count()) === 2 && (await taskRow(page, overdue.title).count()) === 0 && (await page.getByText(`Task ${overdue.id} “${overdue.title}” was deleted.`).count()) === 1)
  check('A9 focus moves to that message (not lost on a removed row)', await page.evaluate(() => /was deleted/.test(document.activeElement?.textContent ?? '')))
  check('A10 the heading count drops from 3 to 2', (await page.locator('#tasks-heading').innerText()).includes('(2)'))
  check('A11 on the server the task is gone (404), its project and the other tasks are not', (await raw(`/api/projects/${project.id}/tasks/${overdue.id}`)).status === 404 && (await raw(`/api/projects/${project.id}`)).status === 200 && (await api(`/api/projects/${project.id}/tasks`)).meta.total === 2)

  const exp = await expected()
  check('A12 the independent total fell by exactly one', exp.total === baseline.total + 3 - 1, `${exp.total}`)
  const all = await allTasksNumbers(page)
  check('A13 the All tasks page shows the new total, outstanding and overdue counts', all.total === exp.total && all.outstanding === exp.outstanding && all.overdue === exp.overdue, JSON.stringify(all))
  await dashSettled(page)
  check('A14 the dashboard\'s Overdue tasks and Tasks due this week match the independent calculation', (await stat(page, 'Overdue tasks')) === exp.overdue && (await stat(page, 'Tasks due this week')) === exp.thisWeek, `${await stat(page, 'Overdue tasks')}/${exp.overdue} ${await stat(page, 'Tasks due this week')}/${exp.thisWeek}`)
  void done
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/deletion-task.png`, fullPage: true })
  await ctx.close()
} catch (e) { check('SECTION A aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== B. A failed deletion is never shown as success, and can be retried ==')
try {
  const { project, tasks } = await makeProject('Deletion B', [['B retry me', day(-1)], ['B network failure', day(2)]])
  const [first, second] = tasks
  const { ctx, page, requests } = await open()
  let failuresLeft = 1
  await page.route('**/api/projects/*/tasks/*', (route) => (route.request().method() === 'DELETE' && failuresLeft-- > 0
    ? route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('Something went wrong on the server.') })
    : route.fallback()))
  await projectPage(page, project.id)
  await deleteButtonFor(page, first).click(); await dialog(page).waitFor()
  await dialog(page).getByRole('button', { name: 'Delete task' }).click()
  await dialog(page).getByRole('alert').waitFor()
  check('B1 a server error is shown inside the dialog', (await dialog(page).getByRole('alert').innerText()).includes('Something went wrong on the server.'))
  check('B2 the task is still listed, no success message appears, and the server still has it', (await taskRow(page, first.title).count()) === 1 && (await page.getByText(/was deleted/).count()) === 0 && (await raw(`/api/projects/${project.id}/tasks/${first.id}`)).status === 200)
  check('B3 the dialog stays open with the confirm button available again', (await dialog(page).count()) === 1 && await dialog(page).getByRole('button', { name: 'Delete task' }).isEnabled())
  await dialog(page).getByRole('button', { name: 'Delete task' }).click()
  await page.getByText(/was deleted/).waitFor()
  check('B4 retrying works: the task is deleted and reported (only the retry reached the server; the first answer was injected)', (await taskRow(page, first.title).count()) === 0 && (await raw(`/api/projects/${project.id}/tasks/${first.id}`)).status === 404 && deletes(requests).length === 1, `${deletes(requests).length} DELETE requests reached the server`)

  await page.route('**/api/projects/*/tasks/*', (route) => (route.request().method() === 'DELETE' ? route.abort() : route.fallback()))
  await deleteButtonFor(page, second).click(); await dialog(page).waitFor()
  await dialog(page).getByRole('button', { name: 'Delete task' }).click()
  await dialog(page).getByRole('alert').waitFor()
  check('B5 an unreachable server gives a plain-language message and deletes nothing', (await dialog(page).getByRole('alert').innerText()).includes('could not be reached') && (await raw(`/api/projects/${project.id}/tasks/${second.id}`)).status === 200 && (await taskRow(page, second.title).count()) === 1)
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  check('B6 Cancel after a failure closes the dialog and the task remains', (await dialog(page).count()) === 0 && (await taskRow(page, second.title).count()) === 1)
  await ctx.close()
} catch (e) { check('SECTION B aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== C. Double submission ==')
try {
  const { project, tasks } = await makeProject('Deletion C', [['C double click', day(1)]])
  const [only] = tasks
  const { ctx, page, requests } = await open()
  let release
  const gate = new Promise((r) => (release = r))
  await page.route('**/api/projects/*/tasks/*', async (route) => { if (route.request().method() === 'DELETE') await gate; await route.fallback() })
  await projectPage(page, project.id)
  await deleteButtonFor(page, only).click(); await dialog(page).waitFor()
  const confirm = dialog(page).getByRole('button', { name: 'Delete task' })
  await confirm.dblclick()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const busy = dialog(page).getByRole('button', { name: 'Deleting…' })
  check('C1 while the request is running the button says "Deleting…" and is disabled, as is Cancel', (await busy.count()) === 1 && await busy.isDisabled() && await dialog(page).getByRole('button', { name: 'Cancel' }).isDisabled())
  check('C2 the task is not reported deleted before the server answers', (await page.getByText(/was deleted/).count()) === 0 && (await taskRow(page, only.title).count()) === 1)
  await page.keyboard.press('Escape')
  check('C3 Escape cannot abandon a request in flight', (await dialog(page).count()) === 1)
  release()
  await page.getByText(/was deleted/).waitFor()
  check('C4 only one DELETE reached the server', deletes(requests).length === 1, deletes(requests).join(' '))
  check('C5 and it succeeded once, with no error', (await page.getByRole('alert').count()) === 0 && (await raw(`/api/projects/${project.id}/tasks/${only.id}`)).status === 404)
  await ctx.close()
} catch (e) { check('SECTION C aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== D. The task was already deleted elsewhere ==')
try {
  const { project, tasks } = await makeProject('Deletion D', [['D deleted behind your back', day(1)], ['D bystander', day(1)]])
  const [gone, bystander] = tasks
  const { ctx, page } = await open()
  await projectPage(page, project.id)
  await deleteButtonFor(page, gone).click(); await dialog(page).waitFor()
  await del(`/api/projects/${project.id}/tasks/${gone.id}`) // someone else deletes it first
  await dialog(page).getByRole('button', { name: 'Delete task' }).click()
  await dialog(page).getByRole('alert').waitFor()
  const msg = await dialog(page).getByRole('alert').innerText()
  check('D1 the server\'s "not found" answer is explained: it may already have been deleted', msg.includes(`Task ${gone.id} was not found`) && msg.includes('may already have been deleted'), msg)
  await page.waitForFunction((title) => ![...document.querySelectorAll('table tbody tr')].some((r) => r.textContent.includes(title)), gone.title)
  check('D2 the list refreshed itself (the stale row is gone) without claiming a success', (await taskRow(page, gone.title).count()) === 0 && (await taskRow(page, bystander.title).count()) === 1 && (await page.getByText(/was deleted\./).count()) === 0)
  await ctx.close()
} catch (e) { check('SECTION D aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== E. The task endpoint: unknown, mismatched and repeated requests ==')
try {
  const a = await makeProject('Deletion E1', [['E task of E1', day(1)]])
  const b = await makeProject('Deletion E2', [['E task of E2', day(1)]])
  const [ta] = a.tasks, [tb] = b.tasks
  const status = async (path) => (await del(path)).status
  check('E1 an unknown project is 404', (await status(`/api/projects/PRJ-9999/tasks/${ta.id}`)) === 404)
  check('E2 an unknown task is 404', (await status(`/api/projects/${a.project.id}/tasks/TASK-9999`)) === 404)
  check('E3 a task of another project is 404 and survives', (await status(`/api/projects/${a.project.id}/tasks/${tb.id}`)) === 404 && (await raw(`/api/projects/${b.project.id}/tasks/${tb.id}`)).status === 200)
  check('E4 a malformed reference is 400', (await status(`/api/projects/${a.project.id}/tasks/bad%20id`)) === 400)
  const ok = await del(`/api/projects/${a.project.id}/tasks/${ta.id}`)
  const okBody = await ok.json()
  check('E5 a real deletion answers 200 with the deleted task', ok.status === 200 && okBody.data.id === ta.id && okBody.data.projectId === a.project.id)
  check('E6 repeating it is 404 (not a second success)', (await status(`/api/projects/${a.project.id}/tasks/${ta.id}`)) === 404)
  const fresh = (await post(`/api/projects/${a.project.id}/tasks`, taskInput('E reuse check', day(1)))).data
  check('E7 a deleted task\'s reference is never given to a new task', fresh.id !== ta.id && Number(fresh.id.slice(5)) > Number(ta.id.slice(5)), `${ta.id} -> ${fresh.id}`)
} catch (e) { check('SECTION E aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== F. Deleting from the All tasks page ==')
try {
  const many = await makeProject('Deletion F', Array.from({ length: 11 }, (_, i) => [`Fprobe ${String(i + 1).padStart(2, '0')}`, day(i + 1)]))
  const { ctx, page, requests } = await open()
  await page.goto(`${BASE}/tasks?q=Fprobe`); await page.waitForSelector('.results[aria-busy="false"]')
  check('F1 the search finds all 11 probe tasks over two pages', /of 11 tasks/.test(await page.locator('.results-summary').innerText()) && (await rows(page).count()) === 10)
  const target = many.tasks[0]
  await page.getByRole('button', { name: new RegExp(`Delete task ${target.id}:`) }).click(); await dialog(page).waitFor()
  check('F2 the confirmation appears here too, naming the task', (await dialog(page).getByRole('heading').innerText()) === `Delete task ${target.id}?`)
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  check('F3 cancelling changes nothing', deletes(requests).length === 0 && /of 11 tasks/.test(await page.locator('.results-summary').innerText()))
  await page.getByRole('button', { name: new RegExp(`Delete task ${target.id}:`) }).click(); await dialog(page).waitFor()
  await dialog(page).getByRole('button', { name: 'Delete task' }).click()
  await page.getByText(/was deleted/).waitFor()
  await page.waitForFunction(() => /of 10 tasks/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  check('F4 the list reloads: 10 matches now, the deleted task is gone, the search is kept', (await taskRow(page, target.title).count()) === 0 && (await rows(page).count()) === 10 && urlNow(page) === '/tasks?q=Fprobe' && DELETE_PATHS_OK(requests, many.project.id, target.id))
  const exp = await expected()
  const counts = await page.locator('.results-counts').innerText()
  check('F5 the outstanding/overdue counts are recalculated from the remaining tasks', counts.includes('10 outstanding') && counts.includes(`${exp.tasks.filter((t) => t.projectId === many.project.id && t.status !== 'Done' && t.dueDate < day(0)).length} overdue`), counts)
  await page.goto(`${BASE}/tasks?q=Fprobe&page=1`); await page.waitForSelector('.results[aria-busy="false"]')
  check('F6 ten matches fit on one page now (no paging controls)', (await page.getByRole('navigation', { name: 'Pagination' }).count()) === 0)
  await ctx.close()

  const p2 = await open()
  const more = await makeProject('Deletion F2', Array.from({ length: 11 }, (_, i) => [`Gprobe ${String(i + 1).padStart(2, '0')}`, day(i + 1)]))
  await p2.page.goto(`${BASE}/tasks?q=Gprobe&page=2`); await p2.page.waitForSelector('.results[aria-busy="false"]')
  const lastTask = more.tasks[10]
  check('F7 page 2 holds exactly one task (the last)', (await rows(p2.page).count()) === 1 && (await taskRow(p2.page, lastTask.title).count()) === 1)
  await p2.page.getByRole('button', { name: new RegExp(`Delete task ${lastTask.id}:`) }).click(); await dialog(p2.page).waitFor()
  await dialog(p2.page).getByRole('button', { name: 'Delete task' }).click()
  await p2.page.getByText(/was deleted/).waitFor()
  await p2.page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 10)
  check('F8 deleting the only task on the last page steps back to page 1, never an empty page', urlNow(p2.page) === '/tasks?q=Gprobe' && (await p2.page.getByText('No tasks match your filters').count()) === 0)
  await p2.ctx.close()
} catch (e) { check('SECTION F aborted', false, String(e.message).slice(0, 300)) }
function DELETE_PATHS_OK(requests, projectId, taskId) { return deletes(requests).length === 1 && deletes(requests)[0] === `DELETE /api/projects/${projectId}/tasks/${taskId}` }

console.log('\n== G. Deleting a project and all of its tasks ==')
let deletedProject
try {
  const { project, tasks } = await makeProject('Deletion Hub', [['G overdue', day(-4)], ['G today', day(0)], ['G later', day(20)], ['G finished', day(-9), 'Done']])
  deletedProject = { project, tasks }
  const other = await makeProject('Deletion Bystander', [['G bystander task', day(5)]])
  const before = await expected()
  const { ctx, page, requests } = await open()
  await page.goto(`${BASE}/projects/${project.id}`); await page.waitForSelector('#tasks table')
  await page.getByRole('button', { name: 'Delete project' }).focus()
  await page.getByRole('button', { name: 'Delete project' }).click()
  const d = dialog(page)
  await d.waitFor()
  const text = await d.innerText()
  check('G1 the dialog names the project and its reference', (await d.getByRole('heading').innerText()) === `Delete project ${project.id}?` && text.includes(project.name) && text.includes(project.id))
  check('G2 it says all tasks associated with the project will also be deleted, and that it is permanent', /and all tasks associated with it/.test(text) && /cannot be undone/i.test(text), text.replace(/\s+/g, ' ').slice(0, 160))
  check('G3 nothing is deleted yet; focus starts on Cancel', deletes(requests).length === 0 && (await page.evaluate(() => document.activeElement.textContent)) === 'Cancel')
  await d.getByRole('button', { name: 'Cancel' }).click()
  const afterCancel = await expected()
  check('G4 Cancel leaves the project, all four tasks and every count exactly as they were', deletes(requests).length === 0 && JSON.stringify([afterCancel.total, afterCancel.overdue, afterCancel.projects.length]) === JSON.stringify([before.total, before.overdue, before.projects.length]) && (await rows(page).count()) === 4 && urlNow(page) === `/projects/${project.id}`)
  check('G5 focus returns to the Delete project button', await page.evaluate(() => document.activeElement?.textContent === 'Delete project'))

  await page.getByRole('button', { name: 'Delete project' }).click(); await dialog(page).waitFor()
  await dialog(page).getByRole('button', { name: 'Delete project and its tasks' }).click()
  await page.waitForURL('**/projects')
  await page.getByText(/were deleted/).waitFor()
  check('G6 exactly one DELETE was sent, for this project', deletes(requests).length === 1 && deletes(requests)[0] === `DELETE /api/projects/${project.id}`, deletes(requests).join(' '))
  check('G7 the page leaves the deleted project and lands on the projects list with a message', urlNow(page) === '/projects' && (await page.getByText(`Project ${project.id} “${project.name}” and its 4 tasks were deleted.`).count()) === 1)
  await page.goto(`${BASE}/projects?q=${encodeURIComponent(project.name)}`); await page.waitForSelector('.results[aria-busy="false"], .state')
  const goneInList = (await page.getByText('No projects match your filters').count()) === 1
  await page.goto(`${BASE}/projects?q=${encodeURIComponent(other.project.name)}`); await page.waitForSelector('.results[aria-busy="false"], .state')
  check('G8 searching the projects list: the deleted project is gone; the bystander (positive control) is found', goneInList && (await page.getByRole('link', { name: other.project.name, exact: true }).count()) === 1)
  await page.goto(`${BASE}/projects`); await page.waitForSelector('table')
  await page.reload(); await page.waitForSelector('table')
  check('G9 the message does not come back after a reload', (await page.getByText(/were deleted/).count()) === 0)

  const after = await expected()
  check('G10 the server no longer has the project or any of its tasks', (await raw(`/api/projects/${project.id}`)).status === 404 && (await raw(`/api/projects/${project.id}/tasks`)).status === 404 && tasks.every((t) => !after.tasks.some((x) => x.id === t.id)))
  check('G11 NO ORPHANS: every task on the server belongs to a project that still exists', after.tasks.every((t) => after.projects.some((p) => p.id === t.projectId)), `${after.tasks.filter((t) => !after.projects.some((p) => p.id === t.projectId)).map((t) => t.id)}`)
  const allList = (await api('/api/tasks?pageSize=100')).data
  check('G12 /api/tasks (the All tasks feed) holds none of them either, and the bystander\'s task is intact', allList.every((t) => t.projectId !== project.id) && allList.some((t) => t.id === other.tasks[0].id))
  check('G13 the independent counts fell by exactly this project: -4 tasks, -1 project', after.total === before.total - 4 && after.projects.length === before.projects.length - 1, `${before.total} -> ${after.total}`)

  const all = await allTasksNumbers(page)
  check('G14 the All tasks page shows the new total, outstanding and overdue counts', all.total === after.total && all.outstanding === after.outstanding && all.overdue === after.overdue, JSON.stringify(all))
  const found = {}
  for (const title of [...tasks.map((t) => t.title), other.tasks[0].title]) {
    await page.goto(`${BASE}/tasks?q=${encodeURIComponent(title)}`); await page.waitForSelector('.results[aria-busy="false"], .state')
    found[title] = await rows(page).count()
  }
  check("G15 searching All tasks for each deleted task finds nothing, while the bystander's task (positive control) is found", tasks.every((t) => found[t.title] === 0) && found[other.tasks[0].title] === 1, JSON.stringify(found))
  await dashSettled(page)
  check('G16 the dashboard: Active projects, Overdue tasks and Tasks due this week match the independent calculation', (await stat(page, 'Active projects')) === after.active && (await stat(page, 'Overdue tasks')) === after.overdue && (await stat(page, 'Tasks due this week')) === after.thisWeek, `${await stat(page, 'Active projects')}/${after.active} ${await stat(page, 'Overdue tasks')}/${after.overdue} ${await stat(page, 'Tasks due this week')}/${after.thisWeek}`)
  check('G17 the deleted project\'s address now shows the standard "not found" page', await (async () => { await page.goto(`${BASE}/projects/${project.id}`); await page.waitForSelector('[role=alert], .state'); return /not found/i.test(await page.locator('main').innerText()) })())
  await ctx.close()
} catch (e) { check('SECTION G aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== H. Project deletion: failure, retry, double submission, already deleted ==')
try {
  const f = await makeProject('Deletion Retry', [['H retry task one', day(1)], ['H retry task two', day(2)]])
  const { ctx, page, requests } = await open()
  let failuresLeft = 1
  await page.route('**/api/projects/PRJ-*', (route) => (route.request().method() === 'DELETE' && !/tasks/.test(route.request().url()) && failuresLeft-- > 0
    ? route.fulfill({ status: 500, contentType: 'application/json', body: errorBody('Something went wrong on the server.') })
    : route.fallback()))
  await page.goto(`${BASE}/projects/${f.project.id}`); await page.waitForSelector('#tasks table')
  await page.getByRole('button', { name: 'Delete project' }).click(); await dialog(page).waitFor()
  await dialog(page).getByRole('button', { name: 'Delete project and its tasks' }).click()
  await dialog(page).getByRole('alert').waitFor()
  check('H1 a server error stays on the page, inside the dialog, with no success message', urlNow(page) === `/projects/${f.project.id}` && (await dialog(page).getByRole('alert').innerText()).includes('Something went wrong') && (await page.getByText(/were deleted/).count()) === 0)
  check('H2 the project and both tasks are still on the server', (await raw(`/api/projects/${f.project.id}`)).status === 200 && (await api(`/api/projects/${f.project.id}/tasks`)).meta.total === 2)
  await dialog(page).getByRole('button', { name: 'Delete project and its tasks' }).click()
  await page.waitForURL('**/projects')
  check('H3 retrying succeeds and takes the user to the projects list', urlNow(page) === '/projects' && (await page.getByText(/and its 2 tasks were deleted/).count()) === 1 && (await raw(`/api/projects/${f.project.id}`)).status === 404)
  await ctx.close()

  const g = await makeProject('Deletion Double', [['H double task', day(1)]])
  const dbl = await open()
  let release
  const gate = new Promise((r) => (release = r))
  await dbl.page.route('**/api/projects/PRJ-*', async (route) => { if (route.request().method() === 'DELETE') await gate; await route.fallback() })
  await dbl.page.goto(`${BASE}/projects/${g.project.id}`); await dbl.page.waitForSelector('#tasks table')
  await dbl.page.getByRole('button', { name: 'Delete project' }).click(); await dialog(dbl.page).waitFor()
  await dialog(dbl.page).getByRole('button', { name: 'Delete project and its tasks' }).dblclick()
  await dbl.page.waitForTimeout(150)
  check('H4 while deleting the buttons are disabled and the project is not yet reported deleted', await dialog(dbl.page).getByRole('button', { name: 'Deleting…' }).isDisabled() && urlNow(dbl.page) === `/projects/${g.project.id}`)
  release()
  await dbl.page.waitForURL('**/projects')
  check('H5 a double click sent only one DELETE', deletes(dbl.requests).length === 1, deletes(dbl.requests).join(' '))
  await dbl.ctx.close()

  const h = await makeProject('Deletion Stale', [['H stale task', day(1)]])
  const stale = await open()
  await stale.page.goto(`${BASE}/projects/${h.project.id}`); await stale.page.waitForSelector('#tasks table')
  await stale.page.getByRole('button', { name: 'Delete project' }).click(); await dialog(stale.page).waitFor()
  await del(`/api/projects/${h.project.id}`) // deleted by someone else while the dialog was open
  await dialog(stale.page).getByRole('button', { name: 'Delete project and its tasks' }).click()
  await stale.page.waitForURL('**/projects')
  check('H6 a project already deleted elsewhere: the user is taken to the list and told so, with no false success', (await stale.page.getByText(`Project ${h.project.id} had already been deleted.`).count()) === 1 && (await stale.page.getByText(/were deleted/).count()) === 0)
  await stale.ctx.close()
} catch (e) { check('SECTION H aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== I. The project endpoint: unknown, repeated, malformed, partial effects ==')
try {
  const p = await makeProject('Deletion API', [['I one', day(1)], ['I two', day(2)], ['I three', day(3), 'Done']])
  const empty = await makeProject('Deletion Empty', [])
  check('I1 an unknown project is 404 and deletes nothing', (await del('/api/projects/PRJ-9999')).status === 404 && (await raw(`/api/projects/${p.project.id}`)).status === 200)
  check('I2 a malformed reference is 400', (await del('/api/projects/bad%20ref')).status === 400)
  const r = await del(`/api/projects/${p.project.id}`)
  const body = await r.json()
  check('I3 a real deletion answers 200 with the project and the number of tasks deleted', r.status === 200 && body.data.id === p.project.id && body.meta.deletedTasks === 3, JSON.stringify(body.meta))
  check('I4 repeating it is 404 and nothing else changes', (await del(`/api/projects/${p.project.id}`)).status === 404)
  const e2 = await (await del(`/api/projects/${empty.project.id}`)).json()
  check('I5 a project with no tasks deletes cleanly (0 tasks)', e2.meta.deletedTasks === 0)
  check('I6 tasks can no longer be created in, or read from, a deleted project', (await send('POST', `/api/projects/${p.project.id}/tasks`, taskInput('too late', day(1)))).status === 404 && (await raw(`/api/projects/${p.project.id}/tasks/${p.tasks[0].id}`)).status === 404)
  const twin = await makeProject('Deletion Twin', [['I twin', day(1)]])
  const results = await Promise.all([del(`/api/projects/${twin.project.id}`), del(`/api/projects/${twin.project.id}`)])
  check('I7 two simultaneous deletions: one succeeds, one is 404', results.map((x) => x.status).sort().join() === '200,404', results.map((x) => x.status).join())
  const exp = await expected()
  check('I8 still no orphans after all of that', exp.tasks.every((t) => exp.projects.some((x) => x.id === t.projectId)))
  const created = (await post('/api/projects', projectInput('Deletion Fresh'))).data
  check('I9 a deleted project\'s reference is not given to a new project', ![p.project.id, empty.project.id, twin.project.id, deletedProject.project.id].includes(created.id), created.id)
} catch (e) { check('SECTION I aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== J. Look, keyboard and small screens ==')
try {
  const { project, tasks } = await makeProject('Deletion Look', [['J look task', day(1)]])
  const dark = await open({ colorScheme: 'dark' })
  await projectPage(dark.page, project.id)
  await dark.page.getByRole('button', { name: 'Delete project' }).click(); await dialog(dark.page).waitFor()
  check('J1 still a single light theme with a dark system setting; the dialog is light too', (await dark.page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(250, 248, 247)' && (await dark.page.evaluate(() => getComputedStyle(document.querySelector('.confirm-dialog')).backgroundColor)) !== 'rgb(0, 0, 0)')
  check('J2 the destructive button is visibly distinct (red text on a pale red) and has readable contrast', await dark.page.evaluate(() => {
    const parse = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
    const lum = ([r, g, b]) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
    const el = document.querySelector('.confirm-dialog .btn--danger'); const cs = getComputedStyle(el)
    const [x, y] = [lum(parse(cs.color)), lum(parse(cs.backgroundColor))].sort((a, b) => b - a)
    return (x + 0.05) / (y + 0.05) >= 4.5
  }))
  await dark.page.keyboard.press('Tab')
  check('J3 keyboard: Tab moves from Cancel to the confirm button', (await dark.page.evaluate(() => document.activeElement.textContent)) === 'Delete project and its tasks')
  await dark.page.keyboard.press('Escape')
  check('J4 keyboard: Escape closes without deleting', (await dialog(dark.page).count()) === 0 && (await raw(`/api/projects/${project.id}`)).status === 200)
  await dark.ctx.close()

  for (const [name, width] of [['phone', 375], ['tablet', 768], ['desktop', 1280]]) {
    const c = await open({ viewport: { width, height: 800 } })
    await projectPage(c.page, project.id)
    await c.page.getByRole('button', { name: 'Delete project' }).click(); await dialog(c.page).waitFor()
    check(`J5 [${name}] no horizontal overflow with the project dialog open; both buttons fit on screen`, await c.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && [...document.querySelectorAll('.confirm-dialog .btn')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth })))
    await c.page.getByRole('button', { name: 'Cancel' }).click()
    await c.page.getByRole('button', { name: new RegExp(`Delete task ${tasks[0].id}:`) }).click(); await dialog(c.page).waitFor()
    check(`J6 [${name}] the task dialog fits too`, await c.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/deletion-dialog-${name}.png`, fullPage: true })
    await c.ctx.close()
  }
  const k = await open()
  await projectPage(k.page, project.id)
  await k.page.getByRole('button', { name: new RegExp(`Delete task ${tasks[0].id}:`) }).click()
  check('J7 the dialog is announced as an alert dialog with a name and a description', await k.page.evaluate(() => { const d = document.querySelector('[role=alertdialog]'); return !!d && !!document.getElementById(d.getAttribute('aria-labelledby')) && !!document.getElementById(d.getAttribute('aria-describedby')) }))
  await k.ctx.close()
} catch (e) { check('SECTION J aborted', false, String(e.message).slice(0, 300)) }

await browser.close()
console.log(`\n${pass}/${pass + fail} checks passed`)
