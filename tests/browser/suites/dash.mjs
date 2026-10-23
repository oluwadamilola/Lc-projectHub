import { launchBrowser } from '../lib/browser.mjs'

import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'
const SHOTS = process.env.SHOTS
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) }
const api = async (path, init) => (await fetch(API + path, init)).json()
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const put = (path, body) => api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ---- independent expectation, written separately from the app's code ----
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function thisWeek() {
  const now = new Date()
  const back = (now.getDay() + 6) % 7
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)
  return { mon: iso(mon), sun: iso(sun), nextMon: iso(new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 1)), prevSun: iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 1)) }
}
async function expectedCount() {
  const w = thisWeek()
  const projects = (await api('/api/projects?pageSize=100')).data
  let n = 0, all = 0
  for (const p of projects) {
    const tasks = (await api(`/api/projects/${p.id}/tasks?pageSize=100`)).data
    all += tasks.length
    n += tasks.filter((t) => t.status !== 'Done' && t.dueDate >= w.mon && t.dueDate <= w.sun).length
  }
  return { n, all, projects: projects.length, w }
}
const EXPECTED_CARDS = ['Active projects', 'Need attention', 'Tasks due this week', 'Overdue tasks', 'Equipment deployed']
const task = (title, due, status = 'To do') => ({ title, description: '', status, priority: 'Low', assigneeId: null, startDate: '2026-01-01', dueDate: due })

// Refuses to run unless the page is served through the isolated test stack (never the development server).
await assertIsolated()
const browser = await launchBrowser()
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts })
  const requests = []
  await ctx.route('**/api/**', (route) => {
    const u = new URL(route.request().url())
    requests.push(u.pathname + u.search)
    return route.continue({ url: API + u.pathname + u.search })
  })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  return { ctx, page, requests }
}
const card = (page) => page.locator('.stat-card', { hasText: 'Tasks due this week' })
const value = async (page) => (await card(page).locator('.stat-card__value').innerText()).trim()
const ready = async (page) => { await page.goto(BASE + '/'); await page.waitForSelector('table'); await page.waitForFunction(() => { const c = [...document.querySelectorAll('.stat-card')].find((x) => x.textContent.includes('Tasks due this week')); return c && c.getAttribute('aria-busy') === 'false' }) }

console.log('\n== Q. Tasks due this week: real numbers ==')
try {
  const exp = await expectedCount()
  console.log(`     (independent calculation from the API: week ${exp.w.mon} to ${exp.w.sun}; ${exp.projects} projects, ${exp.all} tasks, ${exp.n} outstanding and due this week)`)
  const { ctx, page, requests } = await open()
  await ready(page)
  const shown = Number(await value(page))
  check('Q1 the dashboard shows the independently calculated count', shown === exp.n, `shown=${shown} expected=${exp.n}`)
  check('Q2 it is not the old hard-coded 14 (unless the real count happens to be 14)', shown !== 14 || exp.n === 14)
  const hint = await card(page).locator('.stat-card__hint').innerText()
  check('Q3 the card states the Monday–Sunday week and that finished tasks are excluded', /Mon \d+ \w+ – Sun \d+ \w+/.test(hint) && /not yet done|Nothing outstanding/i.test(hint), hint)
  const taskCalls = requests.filter((r) => /\/api\/projects\/[^/]+\/tasks/.test(r))
  check('Q4 tasks were requested once per project (existing task API reused, no new endpoint)', taskCalls.length === exp.projects && requests.every((r) => !/\/api\/(tasks|dashboard|stats)/.test(r)), `${taskCalls.length} task requests for ${exp.projects} projects`)
  check('Q5 no "Sample data" badge on this card; 3 sample badges remain (equipment, milestones, activity)', (await card(page).getByText('Sample data').count()) === 0 && (await page.getByText('Sample data').count()) === 3)
  check('Q6 project cards unchanged: Active projects and Need attention come from the projects API', Number(await page.locator('.stat-card', { hasText: 'Active projects' }).locator('.stat-card__value').innerText()) === (await api('/api/projects?pageSize=100')).data.filter((p) => p.status !== 'Complete').length)

  const attention = (await api('/api/projects?pageSize=100')).data.filter((p) => p.status === 'At risk' || p.status === 'Delayed').length
  check('Q6b "Need attention" equals an independent count of At risk + Delayed projects', Number(await page.locator('.stat-card', { hasText: 'Need attention' }).locator('.stat-card__value').innerText()) === attention, `${attention}`)

  // boundaries, driven through the real API
  const w = exp.w
  const base = shown
  const mk = async (t, due, status) => (await post('/api/projects/PRJ-101/tasks', task(t, due, status))).data
  const mon = await mk('Boundary Monday', w.mon)
  const sun = await mk('Boundary Sunday', w.sun)
  await mk('Boundary day before', w.prevSun)
  await mk('Boundary day after', w.nextMon)
  await mk('Boundary done this week', w.mon, 'Done')
  await ready(page)
  check('Q7 Monday and Sunday are counted (+2); the day before, the day after and a Done task are not', Number(await value(page)) === base + 2, `${base} -> ${await value(page)}`)
  const sunTask = (await api('/api/projects/PRJ-101/tasks/' + sun.id)).data
  const { id: _i, projectId: _p, assigneeName: _n, ...input } = sunTask
  await put('/api/projects/PRJ-101/tasks/' + sun.id, { ...input, status: 'Done' })
  await ready(page)
  check('Q8 marking a task Done removes it from the count (-1)', Number(await value(page)) === base + 1, `${await value(page)}`)
  await put('/api/projects/PRJ-101/tasks/' + mon.id, { ...input, title: 'Boundary Monday', dueDate: w.nextMon, status: 'To do' })
  await ready(page)
  check('Q9 moving a due date out of the week removes it from the count (-1)', Number(await value(page)) === base, `${await value(page)}`)
  check('Q10 after all edits the shown count still equals an independent recalculation', Number(await value(page)) === (await expectedCount()).n)
  await ctx.close()
} catch (e) { check('SECTION Q aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== R. Loading, empty and error states ==')
try {
  // loading
  let release
  const gate = new Promise((r) => (release = r))
  const a = await open()
  await a.page.route('**/api/projects/*/tasks*', async (route) => { await gate; await route.fallback() })
  await a.page.goto(BASE + '/'); await a.page.waitForSelector('table')
  const loadingValue = await value(a.page)
  check('R1 while tasks load: a dash and "Loading task data…" — never a number or 0', loadingValue === '—' && (await card(a.page).innerText()).includes('Loading task data…'), loadingValue)
  check('R2 the rest of the dashboard is already usable while it loads', (await a.page.locator('.stat-card', { hasText: 'Active projects' }).locator('.stat-card__value').innerText()) !== '—')
  release()
  await a.page.waitForFunction(() => /^\d+$/.test([...document.querySelectorAll('.stat-card')].find((x) => x.textContent.includes('Tasks due this week')).querySelector('.stat-card__value').textContent.trim()))
  check('R3 once loaded it shows the real number', /^\d+$/.test(await value(a.page)))
  await a.ctx.close()

  // genuine zero
  const z = await open()
  await z.page.route('**/api/projects/*/tasks*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }) }))
  await ready(z.page)
  check('R4 genuinely nothing due: shows 0 with "Nothing outstanding is due …", and no error', (await value(z.page)) === '0' && (await card(z.page).innerText()).includes('Nothing outstanding is due') && (await card(z.page).getByRole('alert').count()) === 0)
  await z.ctx.close()

  // total failure and retry
  const f = await open()
  await f.page.route('**/api/projects/*/tasks*', (route) => route.abort())
  await f.page.goto(BASE + '/'); await f.page.waitForSelector('table')
  await card(f.page).getByRole('alert').waitFor()
  const failed = await card(f.page).innerText()
  check('R5 all task requests fail: a dash, "Task data could not be loaded." and Try again — no 0', (await value(f.page)) === '—' && failed.includes('Task data could not be loaded.') && !/\b0\b/.test(failed.replace(/Mon \d+|Sun \d+/g, '')), failed.replace(/\s+/g, ' '))
  check('R6 the project figures still show while the task figure has failed', (await f.page.locator('.stat-card', { hasText: 'Need attention' }).locator('.stat-card__value').innerText()) !== '—' && (await f.page.locator('table tbody tr').count()) > 0)
  await f.page.unroute('**/api/projects/*/tasks*')
  await card(f.page).getByRole('button', { name: 'Try again' }).click()
  await f.page.waitForFunction(() => /^\d+$/.test([...document.querySelectorAll('.stat-card')].find((x) => x.textContent.includes('Tasks due this week')).querySelector('.stat-card__value').textContent.trim()))
  check('R7 Try again recovers and shows the real number', Number(await value(f.page)) === (await expectedCount()).n)
  await f.ctx.close()

  // one project failing must not give a partial total
  const p1 = await open()
  await p1.page.route('**/api/projects/PRJ-103/tasks*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } }) }))
  await p1.page.goto(BASE + '/'); await p1.page.waitForSelector('table')
  await card(p1.page).getByRole('alert').waitFor()
  check('R8 one project failing gives an error, not a partial total', (await value(p1.page)) === '—')
  await p1.ctx.close()

  // project list failing: no task card, no task requests
  const p2 = await open()
  await p2.page.route('**/api/projects?*', (route) => route.abort())
  await p2.page.goto(BASE + '/'); await p2.page.getByRole('alert').waitFor()
  check('R9 if the projects cannot load there is no task card and no task requests', (await p2.page.getByText('Tasks due this week').count()) === 0 && p2.requests.filter((r) => /tasks/.test(r)).length === 0)
  await p2.ctx.close()
} catch (e) { check('SECTION R aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== S. Layout and existing dashboard behaviour ==')
try {
  for (const [name, width] of [['desktop', 1280], ['phone', 390]]) {
    const c = await open({ viewport: { width, height: 900 } })
    await ready(c.page)
    check(`S1 [${name}] no horizontal overflow`, await c.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    // Five cards is intentional (the overdue card was added as the fifth). Check them by name and order, not just by count.
    const labels = await c.page.locator('.stat-card .stat-card__label').allInnerTexts()
    check(`S2 [${name}] exactly the five intended statistic cards, in order, all visible`, JSON.stringify(labels) === JSON.stringify(EXPECTED_CARDS) && (await c.page.locator('.stat-card:visible').count()) === 5, labels.join(' | '))
    const sampleCards = await c.page.locator('.stat-card', { has: c.page.getByText('Sample data') }).locator('.stat-card__label').allInnerTexts()
    check(`S2b [${name}] only "Equipment deployed" among the cards carries a Sample data label`, JSON.stringify(sampleCards) === JSON.stringify(['Equipment deployed']), sampleCards.join(' | '))
    if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/dashboard-${name}.png`, fullPage: true })
    await c.ctx.close()
  }
  const c = await open({ colorScheme: 'dark' })
  await ready(c.page)
  const bg = await c.page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check('S3 still a single light theme (even with a dark system setting), no theme switch', bg === 'rgb(250, 248, 247)' && (await c.page.getByRole('radio').count()) === 0)
  await c.page.getByRole('link', { name: /View all \d+ projects/ }).click()
  await c.page.waitForURL('**/projects')
  check('S4 "View all projects" link still works', true)
  await c.ctx.close()
} catch (e) { check('SECTION S aborted', false, String(e.message).slice(0, 300)) }

await browser.close()
console.log(`\n${pass}/${pass + fail} checks passed`)
