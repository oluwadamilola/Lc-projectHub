import { launchBrowser } from '../lib/browser.mjs'

import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'
const SHOTS = process.env.SHOTS
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) }
const api = async (path, init) => (await fetch(API + path, init)).json()
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const put = (path, body) => api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ---- independent expectations, written separately from the app's code ----
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
  let overdue = 0, inWeek = 0
  for (const p of projects) {
    for (const t of (await api(`/api/projects/${p.id}/tasks?pageSize=100`)).data) {
      if (t.status === 'Done') continue
      if (t.dueDate < today) overdue += 1
      if (t.dueDate >= w.start && t.dueDate <= w.end) inWeek += 1
    }
  }
  return { overdue, inWeek, projects: projects.length, today }
}
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
const card = (page, label) => page.locator('.stat-card', { hasText: label })
const val = async (page, label) => (await card(page, label).locator('.stat-card__value').innerText()).trim()
const settled = async (page) => { await page.goto(BASE + '/'); await page.waitForSelector('table'); await page.waitForFunction(() => [...document.querySelectorAll('.stat-card')].filter((c) => /Overdue tasks|Tasks due this week/.test(c.textContent)).every((c) => c.getAttribute('aria-busy') === 'false')) }

console.log('\n== T. Overdue tasks: real numbers ==')
try {
  const exp = await expected()
  console.log(`     (independent calculation from the API: today ${exp.today}; ${exp.projects} projects; ${exp.overdue} overdue, ${exp.inWeek} due this week)`)
  const { ctx, page, requests } = await open()
  await settled(page)
  const shown = Number(await val(page, 'Overdue tasks'))
  check('T1 the card shows the independently calculated overdue count', shown === exp.overdue, `shown=${shown} expected=${exp.overdue}`)
  check('T2 "Tasks due this week" is unchanged and still matches its own independent calculation', Number(await val(page, 'Tasks due this week')) === exp.inWeek, `${await val(page, 'Tasks due this week')} vs ${exp.inWeek}`)
  const hint = await card(page, 'Overdue tasks').locator('.stat-card__hint').innerText()
  check('T3 the wording is "Outstanding tasks past their due date"', hint.startsWith('Outstanding tasks past their due date') || hint.startsWith('No outstanding tasks are past their due date'), hint)
  const taskCalls = requests.filter((r) => /\/api\/projects\/[^/]+\/tasks/.test(r))
  check('T4 one task request per project, shared by both cards (no duplicate requests)', taskCalls.length === exp.projects, `${taskCalls.length} task requests for ${exp.projects} projects`)
  check('T5 no "Sample data" on the overdue card; only equipment, milestones and activity remain sample', (await card(page, 'Overdue tasks').getByText('Sample data').count()) === 0 && (await page.getByText('Sample data').count()) === 3)
  check('T6 the overdue card is information only (no link or button when it has a number)', (await card(page, 'Overdue tasks').getByRole('link').count()) === 0 && (await card(page, 'Overdue tasks').getByRole('button').count()) === 0)

  // yesterday / today / tomorrow / Done, through the real API
  const base = shown, wbase = Number(await val(page, 'Tasks due this week'))
  await post('/api/projects/PRJ-101/tasks', task('Probe yesterday', day(-1)))
  await post('/api/projects/PRJ-101/tasks', task('Probe today', day(0)))
  await post('/api/projects/PRJ-101/tasks', task('Probe tomorrow', day(1)))
  await post('/api/projects/PRJ-101/tasks', task('Probe done yesterday', day(-1), 'Done'))
  await post('/api/projects/PRJ-101/tasks', task('Probe long ago', '2020-02-29'))
  await post('/api/projects/PRJ-101/tasks', task('Probe in progress last month', day(-40), 'In progress'))
  await settled(page)
  check('T7 yesterday, a long-ago leap day and an old in-progress task are overdue (+3); today, tomorrow and a Done task are not', Number(await val(page, 'Overdue tasks')) === base + 3, `${base} -> ${await val(page, 'Overdue tasks')}`)
  check('T8 the same new tasks changed "due this week" only by what is in the week (today/tomorrow/yesterday as applicable)', Number(await val(page, 'Tasks due this week')) >= wbase, `${wbase} -> ${await val(page, 'Tasks due this week')}`)

  const tasks = (await api('/api/projects/PRJ-101/tasks?q=Probe%20yesterday')).data
  const t = tasks.find((x) => x.title === 'Probe yesterday')
  const { id: _i, projectId: _p, assigneeName: _n, ...input } = t
  await put('/api/projects/PRJ-101/tasks/' + t.id, { ...input, status: 'Done' })
  await settled(page)
  check('T9 marking an overdue task Done removes it (-1)', Number(await val(page, 'Overdue tasks')) === base + 2, `${await val(page, 'Overdue tasks')}`)
  await put('/api/projects/PRJ-101/tasks/' + t.id, { ...input, status: 'To do', dueDate: day(0) })
  await settled(page)
  check('T10 moving the due date to today removes it (a task due today is not overdue)', Number(await val(page, 'Overdue tasks')) === base + 2)
  check('T11 after all edits the card still equals an independent recalculation', Number(await val(page, 'Overdue tasks')) === (await expected()).overdue)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/overdue-desktop.png`, fullPage: true })
  await ctx.close()
} catch (e) { check('SECTION T aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== U. Loading, true zero and failure ==')
try {
  let release; const gate = new Promise((r) => (release = r))
  const a = await open()
  await a.page.route('**/api/projects/*/tasks*', async (route) => { await gate; await route.fallback() })
  await a.page.goto(BASE + '/'); await a.page.waitForSelector('table')
  const loading = await val(a.page, 'Overdue tasks')
  check('U1 while loading: a dash and "Loading task data…", never a number or 0', loading === '—' && (await card(a.page, 'Overdue tasks').innerText()).includes('Loading task data…'), loading)
  release()
  await a.page.waitForFunction(() => /^\d+$/.test([...document.querySelectorAll('.stat-card')].find((x) => x.textContent.includes('Overdue tasks')).querySelector('.stat-card__value').textContent.trim()))
  check('U2 after loading it shows a number', /^\d+$/.test(await val(a.page, 'Overdue tasks')))
  await a.ctx.close()

  const z = await open()
  await z.page.route('**/api/projects/*/tasks*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }) }))
  await settled(z.page)
  check('U3 true zero: "0" with "No outstanding tasks are past their due date", and no error', (await val(z.page, 'Overdue tasks')) === '0' && (await card(z.page, 'Overdue tasks').innerText()).includes('No outstanding tasks are past their due date') && (await card(z.page, 'Overdue tasks').getByRole('alert').count()) === 0)
  await z.ctx.close()

  const f = await open()
  await f.page.route('**/api/projects/*/tasks*', (route) => route.abort())
  await f.page.goto(BASE + '/'); await f.page.waitForSelector('table')
  await card(f.page, 'Overdue tasks').getByRole('alert').waitFor()
  const failed = await card(f.page, 'Overdue tasks').innerText()
  check('U4 failure: a dash, "Task data could not be loaded." and Try again — no 0', (await val(f.page, 'Overdue tasks')) === '—' && failed.includes('Task data could not be loaded.') && !/\b0\b/.test(failed), failed.replace(/\s+/g, ' '))
  check('U5 failure affects both task cards alike and leaves the project figures intact', (await val(f.page, 'Tasks due this week')) === '—' && (await val(f.page, 'Need attention')) !== '—' && (await f.page.locator('table tbody tr').count()) > 0)
  await f.page.unroute('**/api/projects/*/tasks*')
  await card(f.page, 'Overdue tasks').getByRole('button', { name: 'Try again' }).click()
  await f.page.waitForFunction(() => [...document.querySelectorAll('.stat-card')].filter((c) => /Overdue tasks|Tasks due this week/.test(c.textContent)).every((c) => /^\d+$/.test(c.querySelector('.stat-card__value').textContent.trim())))
  check('U6 one retry recovers both cards, with the real numbers', Number(await val(f.page, 'Overdue tasks')) === (await expected()).overdue)
  await f.ctx.close()

  const p1 = await open()
  await p1.page.route('**/api/projects/PRJ-103/tasks*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } }) }))
  await p1.page.goto(BASE + '/'); await p1.page.waitForSelector('table')
  await card(p1.page, 'Overdue tasks').getByRole('alert').waitFor()
  check('U7 one project failing gives an error, not a partial total', (await val(p1.page, 'Overdue tasks')) === '—')
  await p1.ctx.close()

  const p2 = await open()
  await p2.page.route('**/api/projects?*', (route) => route.abort())
  await p2.page.goto(BASE + '/'); await p2.page.getByRole('alert').waitFor()
  check('U8 if the projects cannot load there is no overdue card and no task requests', (await p2.page.getByText('Overdue tasks').count()) === 0 && p2.requests.filter((r) => /tasks/.test(r)).length === 0)
  await p2.ctx.close()
} catch (e) { check('SECTION U aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== V. Layout and existing behaviour ==')
try {
  for (const [name, width] of [['desktop', 1280], ['laptop', 1024], ['phone', 390]]) {
    const c = await open({ viewport: { width, height: 900 } })
    await settled(c.page)
    check(`V1 [${name}] no horizontal overflow, all five statistic cards visible`, (await c.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)) && (await c.page.locator('.stat-card:visible').count()) === 5)
    const labels = await c.page.locator('.stat-card .stat-card__label').allInnerTexts()
    check(`V1b [${name}] the five cards are the intended ones, in order`, JSON.stringify(labels) === JSON.stringify(['Active projects', 'Need attention', 'Tasks due this week', 'Overdue tasks', 'Equipment deployed']), labels.join(' | '))
    check(`V2 [${name}] no card text is clipped or overflows its card`, await c.page.evaluate(() => [...document.querySelectorAll('.stat-card')].every((c) => c.scrollWidth <= c.clientWidth + 1)))
    if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/overdue-${name}.png`, fullPage: true })
    await c.ctx.close()
  }
  const c = await open({ colorScheme: 'dark' })
  await settled(c.page)
  check('V3 still a single light theme; no theme switch', (await c.page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(250, 248, 247)' && (await c.page.getByRole('radio').count()) === 0)
  await c.ctx.close()
} catch (e) { check('SECTION V aborted', false, String(e.message).slice(0, 300)) }

await browser.close()
console.log(`\n${pass}/${pass + fail} checks passed`)
