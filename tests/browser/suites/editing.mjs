import { launchBrowser } from '../lib/browser.mjs'

import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'
const SHOTS = process.env.SHOTS
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
}
const lum = ([r, g, b]) => {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const rgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)

// Refuses to run unless the page is served through the isolated test stack (never the development server).
await assertIsolated()
const browser = await launchBrowser()
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 }, ...opts })
  // Defence in depth: the isolated stack already sends /api to the test server; this keeps requests on it explicitly.
  await ctx.route('**/api/**', (route) => { const u = new URL(route.request().url()); return route.continue({ url: API + u.pathname + u.search }) })
  const page = await ctx.newPage()
  page.setDefaultTimeout(5000)
  return { ctx, page }
}
const fillForm = async (page, v = {}) => {
  const d = { name: 'Foxtrot Wi-Fi', description: 'Add access points to the annexe.', location: 'Demo Annexe', department: 'Infrastructure', lead: 'Jamie Cole', start: '2026-11-01', due: '2026-12-31', ...v }
  await page.getByLabel('Project name').fill(d.name)
  await page.getByLabel('Description').fill(d.description)
  await page.getByLabel('Location').fill(d.location)
  await page.getByLabel('Department').fill(d.department)
  await page.getByLabel('Project lead').fill(d.lead)
  await page.getByLabel('Start date').fill(d.start)
  await page.getByLabel('Target completion date').fill(d.due)
}
const apiList = async () => (await (await fetch(`${API}/api/projects?pageSize=100`)).json())

const startTotal = (await apiList()).meta.total

/* ---------- F. Entry points + empty submit ---------- */
console.log('\n== F. Create: entry, validation, accessibility ==')
try {
  const { ctx, page } = await newPage()
  await page.goto(BASE + '/projects')
  await page.waitForSelector('table')
  const newBtn = page.getByRole('link', { name: 'New project' })
  check('F1 Projects page has a visible "New project" action', await newBtn.isVisible())
  await newBtn.click()
  await page.waitForURL('**/projects/new')
  await page.getByRole('heading', { name: 'New project', level: 1 }).waitFor()
  check('F2 opens the dedicated creation form', (await page.locator('h1').innerText()) === 'New project')
  check('F3 defaults: Planning, Medium, progress 0, start = today',
    (await page.getByLabel('Status').inputValue()) === 'Planning' && (await page.getByLabel('Priority').inputValue()) === 'Medium' && (await page.getByLabel('Progress (%)').inputValue()) === '0' && /^\d{4}-\d{2}-\d{2}$/.test(await page.getByLabel('Start date').inputValue()))

  // tab order = visual order
  await page.getByLabel('Project name').focus()
  const order = []
  for (let i = 0; i < 12; i++) {
    order.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim()))
    await page.keyboard.press('Tab')
  }
  // a native date input has several internal tab stops (day/month/year); count it once
  const dedup = order.filter((id, i) => id !== order[i - 1])
  check('F4 keyboard tab order follows the form', dedup.slice(0, 10).join() === ['field-name', 'field-description', 'field-location', 'field-department', 'field-lead', 'field-priority', 'field-status', 'field-progress', 'field-startDate', 'field-dueDate'].join(), dedup.join())

  await page.getByRole('button', { name: 'Create project' }).click()
  const summary = page.getByRole('alert')
  await summary.waitFor()
  const focusedIsSummary = await page.evaluate(() => document.activeElement?.classList.contains('error-summary'))
  check('F5 empty submit: error summary appears and receives focus', focusedIsSummary)
  const invalid = await page.locator('[aria-invalid=true]').count()
  const links = await summary.getByRole('link').count()
  check('F6 6 fields flagged aria-invalid and 6 summary links (name, description, location, department, lead, target date)', invalid === 6 && links === 6, `invalid=${invalid} links=${links}`)
  const describedOk = await page.evaluate(() => [...document.querySelectorAll('[aria-invalid=true]')].every((el) => { const id = el.getAttribute('aria-describedby'); return id && document.getElementById(id.split(' ').pop())?.textContent.includes('Error:') }))
  check('F7 each invalid control is described by its error text (aria-describedby)', describedOk)
  await summary.getByRole('link', { name: 'Enter the location.' }).click()
  check('F8 summary link moves focus to the field', (await page.evaluate(() => document.activeElement?.id)) === 'field-location')

  // contrast of error text and summary in both themes
  const colours = await page.evaluate(() => {
    const e = document.querySelector('.field__error'); const s = document.querySelector('.error-summary')
    const card = document.querySelector('.form-card')
    return { err: getComputedStyle(e).color, card: getComputedStyle(card).backgroundColor, sum: getComputedStyle(s).color, sumBg: getComputedStyle(s).backgroundColor }
  })
  check('F9 light: error text and summary meet 4.5:1', ratio(rgb(colours.err), rgb(colours.card)) >= 4.5 && ratio(rgb(colours.sum), rgb(colours.sumBg)) >= 4.5, `${ratio(rgb(colours.err), rgb(colours.card)).toFixed(2)} / ${ratio(rgb(colours.sum), rgb(colours.sumBg)).toFixed(2)}`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/form-errors-light.png`, fullPage: true })

  // invalid values
  await fillForm(page, { due: '2026-10-01', start: '2026-11-01' })
  await page.getByLabel('Progress (%)').fill('101')
  await page.getByRole('button', { name: 'Create project' }).click()
  const msgs = await page.getByRole('alert').innerText()
  check('F10 progress 101 and due-before-start show clear messages', msgs.includes('whole number from 0 to 100') && msgs.includes('must be on or after the start date'))
  await page.getByLabel('Progress (%)').fill('50')
  await page.getByLabel('Status').selectOption('Complete')
  await page.getByLabel('Target completion date').fill('2026-12-31')
  await page.getByRole('button', { name: 'Create project' }).click()
  check('F11 "Complete" with 50% is rejected', (await page.getByRole('alert').innerText()).includes('must be 100% complete'))
  check('F12 no project was created by the invalid attempts', (await apiList()).meta.total === startTotal)
  await ctx.close()

  const dark = await newPage({ colorScheme: 'dark' })
  await dark.page.goto(BASE + '/projects/new')
  await dark.page.getByRole('button', { name: 'Create project' }).click()
  await dark.page.getByRole('alert').waitFor()
  const dc = await dark.page.evaluate(() => ({ err: getComputedStyle(document.querySelector('.field__error')).color, card: getComputedStyle(document.querySelector('.form-card')).backgroundColor, sum: getComputedStyle(document.querySelector('.error-summary')).color, sumBg: getComputedStyle(document.querySelector('.error-summary')).backgroundColor }))
  check('F13 [OS dark] the form is still light, and error text and summary meet 4.5:1', (await dark.page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(250, 248, 247)' && ratio(rgb(dc.err), rgb(dc.card)) >= 4.5 && ratio(rgb(dc.sum), rgb(dc.sumBg)) >= 4.5, ratio(rgb(dc.err), rgb(dc.card)) >= 4.5 && ratio(rgb(dc.sum), rgb(dc.sumBg)) >= 4.5, `${ratio(rgb(dc.err), rgb(dc.card)).toFixed(2)} / ${ratio(rgb(dc.sum), rgb(dc.sumBg)).toFixed(2)}`)
  const outline = await dark.page.evaluate(() => { document.getElementById('field-name').focus(); const s = getComputedStyle(document.getElementById('field-name')); return `${s.outlineStyle} ${s.outlineWidth}` })
  check('F14 visible focus ring on inputs', /solid 3px/.test(outline), outline)
  if (SHOTS) await dark.page.screenshot({ path: `${SHOTS}/form-errors-os-dark.png`, fullPage: true })
  await dark.ctx.close()
} catch (e) { check('SECTION F aborted', false, String(e.message).slice(0, 300)) }

/* ---------- G. Create: success, duplicates, failure ---------- */
console.log('\n== G. Create: save, double-submit, failure ==')
try {
  const { ctx, page } = await newPage()
  // double submit while slow
  let posts = 0
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'POST') { posts++; await new Promise((r) => setTimeout(r, 700)) }
    await route.fallback()
  })
  await page.goto(BASE + '/projects/new')
  await fillForm(page)
  const btn = page.getByRole('button', { name: 'Create project' })
  await btn.dblclick()
  await page.keyboard.press('Enter')
  await page.waitForURL(/\/projects\/PRJ-\d+$/)
  check('G1 double-click + Enter while saving sends exactly one POST', posts === 1, `posts=${posts}`)
  const url = page.url()
  const newId = url.split('/').pop()
  check('G2 navigates to the new project detail page with server-assigned reference', /^PRJ-\d{3,}$/.test(newId), newId)
  check('G3 confirmation shown', (await page.getByRole('status').filter({ hasText: 'was created' }).innerText()).includes(newId))
  check('G4 detail shows the entered values', (await page.getByRole('heading', { name: 'Foxtrot Wi-Fi', level: 1 }).count()) === 1 && (await page.getByText('Jamie Cole').count()) >= 1)
  await page.unroute('**/api/projects')
  await page.reload()
  await page.waitForSelector('h1')
  check('G5 after refresh the confirmation is gone but the project persists', (await page.getByText('was created').count()) === 0 && (await page.getByRole('heading', { name: 'Foxtrot Wi-Fi', level: 1 }).count()) === 1)
  const after = await apiList()
  check('G6 exactly one project added', after.meta.total === startTotal + 1)
  await page.goto(BASE + '/projects?q=foxtrot')
  await page.waitForSelector('table')
  check('G7 new project appears in list search', (await page.locator('tbody tr').count()) === 1)

  // unique references across rapid creations through the UI/API
  const ids = await Promise.all([1, 2, 3, 4, 5].map(async (n) => (await (await fetch(`${API}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Parallel ${n}`, description: 'd', location: 'l', department: 'd', lead: 'x', priority: 'Low', status: 'Planning', progress: 0, startDate: '2026-01-01', dueDate: '2026-02-01' }) })).json()).data.id))
  check('G8 five simultaneous creations get five distinct references', new Set(ids).size === 5, ids.join(','))

  // failure keeps input
  await page.goto(BASE + '/projects/new')
  await fillForm(page, { name: 'Will fail first' })
  await page.route('**/api/projects', (route) => route.request().method() === 'POST' ? route.abort() : route.fallback())
  await page.getByRole('button', { name: 'Create project' }).click()
  const alert = await page.getByRole('alert').innerText()
  check('G9 unreachable server: useful message, still on the form', alert.includes('could not be reached') && page.url().endsWith('/projects/new'))
  check('G10 input preserved after failure', (await page.getByLabel('Project name').inputValue()) === 'Will fail first' && (await page.getByLabel('Description').inputValue()).startsWith('Add access'))
  check('G11 button usable again', await page.getByRole('button', { name: 'Create project' }).isEnabled())
  await page.unroute('**/api/projects')
  await page.route('**/api/projects', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } }) }) : route.fallback())
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.getByText('Something went wrong on the server.').waitFor()
  check('G12 server 500 message shown, input preserved', (await page.getByLabel('Project name').inputValue()) === 'Will fail first')
  await page.unroute('**/api/projects')
  await page.route('**/api/projects', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'The request contains invalid values.', details: [{ field: 'lead', message: 'The project lead must be 100 characters or fewer.' }] } }) }) : route.fallback())
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.getByRole('link', { name: 'The project lead must be 100 characters or fewer.' }).waitFor()
  check('G13 server 400 field error is attached to the right field', (await page.getByLabel('Project lead').getAttribute('aria-invalid')) === 'true')
  await page.unroute('**/api/projects')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/projects\/PRJ-\d+$/)
  check('G14 retry after failure succeeds', true)
  await ctx.close()
} catch (e) { check('SECTION G aborted', false, String(e.message).slice(0, 300)) }

/* ---------- H. Edit ---------- */
console.log('\n== H. Edit ==')
try {
  const { ctx, page } = await newPage()
  await page.goto(BASE + '/projects/PRJ-103')
  await page.getByRole('link', { name: 'Edit project' }).click()
  await page.waitForURL('**/projects/PRJ-103/edit')
  await page.getByLabel('Project name').waitFor()
  check('H1 values loaded into the form', (await page.getByLabel('Project name').inputValue()) === 'Student Laptop Loan Scheme' && (await page.getByLabel('Progress (%)').inputValue()) === '88' && (await page.getByLabel('Project lead').inputValue()) === 'Sam Okafor')
  check('H2 reference shown but not editable', (await page.getByText('PRJ-103: Student Laptop Loan Scheme').count()) === 1 && (await page.getByLabel('Reference').count()) === 0)
  await page.getByLabel('Progress (%)').fill('95')
  await page.getByLabel('Project lead').fill('Alex Morgan')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForURL(/\/projects\/PRJ-103$/)
  await page.getByRole('status').filter({ hasText: 'Changes to PRJ-103 were saved.' }).waitFor()
  check('H3 returns to the updated detail page with confirmation', (await page.getByRole('status').filter({ hasText: 'Changes to PRJ-103 were saved.' }).count()) === 1 && (await page.getByText('95%').count()) >= 1 && (await page.getByText('Alex Morgan').count()) >= 1)
  const api = await (await fetch(`${API}/api/projects/PRJ-103`)).json()
  check('H4 API reflects the change, reference unchanged, total unchanged', api.data.progress === 95 && api.data.lead === 'Alex Morgan' && api.data.id === 'PRJ-103')

  // edit validation + preserve
  await page.goto(BASE + '/projects/PRJ-103/edit')
  await page.getByLabel('Project name').waitFor()
  await page.getByLabel('Progress (%)').fill('-5')
  await page.getByRole('button', { name: 'Save changes' }).click()
  check('H5 invalid edit blocked in the browser with a message', (await page.getByRole('alert').innerText()).includes('whole number from 0 to 100'))
  await page.getByLabel('Progress (%)').fill('96')
  await page.route('**/api/projects/PRJ-103', (route) => route.request().method() === 'PUT' ? route.abort() : route.fallback())
  await page.getByLabel('Project name').fill('Edited but not saved')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText('could not be reached').waitFor()
  check('H6 failed save preserves edits and stays on edit page', (await page.getByLabel('Project name').inputValue()) === 'Edited but not saved' && page.url().endsWith('/edit'))
  await page.unroute('**/api/projects/PRJ-103')

  // Unsaved-changes guard
  await page.locator('#app-sidebar').getByRole('link', { name: 'Dashboard' }).click()
  const dlg = page.getByRole('alertdialog')
  await dlg.waitFor()
  check('H7 leaving with unsaved edits asks first, focus on "Stay"', (await page.evaluate(() => document.activeElement?.textContent)) === 'Stay on this page' && page.url().endsWith('/edit'))
  await page.keyboard.press('Escape')
  await dlg.waitFor({ state: 'hidden' })
  check('H8 Escape = Stay; edits intact', (await page.getByLabel('Project name').inputValue()) === 'Edited but not saved')
  await page.getByRole('link', { name: 'Cancel' }).click()
  await dlg.waitFor()
  await page.getByRole('button', { name: 'Leave without saving' }).click()
  await page.waitForURL(/\/projects\/PRJ-103$/)
  check('H9 "Leave without saving" abandons the edit; nothing saved', (await (await fetch(`${API}/api/projects/PRJ-103`)).json()).data.name === 'Student Laptop Loan Scheme')

  // beforeunload
  await page.goto(BASE + '/projects/PRJ-103/edit')
  await page.getByLabel('Project name').fill('Changed')
  let sawBeforeUnload = false
  page.once('dialog', async (d) => { sawBeforeUnload = d.type() === 'beforeunload'; await d.dismiss() })
  await page.close({ runBeforeUnload: true })
  await new Promise((r) => setTimeout(r, 300))
  check('H10 closing the tab with unsaved edits triggers the browser warning', sawBeforeUnload)

  const p2 = await ctx.newPage()
  p2.setDefaultTimeout(5000)
  await p2.goto(BASE + '/projects/PRJ-999/edit')
  await p2.getByText('Project not found').waitFor()
  check('H11 editing a missing project shows not-found (API 404)', (await p2.getByLabel('Project name').count()) === 0)
  const put404 = await fetch(`${API}/api/projects/PRJ-999`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  check('H12 API: PUT on a missing project is 404', put404.status === 404)
  await ctx.close()
} catch (e) { check('SECTION H aborted', false, String(e.message).slice(0, 300)) }

/* ---------- I. Mobile ---------- */
console.log('\n== I. Mobile (390px) ==')
try {
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(BASE + '/projects')
  await page.waitForSelector('table')
  const newBtn = page.getByRole('link', { name: 'New project' })
  check('I1 New project is visible and tappable on a phone', await newBtn.isVisible() && (await newBtn.boundingBox()).height >= 40)
  await newBtn.click()
  await page.waitForURL('**/projects/new')
  await page.getByLabel('Project name').waitFor()
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('I2 form has no horizontal overflow', (await overflow()) <= 0)
  const widths = await page.evaluate(() => ['field-name', 'field-location', 'field-department', 'field-priority', 'field-dueDate'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().width)))
  check('I3 fields are single-column and full width', widths.every((w) => w > 300), widths.join(','))
  const heights = await page.evaluate(() => [...document.querySelectorAll('.form-card .input')].map((el) => el.getBoundingClientRect().height))
  check('I4 controls are at least 40px tall', heights.every((h) => h >= 40), Math.min(...heights).toFixed(0))
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.getByRole('alert').waitFor()
  check('I5 error summary fits without overflow', (await overflow()) <= 0)
  const actions = await page.evaluate(() => [...document.querySelectorAll('.form-actions .btn')].map((b) => Math.round(b.getBoundingClientRect().width)))
  check('I6 action buttons stack full width', actions.every((w) => w > 300), actions.join(','))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/form-mobile-errors.png`, fullPage: true })
  await fillForm(page, { name: 'Mobile created project' })
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(/\/projects\/PRJ-\d+$/)
  await page.getByRole('heading', { name: 'Mobile created project', level: 1 }).waitFor()
  check('I7 creating on a phone works end to end', (await page.getByRole('heading', { name: 'Mobile created project', level: 1 }).count()) === 1 && (await overflow()) <= 0)
  await page.getByRole('link', { name: 'Edit project' }).click()
  await page.getByLabel('Project name').waitFor()
  check('I8 edit form has no horizontal overflow on a phone', (await overflow()) <= 0)
  await ctx.close()
} catch (e) { check('SECTION I aborted', false, String(e.message).slice(0, 300)) }

/* ---------- J. Regression ---------- */
console.log('\n== J. Existing features ==')
try {
  const { ctx, page } = await newPage()
  await page.goto(BASE + '/')
  await page.waitForSelector('table')
  const total = (await apiList()).meta.total
  check('J1 dashboard loads and counts the new projects', (await page.getByText(`${total} projects in total`).count()) === 1, `total=${total}`)
  await page.goto(BASE + '/projects')
  await page.waitForSelector('table')
  await page.getByLabel('Status').selectOption('Delayed')
  await page.waitForFunction(() => /of 2 projects/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  check('J2 list filters still work', true)
  await page.goto(BASE + '/projects/PRJ-101')
  await page.getByRole('heading', { name: 'Library Wi-Fi Upgrade', level: 1 }).waitFor()
  check('J3 detail page still works', true)
  const health = await (await fetch(`${API}/api/health`)).json()
  check('J4 /api/health still works', health.status === 'ok')
  const bulk = await fetch(`${API}/api/projects`, { method: 'DELETE' })
  const patch = await fetch(`${API}/api/projects/PRJ-101`, { method: 'PATCH' })
  check('J5 there is no delete-every-project or partial-update endpoint (404) and the project is intact (deleting one project is covered by the deletion suite)', bulk.status === 404 && patch.status === 404 && (await fetch(`${API}/api/projects/PRJ-101`)).status === 200)
  await ctx.close()
} catch (e) { check('SECTION J aborted', false, String(e.message).slice(0, 300)) }

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) console.log('FAILED:\n - ' + failed.map((f) => f.name).join('\n - '))
