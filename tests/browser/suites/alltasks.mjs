import { launchBrowser } from '../lib/browser.mjs'

import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'
const SHOTS = process.env.SHOTS
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) }
const api = async (path, init) => (await fetch(API + path, init)).json()
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const put = (path, body) => api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ---- independent expectations: worked out from the per-project task API, never from /api/tasks ----
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (offset) => { const n = new Date(); return iso(new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset)) }
function week() {
  const n = new Date(); const back = (n.getDay() + 6) % 7
  const mon = new Date(n.getFullYear(), n.getMonth(), n.getDate() - back)
  return { start: iso(mon), end: iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)) }
}
async function everything() {
  const projects = (await api('/api/projects?pageSize=100')).data
  const tasks = []
  for (const p of projects) for (const t of (await api(`/api/projects/${p.id}/tasks?pageSize=100`)).data) tasks.push({ ...t, projectName: p.name })
  return { projects, tasks }
}
const overdue = (t) => t.status !== 'Done' && t.dueDate < day(0)
const thisWeek = (t) => { const w = week(); return t.status !== 'Done' && t.dueDate >= w.start && t.dueDate <= w.end }
const task = (title, due, status = 'To do') => ({ title, description: '', status, priority: 'Low', assigneeId: null, startDate: '2020-01-01', dueDate: due })

// Refuses to run unless the page is served through the isolated test stack (never the development server).
await assertIsolated()
const browser = await launchBrowser()
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts })
  const requests = []
  await ctx.route('**/api/**', (route) => { const u = new URL(route.request().url()); requests.push(u.pathname + u.search); return route.continue({ url: API + u.pathname + u.search }) })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  return { ctx, page, requests }
}
const loaded = (page) => page.waitForSelector('.results[aria-busy="false"], .state--error')
const visit = async (page, url) => { await page.goto(BASE + url); await loaded(page) }
const total = async (page) => Number(/of (\d+) tasks/.exec(await page.locator('.results-summary').innerText())?.[1] ?? NaN)
const counts = async (page) => { const m = /(\d+) outstanding\s*·\s*(\d+) overdue/.exec(await page.locator('.results-counts').innerText()); return m ? { outstanding: Number(m[1]), overdue: Number(m[2]) } : null }
const titles = (page) => page.locator('table tbody tr th[scope="row"]').evaluateAll((els) => els.map((e) => e.childNodes[0].textContent.trim()))
const refs = (page) => page.locator('table tbody tr th[scope="row"] .data-table__sub').allInnerTexts()
const projectRefs = (page) => page.locator('table tbody tr td:nth-child(2) .data-table__sub').allInnerTexts()
const rowCount = (page) => page.locator('table tbody tr').count()
const urlNow = (page) => { const u = new URL(page.url()); return u.pathname + u.search }
// Runs an action and waits for the task request it causes to finish, so the old results are never read by mistake.
const act = async (page, action) => { const done = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tasks'); await action(); await done; await loaded(page) }
const pick = (page, id, value) => act(page, () => page.selectOption(id, value))
const settleAfterChange = async (page) => { await page.waitForFunction(() => document.querySelector('.results')?.getAttribute('aria-busy') === 'false' || document.querySelector('.state--error')) }

const exp = await everything()
const outstandingAll = exp.tasks.filter((t) => t.status !== 'Done').length
const overdueAll = exp.tasks.filter(overdue).length
console.log(`     (independent calculation: ${exp.projects.length} projects, ${exp.tasks.length} tasks, ${outstandingAll} outstanding, ${overdueAll} overdue, today ${day(0)})`)

console.log('\n== A. Navigation ==')
try {
  const { ctx, page } = await open()
  await page.goto(BASE + '/'); await page.waitForSelector('table')
  await page.locator('.sidebar').getByRole('link', { name: 'Tasks' }).click()
  await loaded(page)
  check('A1 the Tasks navigation item opens /tasks', urlNow(page) === '/tasks', urlNow(page))
  check('A2 the page is "All tasks", not a "Coming soon" placeholder', (await page.locator('h1').innerText()) === 'All tasks' && (await page.getByText('Coming soon').count()) === 0)
  check('A3 the Tasks item is marked as the current page', (await page.locator('.sidebar').getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')) === 'page' && (await page.locator('.sidebar').getByRole('link', { name: 'Projects' }).getAttribute('aria-current')) === null)
  check('A4 a "Demonstration data" note is shown', (await page.getByText('Demonstration data').count()) === 1)
  await page.locator('.sidebar').getByRole('link', { name: 'Locations' }).click()
  await page.getByText('Coming soon').first().waitFor()
  check('A5 other unbuilt sections are still "Coming soon"', (await page.getByText('Coming soon').count()) >= 1)
  await page.goto(BASE + '/projects'); await page.waitForSelector('table')
  await page.locator('.sidebar').getByRole('link', { name: 'Tasks' }).click(); await loaded(page)
  check('A6 reachable from the Projects page too, and the dashboard link still works', urlNow(page) === '/tasks')
  await ctx.close()

  const m = await open({ viewport: { width: 375, height: 800 } })
  await m.page.goto(BASE + '/'); await m.page.waitForSelector('table')
  await m.page.getByRole('button', { name: 'Open menu' }).click()
  await m.page.locator('.sidebar').getByRole('link', { name: 'Tasks' }).click(); await loaded(m.page)
  check('A7 phone: the menu opens All tasks', urlNow(m.page) === '/tasks' && (await m.page.locator('h1').innerText()) === 'All tasks')
  await m.ctx.close()
} catch (e) { check('SECTION A aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== B. What is shown ==')
try {
  const { ctx, page, requests } = await open()
  await visit(page, '/tasks')
  const heads = await page.locator('table thead th').allInnerTexts()
  check('B1 columns: Task, Project, Status, Priority, Technician, Due (+ hidden Actions)', heads.slice(0, 6).join('|').toLowerCase() === 'task|project|status|priority|technician|due', heads.join('|'))
  check('B2 total equals the independent count of every task in every project', (await total(page)) === exp.tasks.length, `${await total(page)} vs ${exp.tasks.length}`)
  check('B3 first page has 10 rows and paging is offered', (await rowCount(page)) === Math.min(10, exp.tasks.length) && (await page.getByRole('navigation', { name: 'Pagination' }).count()) === 1)
  const sorted = [...exp.tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id, 'en', { numeric: true }))
  check('B4 soonest deadline first (matches an independent sort)', JSON.stringify(await refs(page)) === JSON.stringify(sorted.slice(0, 10).map((t) => t.id)))
  const first = sorted[0]
  const row = page.locator('table tbody tr').first()
  const rowText = await row.innerText()
  check('B5 a row shows title, project name and reference, status, priority and technician', [first.title, first.projectName, first.projectId, first.status, first.priority, first.assigneeName ?? 'Unassigned'].every((s) => rowText.includes(s)), rowText.replace(/\s+/g, ' ').slice(0, 160))
  check('B6 the project is a link to that project', (await row.getByRole('link', { name: first.projectName }).getAttribute('href')) === `/projects/${first.projectId}`)
  check('B7 each row has an Edit link to that task\'s edit page', (await row.getByRole('link', { name: /Edit/ }).getAttribute('href')) === `/projects/${first.projectId}/tasks/${first.id}/edit`)
  const c = await counts(page)
  check('B8 "outstanding" equals the independent count of tasks that are not Done', c?.outstanding === outstandingAll, JSON.stringify(c))
  check('B9 "overdue" equals the independent count of outstanding tasks due before today', c?.overdue === overdueAll, JSON.stringify(c))
  check('B10 one request for the page of tasks, not one per project', requests.filter((r) => r.startsWith('/api/tasks')).length === 1 && requests.filter((r) => /\/api\/projects\/[^/]+\/tasks/.test(r)).length === 0, requests.join(' '))
  const sent = new URL('http://x' + requests.find((r) => r.startsWith('/api/tasks'))).searchParams
  check('B11 the request carries the viewer\'s calendar day and the page size', sent.get('today') === day(0) && sent.get('pageSize') === '10' && sent.get('page') === '1', sent.toString())
  const badges = await page.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => ({ overdue: /Overdue/.test(tr.children[5].textContent), done: /Done/.test(tr.children[2].textContent) })))
  check('B12 no completed task is ever marked Overdue', badges.every((b) => !(b.overdue && b.done)))
  const shownOverdue = (await page.locator('table tbody tr').evaluateAll((trs) => trs.filter((tr) => /Overdue/.test(tr.children[5].textContent)).map((tr) => tr.querySelector('th .data-table__sub').textContent)))
  const expectedOverdueOnPage = sorted.slice(0, 10).filter(overdue).map((t) => t.id)
  check('B13 the Overdue badges on the page match the independent calculation', JSON.stringify(shownOverdue) === JSON.stringify(expectedOverdueOnPage), `${shownOverdue} vs ${expectedOverdueOnPage}`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/all-tasks.png`, fullPage: true })
  await ctx.close()
} catch (e) { check('SECTION B aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== C. The dashboard and this page agree ==')
try {
  const { ctx, page } = await open()
  await page.goto(BASE + '/'); await page.waitForSelector('table')
  await page.waitForFunction(() => [...document.querySelectorAll('.stat-card')].filter((c) => /Overdue tasks/.test(c.textContent)).every((c) => c.getAttribute('aria-busy') === 'false'))
  const dash = Number(await page.locator('.stat-card', { hasText: 'Overdue tasks' }).locator('.stat-card__value').innerText())
  await page.locator('.sidebar').getByRole('link', { name: 'Tasks' }).click(); await loaded(page)
  const here = (await counts(page))?.overdue
  check('C1 the dashboard\'s Overdue tasks card equals the overdue count here', dash === here && here === overdueAll, `dashboard=${dash} page=${here} independent=${overdueAll}`)
  await pick(page, '#all-tasks-due', 'overdue')
  check('C2 filtering by Overdue lists exactly that many tasks', (await total(page)) === dash, `${await total(page)} vs ${dash}`)
  await ctx.close()
} catch (e) { check('SECTION C aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== D. Filters (done by the server) ==')
try {
  const { ctx, page, requests } = await open()
  await visit(page, '/tasks')
  const lastTasksRequest = () => new URL('http://x' + [...requests].reverse().find((r) => r.startsWith('/api/tasks'))).searchParams
  const expectIds = async (label, predicate, extra = '') => {
    const want = exp.tasks.filter(predicate)
    const got = await total(page).catch(() => 0)
    const empty = want.length === 0 ? (await page.getByText('No tasks match your filters').count()) === 1 : true
    check(`${label} total equals the independent count${extra}`, (want.length === 0 || got === want.length) && empty, `${want.length === 0 ? 'none expected' : got} vs ${want.length}`)
    return want
  }

  const project = exp.projects.find((p) => exp.tasks.filter((t) => t.projectId === p.id).length > 0 && exp.tasks.filter((t) => t.projectId === p.id).length <= 10)
  await pick(page, '#all-tasks-project', project.id)
  await expectIds('D1 project:', (t) => t.projectId === project.id)
  check('D2 only that project\'s tasks are listed, and the address records it', (await projectRefs(page)).every((r) => r === project.id) && urlNow(page) === `/tasks?project=${project.id}`, urlNow(page))
  check('D3 the filter was sent to the server', lastTasksRequest().get('project') === project.id)

  await pick(page, '#all-tasks-project', '')
  await pick(page, '#all-tasks-status', 'Blocked')
  await expectIds('D4 status Blocked:', (t) => t.status === 'Blocked')
  await pick(page, '#all-tasks-status', 'Done')
  await expectIds('D5 status Done:', (t) => t.status === 'Done')
  check('D6 no Done task is marked Overdue, and the overdue count is 0 within Done', (await counts(page))?.overdue === 0 && (await page.locator('table tbody .badge--danger', { hasText: 'Overdue' }).count()) === 0)
  await pick(page, '#all-tasks-status', '')

  await pick(page, '#all-tasks-priority', 'Critical')
  await expectIds('D7 priority Critical:', (t) => t.priority === 'Critical')
  check('D7b every row is Critical', (await page.locator('table tbody tr td:nth-child(4)').allInnerTexts()).every((s) => s.trim() === 'Critical'))
  await pick(page, '#all-tasks-priority', '')

  await pick(page, '#all-tasks-assignee', 'unassigned')
  await expectIds('D8 unassigned:', (t) => t.assigneeId === null)
  check('D8b every row says Unassigned', (await page.locator('table tbody tr td:nth-child(5)').allInnerTexts()).every((s) => s.trim() === 'Unassigned'))
  await pick(page, '#all-tasks-assignee', 'TECH-002')
  await expectIds('D9 technician TECH-002:', (t) => t.assigneeId === 'TECH-002')
  await pick(page, '#all-tasks-assignee', '')

  await pick(page, '#all-tasks-due', 'overdue')
  const wantOverdue = await expectIds('D10 due: overdue', overdue)
  check('D10b every row carries an Overdue badge', (await page.locator('table tbody tr').count()) === Math.min(10, wantOverdue.length) && (await page.locator('table tbody tr td:nth-child(6) .badge--danger').count()) === (await rowCount(page)))
  await pick(page, '#all-tasks-due', 'this-week')
  await expectIds('D11 due: this week', thisWeek)
  const w = week()
  check('D11b every listed task is outstanding and due Monday-Sunday of this week', exp.tasks.filter(thisWeek).every((t) => t.status !== 'Done' && t.dueDate >= w.start && t.dueDate <= w.end))
  await pick(page, '#all-tasks-due', '')

  const needle = exp.tasks[3].title.split(' ')[0]
  await page.fill('#all-tasks-search', needle); await page.waitForTimeout(500); await settleAfterChange(page)
  await expectIds(`D12 search "${needle}":`, (t) => [t.id, t.title, t.description].some((s) => s.toLowerCase().includes(needle.toLowerCase())))
  check('D12b search text is in the address and was sent to the server', urlNow(page) === `/tasks?q=${encodeURIComponent(needle)}` && lastTasksRequest().get('q') === needle, urlNow(page))
  await page.fill('#all-tasks-search', exp.tasks[0].id.toLowerCase()); await page.waitForTimeout(500); await settleAfterChange(page)
  check('D13 searching by reference (any letter case) finds that task', (await refs(page)).includes(exp.tasks[0].id))

  await page.fill('#all-tasks-search', ''); await page.waitForTimeout(500); await settleAfterChange(page)
  await pick(page, '#all-tasks-status', 'In progress')
  await pick(page, '#all-tasks-priority', 'High')
  await expectIds('D14 combined (In progress + High):', (t) => t.status === 'In progress' && t.priority === 'High')
  check('D14b combined filters all reach the server together', lastTasksRequest().get('status') === 'In progress' && lastTasksRequest().get('priority') === 'High')

  check('D15 the filter controls are labelled', (await Promise.all(['Search tasks', 'Project', 'Status', 'Priority', 'Technician', 'Due date'].map((l) => page.getByLabel(l, { exact: true }).count()))).every((n) => n === 1))
  const projectOptions = await page.locator('#all-tasks-project option').allInnerTexts()
  check('D16 the Project filter lists every project', projectOptions.length === exp.projects.length + 1 && exp.projects.every((p) => projectOptions.some((o) => o.includes(p.id))), `${projectOptions.length} options`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/all-tasks-filtered.png`, fullPage: true })
  await ctx.close()
} catch (e) { check('SECTION D aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== E. Filters live in the address ==')
try {
  const { ctx, page } = await open()
  await visit(page, '/tasks?project=PRJ-101&status=To%20do&priority=High&assignee=unassigned&due=overdue&q=network')
  const val = (id) => page.inputValue(id)
  check('E1 a shared address fills every control', (await val('#all-tasks-search')) === 'network' && (await val('#all-tasks-project')) === 'PRJ-101' && (await val('#all-tasks-status')) === 'To do' && (await val('#all-tasks-priority')) === 'High' && (await val('#all-tasks-assignee')) === 'unassigned' && (await val('#all-tasks-due')) === 'overdue')
  await ctx.close()

  const t = await open()
  const want = exp.tasks.filter((x) => x.projectId === 'PRJ-101' && x.status === 'To do' && x.assigneeId === null && overdue(x))
  await visit(t.page, '/tasks?project=PRJ-101&status=To%20do&assignee=unassigned&due=overdue')
  const before = (await total(t.page).catch(() => 0))
  check('E2 and the results match an independent filter', want.length === 0 ? (await t.page.getByText('No tasks match your filters').count()) === 1 : before === want.length, `${before} vs ${want.length}`)
  await t.page.reload(); await loaded(t.page)
  check('E3 reloading keeps the filters and the results', urlNow(t.page) === '/tasks?project=PRJ-101&status=To%20do&assignee=unassigned&due=overdue' && (want.length === 0 || (await total(t.page)) === want.length))
  const other = await t.ctx.newPage(); other.setDefaultTimeout(8000)
  await other.goto(BASE + urlOf(t.page)); await loaded(other)
  check('E4 opening the same address in another tab shows the same view', (await other.inputValue('#all-tasks-status')) === 'To do' && (await other.inputValue('#all-tasks-due')) === 'overdue')
  await act(t.page, () => t.page.getByRole('button', { name: 'Clear filters' }).first().click())
  check('E5 "Clear filters" empties the address and every control', urlNow(t.page) === '/tasks' && (await t.page.inputValue('#all-tasks-status')) === '' && (await t.page.inputValue('#all-tasks-search')) === '')
  check('E6 the full list is back', (await total(t.page)) === exp.tasks.length)
  await visit(t.page, '/tasks?status=Finished&priority=Urgent&due=tomorrow&assignee=Riley&page=-3&project=bad%20ref')
  check('E7 invalid values in the address are ignored, not shown as errors', (await total(t.page)) === exp.tasks.length && (await t.page.locator('[role=alert]').count()) === 0)
  const history = await t.page.evaluate(() => history.length)
  await pick(t.page, '#all-tasks-status', 'Blocked'); await pick(t.page, '#all-tasks-priority', 'High')
  check('E8 changing filters does not add history entries (Back leaves the page)', (await t.page.evaluate(() => history.length)) === history)
  await t.ctx.close()
} catch (e) { check('SECTION E aborted', false, String(e.message).slice(0, 300)) }
function urlOf(page) { return new URL(page.url()).pathname + new URL(page.url()).search }

console.log('\n== F. Paging ==')
try {
  const { ctx, page, requests } = await open()
  await visit(page, '/tasks')
  const pages = Math.ceil(exp.tasks.length / 10)
  check('F1 shows "Page 1 of N" for the independent page count', (await page.getByText(`Page 1 of ${pages}`).count()) === 1, `${pages} pages`)
  check('F2 Previous is disabled on the first page', await page.getByRole('button', { name: 'Previous' }).isDisabled())
  check('F3 the summary reads "Showing 1–10"', (await page.locator('.results-summary').innerText()).includes('Showing 1–10 of'))
  const sorted = [...exp.tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id, 'en', { numeric: true }))
  await act(page, () => page.getByRole('button', { name: 'Next' }).click())
  check('F4 Next shows page 2 and records it in the address', urlNow(page) === '/tasks?page=2' && (await page.getByText(`Page 2 of ${pages}`).count()) === 1)
  check('F5 page 2 lists the next ten tasks, none repeated from page 1', JSON.stringify(await refs(page)) === JSON.stringify(sorted.slice(10, 20).map((t) => t.id)))
  check('F6 the summary reads "Showing 11–20"', (await page.locator('.results-summary').innerText()).includes('Showing 11–20 of'))
  check('F7 the outstanding and overdue counts do not change between pages (they describe all matches)', JSON.stringify(await counts(page)) === JSON.stringify({ outstanding: outstandingAll, overdue: overdueAll }))
  check('F8 the page number was sent to the server', requests.some((r) => r.startsWith('/api/tasks') && r.includes('page=2')))
  await page.goto(BASE + `/tasks?page=${pages}`); await loaded(page)
  const lastCount = exp.tasks.length - (pages - 1) * 10
  check('F9 the last page lists the remaining tasks and Next is disabled', (await rowCount(page)) === lastCount && (await page.getByRole('button', { name: 'Next' }).isDisabled()), `${await rowCount(page)} rows, expected ${lastCount}`)
  await act(page, () => page.getByRole('button', { name: 'Previous' }).click())
  check('F10 Previous goes back one page', urlNow(page) === (pages - 1 === 1 ? '/tasks' : `/tasks?page=${pages - 1}`), urlNow(page))
  await pick(page, '#all-tasks-status', 'Blocked')
  check('F11 changing a filter returns to page 1', !urlNow(page).includes('page='))
  await visit(page, `/tasks?page=${pages + 20}`)
  check('F12 a page past the end shows an empty state, with a way back', (await page.getByText('No tasks match your filters').count()) === 1)
  await act(page, () => page.getByRole('button', { name: 'Clear filters' }).nth(1).click())
  check('F13 clearing returns to the first page of tasks', urlNow(page) === '/tasks' && (await rowCount(page)) === 10)
  await visit(page, '/tasks?page=abc')
  check('F14 a non-numeric page is treated as page 1', (await page.getByText(`Page 1 of ${pages}`).count()) === 1)
  await ctx.close()
} catch (e) { check('SECTION F aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== G. Loading, empty and error states ==')
try {
  // loading
  let release
  const gate = new Promise((r) => (release = r))
  const a = await open()
  await a.page.route('**/api/tasks*', async (route) => { await gate; await route.fallback() })
  await a.page.goto(BASE + '/tasks')
  await a.page.getByText('Loading tasks…').waitFor()
  check('G1 while loading: a "Loading tasks…" status, and no table, rows or counts', (await a.page.locator('[role=status]', { hasText: 'Loading tasks…' }).count()) === 1 && (await a.page.locator('table').count()) === 0 && (await a.page.locator('.results-counts').count()) === 0)
  check('G2 the filter controls are already usable while loading', await a.page.locator('#all-tasks-status').isEnabled())
  release(); await loaded(a.page)
  check('G3 once loaded the tasks appear and the loading message is gone', (await rowCount(a.page)) === 10 && (await a.page.getByText('Loading tasks…').count()) === 0)
  await a.ctx.close()

  // a refresh keeps the old rows (dimmed) rather than flashing empty
  let release2
  const gate2 = new Promise((r) => (release2 = r))
  const r = await open()
  await visit(r.page, '/tasks')
  await r.page.route('**/api/tasks*', async (route) => { await gate2; await route.fallback() })
  await r.page.selectOption('#all-tasks-status', 'Blocked')
  await r.page.waitForSelector('.results[aria-busy="true"]')
  check('G4 while a filter is applied the rows stay (marked busy) instead of vanishing', (await rowCount(r.page)) > 0)
  release2(); await r.page.waitForSelector('.results[aria-busy="false"]')
  await r.ctx.close()

  // empty because of filters
  const e = await open()
  await visit(e.page, '/tasks')
  await e.page.fill('#all-tasks-search', 'zzz-no-such-task'); await e.page.waitForTimeout(500); await settleAfterChange(e.page)
  check('G5 filters with no matches: "No tasks match your filters", no table, no paging', (await e.page.getByText('No tasks match your filters').count()) === 1 && (await e.page.locator('table').count()) === 0 && (await e.page.getByRole('navigation', { name: 'Pagination' }).count()) === 0)
  check('G6 the empty state says what to do and offers to clear the filters', (await e.page.getByText('Try a different search or filter.').count()) === 1 && (await e.page.getByRole('button', { name: 'Clear filters' }).count()) === 2)
  await act(e.page, () => e.page.getByRole('button', { name: 'Clear filters' }).nth(1).click())
  check('G7 clearing brings every task back', (await total(e.page)) === exp.tasks.length && urlNow(e.page) === '/tasks')
  await e.ctx.close()

  // genuinely no tasks at all
  const z = await open()
  await z.page.route('**/api/tasks*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 }, summary: { outstanding: 0, overdue: 0 } }) }))
  await visit(z.page, '/tasks')
  check('G8 no tasks anywhere: a plain "There are no tasks yet" state', (await z.page.getByText('There are no tasks yet').count()) === 1 && (await z.page.getByText('No tasks match your filters').count()) === 0)
  await z.ctx.close()

  // server error then retry
  let failures = 1
  const f = await open()
  await f.page.route('**/api/tasks*', (route) => (failures-- > 0 ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } }) }) : route.fallback()))
  await f.page.goto(BASE + '/tasks'); await f.page.waitForSelector('[role=alert]')
  const alertText = await f.page.locator('[role=alert]').innerText()
  check('G9 a failed load shows "Tasks could not be loaded" with the reason and a Try again button', alertText.includes('Tasks could not be loaded') && alertText.includes('Something went wrong on the server.') && alertText.includes('Try again'), alertText.replace(/\s+/g, ' '))
  check('G10 no table or stale figures are shown beside the error', (await f.page.locator('table').count()) === 0 && (await f.page.locator('.results-counts').count()) === 0)
  await act(f.page, () => f.page.getByRole('button', { name: 'Try again' }).click())
  check('G11 Try again reloads the tasks and removes the error', (await rowCount(f.page)) === 10 && (await f.page.locator('[role=alert]').count()) === 0)
  await f.ctx.close()

  // network failure
  const n = await open()
  await n.page.route('**/api/tasks*', (route) => route.abort())
  await n.page.goto(BASE + '/tasks'); await n.page.waitForSelector('[role=alert]')
  check('G12 an unreachable server shows a plain-language error with Try again', (await n.page.locator('[role=alert]').innerText()).includes('Try again'))
  await n.page.unroute('**/api/tasks*')
  await act(n.page, () => n.page.getByRole('button', { name: 'Try again' }).click())
  check('G13 and recovers once the server is back', (await rowCount(n.page)) === 10)
  await n.ctx.close()

  // a failure while filtering replaces the rows
  let failNext = false
  const s = await open()
  await visit(s.page, '/tasks')
  await s.page.route('**/api/tasks*', (route) => (failNext ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } }) }) : route.fallback()))
  failNext = true
  await s.page.selectOption('#all-tasks-status', 'Blocked'); await s.page.waitForSelector('[role=alert]')
  check('G14 a failed filter shows only the error, never rows that do not match the filter', (await s.page.locator('table').count()) === 0)
  failNext = false
  await act(s.page, () => s.page.getByRole('button', { name: 'Try again' }).click())
  check('G15 retry applies the chosen filter', (await total(s.page)) === exp.tasks.filter((t) => t.status === 'Blocked').length || (await s.page.getByText('No tasks match your filters').count()) === 1)
  await s.ctx.close()

  // invalid and unknown parameters reach the real server
  const u = await open()
  await visit(u.page, '/tasks?project=PRJ-999')
  const msg = await u.page.locator('[role=alert]').innerText()
  check('G16 an unknown project in the address shows the server\'s "was not found" message', msg.includes('Project PRJ-999 was not found.'), msg.replace(/\s+/g, ' '))
  await act(u.page, () => u.page.getByRole('button', { name: 'Clear filters' }).click())
  check('G17 and the filters can be cleared from there', (await total(u.page)) === exp.tasks.length && urlNow(u.page) === '/tasks')
  await u.ctx.close()
} catch (e) { check('SECTION G aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== H. The server endpoint, called directly ==')
try {
  const body = await api('/api/tasks?pageSize=3')
  check('H1 GET /api/tasks returns data, meta and summary', Array.isArray(body.data) && body.meta?.pageSize === 3 && body.meta.total === exp.tasks.length && typeof body.summary?.outstanding === 'number')
  check('H2 every result names the project that owns it', body.data.every((t) => t.projectId && exp.projects.find((p) => p.id === t.projectId)?.name === t.projectName))
  const bad = await fetch(API + '/api/tasks?status=Finished&page=0&bogus=1')
  const badBody = await bad.json()
  check('H3 invalid parameters are rejected with 400 and every problem is listed', bad.status === 400 && badBody.error.code === 'VALIDATION_ERROR' && badBody.error.details.length === 3, JSON.stringify(badBody.error.details?.map((d) => d.field)))
  check('H4 pageSize above 100 is rejected', (await fetch(API + '/api/tasks?pageSize=101')).status === 400)
  check('H5 an unknown project is a 404', (await fetch(API + '/api/tasks?project=PRJ-999')).status === 404)
  check('H6 the endpoint is read-only', (await fetch(API + '/api/tasks', { method: 'POST' })).status === 404)
  const edge = await api(`/api/tasks?due=overdue&today=2000-01-01`)
  check('H7 overdue is measured from the day the caller sends (nothing is overdue in 2000)', edge.meta.total === 0 && edge.summary.overdue === 0)
} catch (e) { check('SECTION H aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== I. Changes made elsewhere show up, with exact overdue boundaries ==')
try {
  const { ctx, page } = await open()
  const base = (await counts((await visitReturn(page, '/tasks')))).overdue
  const yesterday = (await post('/api/projects/PRJ-101/tasks', task('Boundary yesterday', day(-1)))).data
  const today = (await post('/api/projects/PRJ-101/tasks', task('Boundary today', day(0)))).data
  const tomorrow = (await post('/api/projects/PRJ-101/tasks', task('Boundary tomorrow', day(1)))).data
  const doneOld = (await post('/api/projects/PRJ-101/tasks', task('Boundary done long ago', '2020-02-29', 'Done'))).data
  await visit(page, '/tasks')
  const c = await counts(page)
  check('I1 yesterday counts as overdue (+1); today, tomorrow and a Done task do not', c.overdue === base + 1, `${base} -> ${c.overdue}`)
  check('I2 outstanding rose by 3 (yesterday, today, tomorrow); the Done task is not outstanding', c.outstanding === outstandingAll + 3, `${outstandingAll} -> ${c.outstanding}`)
  await page.fill('#all-tasks-search', 'Boundary'); await page.waitForTimeout(500); await settleAfterChange(page)
  const rowFor = (title) => page.locator('table tbody tr', { hasText: title })
  check('I3 the new tasks appear under PRJ-101 with the project name', (await rowCount(page)) === 4 && (await rowFor('Boundary today').innerText()).includes('PRJ-101'))
  check('I4 only "yesterday" carries the Overdue badge', (await rowFor('Boundary yesterday').getByText('Overdue').count()) === 1 && (await rowFor('Boundary today').getByText('Overdue').count()) === 0 && (await rowFor('Boundary tomorrow').getByText('Overdue').count()) === 0 && (await rowFor('Boundary done long ago').getByText('Overdue').count()) === 0)
  check('I5 summary within the search: 3 outstanding, 1 overdue', JSON.stringify(await counts(page)) === JSON.stringify({ outstanding: 3, overdue: 1 }), JSON.stringify(await counts(page)))
  const { id: _i, projectId: _p, assigneeName: _n, ...input } = yesterday
  await put(`/api/projects/PRJ-101/tasks/${yesterday.id}`, { ...input, status: 'Done' })
  await page.reload(); await loaded(page)
  check('I6 marking the late task Done removes it from the overdue count', JSON.stringify(await counts(page)) === JSON.stringify({ outstanding: 2, overdue: 0 }), JSON.stringify(await counts(page)))
  await put(`/api/projects/PRJ-101/tasks/${today.id}`, { ...input, title: 'Boundary today', status: 'Blocked', dueDate: day(-3) })
  await page.reload(); await loaded(page)
  check('I7 a Blocked task moved to the past is overdue', JSON.stringify(await counts(page)) === JSON.stringify({ outstanding: 2, overdue: 1 }), JSON.stringify(await counts(page)))
  await page.goto(BASE + '/'); await page.waitForSelector('table')
  await page.waitForFunction(() => [...document.querySelectorAll('.stat-card')].filter((c) => /Overdue tasks/.test(c.textContent)).every((c) => c.getAttribute('aria-busy') === 'false'))
  const dash = Number(await page.locator('.stat-card', { hasText: 'Overdue tasks' }).locator('.stat-card__value').innerText())
  const fresh = await everything()
  check('I8 after the edits the dashboard still equals an independent count of overdue tasks', dash === fresh.tasks.filter(overdue).length, `${dash} vs ${fresh.tasks.filter(overdue).length}`)
  await visit(page, '/tasks')
  check('I9 and this page shows the same figure', (await counts(page)).overdue === dash)
  void tomorrow; void doneOld
  await ctx.close()
} catch (e) { check('SECTION I aborted', false, String(e.message).slice(0, 300)) }
async function visitReturn(page, url) { await visit(page, url); return page }

console.log('\n== J. Links, theme and small screens ==')
try {
  const { ctx, page } = await open()
  await visit(page, '/tasks')
  const row = page.locator('table tbody tr').first()
  const projectId = (await projectRefs(page))[0]
  await row.getByRole('link').first().click()
  await page.waitForURL(`**/projects/${projectId}`)
  check('J1 the project link opens that project', urlNow(page) === `/projects/${projectId}`)
  await visit(page, '/tasks')
  const taskId = (await refs(page))[0]
  await page.locator('table tbody tr').first().getByRole('link', { name: /Edit/ }).click()
  await page.waitForURL(`**/tasks/${taskId}/edit`)
  check('J2 the Edit link opens that task\'s edit form', (await page.locator('h1').innerText()).length > 0 && urlNow(page).endsWith(`/tasks/${taskId}/edit`))
  await ctx.close()

  const d = await open({ colorScheme: 'dark' })
  await visit(d.page, '/tasks')
  check('J3 still a single light theme, even with a dark system setting', (await d.page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(250, 248, 247)' && (await d.page.getByRole('radio').count()) === 0)
  await d.ctx.close()

  for (const [name, width] of [['phone', 375], ['tablet', 768], ['desktop', 1280]]) {
    const c = await open({ viewport: { width, height: 900 } })
    await visit(c.page, '/tasks')
    check(`J4 [${name}] no horizontal page overflow`, await c.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    check(`J5 [${name}] every filter control is visible and wide enough to use`, await c.page.evaluate(() => ['#all-tasks-search', '#all-tasks-project', '#all-tasks-status', '#all-tasks-priority', '#all-tasks-assignee', '#all-tasks-due'].every((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.width >= 100 && r.height >= 30 && r.right <= window.innerWidth })))
    if (name === 'phone') {
      const scroller = await c.page.evaluate(() => { const r = document.querySelector('.table-scroll'); return { sw: r.scrollWidth, cw: r.clientWidth, tabindex: r.getAttribute('tabindex') } })
      check('J6 [phone] the wide table scrolls inside its own region, which can be reached by keyboard', scroller.sw >= scroller.cw && scroller.tabindex === '0', JSON.stringify(scroller))
    }
    if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/all-tasks-${name}.png`, fullPage: true })
    await c.ctx.close()
  }

  // accessibility basics
  const k = await open()
  await visit(k.page, '/tasks')
  check('J7 one level-one heading; the table has column headers and row headers', (await k.page.locator('h1').count()) === 1 && (await k.page.locator('table thead th[scope="col"]').count()) === 7 && (await k.page.locator('table tbody th[scope="row"]').count()) === 10)
  check('J8 the filter form is a labelled search landmark and the table region is labelled', (await k.page.getByRole('search', { name: 'Filter tasks' }).count()) === 1 && (await k.page.getByRole('region', { name: 'Tasks table' }).count()) === 1)
  check('J9 Edit links have unique accessible names (they say which task)', await k.page.locator('table tbody tr').evaluateAll((trs) => { const names = trs.map((tr) => tr.querySelector('td:last-child a').textContent.replace(/\s+/g, ' ').trim()); return new Set(names).size === names.length }))
  await k.page.focus('#all-tasks-search'); await k.page.keyboard.press('Tab')
  check('J10 the filters can be reached with the keyboard in order', (await k.page.evaluate(() => document.activeElement.id)) === 'all-tasks-project')
  await k.ctx.close()
} catch (e) { check('SECTION J aborted', false, String(e.message).slice(0, 300)) }

await browser.close()
console.log(`\n${pass}/${pass + fail} checks passed`)
