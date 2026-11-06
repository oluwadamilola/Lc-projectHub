import { launchBrowser } from '../lib/browser.mjs'

import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'
const SHOTS = process.env.SHOTS
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) }
const raw = (path, init) => fetch(API + path, init)
const api = async (path, init) => (await raw(path, init)).json()
const post = async (path, body) => (await raw(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()

// Refuses to run unless the page is served through the isolated test stack (never the development server).
await assertIsolated()
const browser = await launchBrowser()
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts })
  const requests = []
  await ctx.route('**/api/**', (route) => { const r = route.request(); const u = new URL(r.url()); requests.push(`${r.method()} ${u.pathname}`); return route.continue({ url: API + u.pathname + u.search }) })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  return { ctx, page, requests }
}

// The two pages that share the menu.
const PAGES = [
  { name: 'All tasks', url: '/tasks', table: 'table', ready: '.results[aria-busy="false"]' },
  { name: 'Project tasks', url: '/projects/PRJ-101', table: '#tasks table', ready: '#tasks table tbody tr' },
]
const visit = async (page, p) => { await page.goto(BASE + p.url); await page.waitForSelector(p.ready); await page.waitForSelector(`${p.table} tbody tr`) }
const rowsOf = (page, p) => page.locator(`${p.table} tbody tr`)
const triggerOf = (page, p, i) => rowsOf(page, p).nth(i).getByRole('button', { name: /^Actions for task / })
const menu = (page) => page.getByRole('menu')
const item = (page, name) => page.getByRole('menuitem', { name })
const urlNow = (page) => { const u = new URL(page.url()); return u.pathname + u.search }
const activeLabel = (page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? document.activeElement?.tagName)
const css = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el)[p], prop)
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

for (const p of PAGES) {
  console.log(`\n== ${p.name}: the actions button and its menu ==`)
  try {
    const { ctx, page, requests } = await open()
    await visit(page, p)
    const n = await rowsOf(page, p).count()
    const buttons = await rowsOf(page, p).evaluateAll((trs) => trs.map((tr) => ({ buttons: tr.querySelectorAll('button').length, inLastCell: !!tr.lastElementChild.querySelector('button[aria-haspopup="menu"]'), editLink: !!tr.querySelector('a[href$="/edit"]'), label: tr.querySelector('button')?.getAttribute('aria-label') })))
    check(`[${p.name}] 1 each row has exactly one button, in the last column, and no separate Edit or Delete controls`, n > 0 && buttons.every((b) => b.buttons === 1 && b.inLastCell && !b.editLink), `${n} rows`)
    check(`[${p.name}] 2 each button's label says which task it is for, and the labels are unique`, buttons.every((b) => /^Actions for task TASK-\d+: /.test(b.label)) && new Set(buttons.map((b) => b.label)).size === n)
    const icon = await triggerOf(page, p, 0).evaluate((b) => ({ svg: !!b.querySelector('svg'), hidden: b.querySelector('svg')?.getAttribute('aria-hidden'), text: b.textContent.trim() }))
    check(`[${p.name}] 3 the button shows only a vertical "⋮" icon (decorative; the label carries the meaning)`, icon.svg && icon.hidden === 'true' && icon.text === '')

    const gaps = await rowsOf(page, p).evaluateAll((trs, sel) => { const t = document.querySelector(sel).getBoundingClientRect(); return trs.map((tr) => Math.round(t.right - tr.querySelector('button').getBoundingClientRect().right)) }, p.table)
    check(`[${p.name}] 4 the button is aligned at the far right, at the same distance in every row`, new Set(gaps).size === 1 && gaps[0] >= 0 && gaps[0] <= 24, JSON.stringify([...new Set(gaps)]))
    // Measure every row with the button in place, then with it taken out: the button must not change the row's height.
    const heights = await rowsOf(page, p).evaluateAll((trs) => trs.map((tr) => { const btn = tr.querySelector('button'); const withIt = tr.getBoundingClientRect().height; btn.style.display = 'none'; const without = tr.getBoundingClientRect().height; btn.style.display = ''; return { withIt, without } }))
    check(`[${p.name}] 5 the button does not make any row taller than it would be without it`, heights.every((h) => h.withIt <= h.without + 0.5), JSON.stringify(heights.slice(0, 3)))
    check(`[${p.name}] 6 the Actions column header is still there for screen readers and still visually hidden`, await page.locator(`${p.table} thead th:last-child`).evaluate((th) => th.textContent.trim() === 'Actions' && th.querySelector('.visually-hidden') !== null))

    // opening and closing
    const t0 = triggerOf(page, p, 0)
    check(`[${p.name}] 7 closed to start with: aria-expanded=false, aria-haspopup=menu, no menu in the page`, (await t0.getAttribute('aria-expanded')) === 'false' && (await t0.getAttribute('aria-haspopup')) === 'menu' && (await menu(page).count()) === 0)
    await t0.click()
    await menu(page).waitFor()
    check(`[${p.name}] 8 clicking opens a compact menu with Edit task and Delete task, and marks the button expanded`, (await menu(page).getByRole('menuitem').allInnerTexts()).map((s) => s.trim()).join('|') === 'Edit task|Delete task' && (await t0.getAttribute('aria-expanded')) === 'true' && (await t0.getAttribute('aria-controls')) === (await menu(page).getAttribute('id')))
    const box = await menu(page).boundingBox()
    check(`[${p.name}] 9 the menu is compact (a small panel, not a full-width bar)`, box.width >= 120 && box.width <= 260 && box.height <= 140, `${Math.round(box.width)}x${Math.round(box.height)}`)
    const icons = await menu(page).evaluate((m) => [...m.querySelectorAll('[role=menuitem]')].map((i) => ({ svg: !!i.querySelector('svg'), paths: i.querySelector('svg')?.querySelector('path')?.getAttribute('d')?.length ?? 0 })))
    check(`[${p.name}] 10 each action has an icon (pencil beside Edit, trash beside Delete)`, icons.length === 2 && icons.every((i) => i.svg && i.paths > 20) && icons[0].paths !== icons[1].paths)
    check(`[${p.name}] 11 focus moves to the first action on open`, (await activeLabel(page)) === 'Edit task')
    const colours = { edit: await css(item(page, 'Edit task'), 'color'), del: await css(item(page, 'Delete task'), 'color') }
    check(`[${p.name}] 12 Delete task is red and Edit task is not`, colours.del === 'rgb(185, 28, 28)' && colours.edit !== colours.del, JSON.stringify(colours))
    check(`[${p.name}] 13 the menu is not inside the table (so the table's scrolling can never clip it) and sits above the page`, await menu(page).evaluate((m) => !m.closest('table') && !m.closest('.table-scroll') && getComputedStyle(m).position === 'fixed' && Number(getComputedStyle(m).zIndex) >= 50))

    await page.locator('h1').first().click() // somewhere neutral on the page
    await menu(page).waitFor({ state: 'detached' })
    check(`[${p.name}] 14 a click outside closes it`, (await t0.getAttribute('aria-expanded')) === 'false')
    await t0.click(); await menu(page).waitFor()
    await page.keyboard.press('Escape')
    await menu(page).waitFor({ state: 'detached' })
    check(`[${p.name}] 15 Escape closes it and focus goes back to that row's button`, (await activeLabel(page)).startsWith('Actions for task '))
    await t0.click(); await menu(page).waitFor()
    await t0.click()
    await menu(page).waitFor({ state: 'detached' })
    check(`[${p.name}] 16 clicking the button again closes it`, true)

    // only one at a time
    await triggerOf(page, p, 0).click(); await menu(page).waitFor()
    await triggerOf(page, p, 1).click()
    await page.waitForFunction(() => document.querySelectorAll('[role=menu]').length === 1 && document.querySelector('[role=menu]').getAttribute('aria-label') !== null)
    const second = await rowsOf(page, p).nth(1).getByRole('button', { name: /^Actions for task / }).getAttribute('aria-label')
    check(`[${p.name}] 17 opening another row's menu closes the first: only one is ever open`, (await menu(page).count()) === 1 && second.includes((await menu(page).getAttribute('aria-label')).replace('Actions for task ', '')) && (await triggerOf(page, p, 0).getAttribute('aria-expanded')) === 'false')
    await page.keyboard.press('Escape')

    // Edit
    const firstTask = (await rowsOf(page, p).nth(0).evaluate((tr) => tr.querySelector('button').getAttribute('aria-label'))).match(/TASK-\d+/)[0]
    await triggerOf(page, p, 0).click(); await menu(page).waitFor()
    const href = await item(page, 'Edit task').getAttribute('href')
    await item(page, 'Edit task').click()
    await page.waitForURL(`**/tasks/${firstTask}/edit`)
    await page.getByLabel('Task title').waitFor()
    check(`[${p.name}] 18 Edit task opens the existing edit page for that task, and the menu is gone`, href.endsWith(`/tasks/${firstTask}/edit`) && urlNow(page).endsWith(`/tasks/${firstTask}/edit`) && (await page.getByLabel('Task title').count()) === 1 && (await menu(page).count()) === 0)

    // Delete opens the existing confirmation and deletes nothing yet
    await visit(page, p)
    const deletesBefore = requests.filter((r) => r.startsWith('DELETE ')).length
    await triggerOf(page, p, 0).focus()
    await triggerOf(page, p, 0).click(); await menu(page).waitFor()
    await item(page, 'Delete task').click()
    await page.getByRole('alertdialog').waitFor()
    const dlg = await page.getByRole('alertdialog').innerText()
    check(`[${p.name}] 19 Delete task closes the menu and opens the existing confirmation dialog, naming the task`, (await menu(page).count()) === 0 && dlg.includes(`Delete task ${firstTask}?`) && /permanently/i.test(dlg) && /cannot be undone/i.test(dlg))
    check(`[${p.name}] 20 nothing is deleted yet: no DELETE request, and the dialog starts on Cancel`, requests.filter((r) => r.startsWith('DELETE ')).length === deletesBefore && (await activeLabel(page)) === 'Cancel')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('alertdialog').waitFor({ state: 'detached' })
    check(`[${p.name}] 21 Cancel leaves the data unchanged and focus returns to that row's button`, (await raw(`/api/projects/PRJ-101/tasks/${firstTask}`)).status !== 500 && (await activeLabel(page)).startsWith(`Actions for task ${firstTask}:`) && requests.filter((r) => r.startsWith('DELETE ')).length === deletesBefore, await activeLabel(page))
    check(`[${p.name}] 22 no horizontal overflow with the menu closed or open`, await noOverflow(page))
    await triggerOf(page, p, 0).click(); await menu(page).waitFor()
    check(`[${p.name}] 23 ... and none with it open`, await noOverflow(page))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/rowmenu-${p.name.replace(/\W+/g, '-').toLowerCase()}.png`, fullPage: false })
    await ctx.close()
  } catch (e) { check(`[${p.name}] SECTION aborted`, false, String(e.message).slice(0, 300)) }

  console.log(`\n== ${p.name}: keyboard ==`)
  try {
    const { ctx, page } = await open()
    await visit(page, p)
    const t0 = triggerOf(page, p, 0)
    await t0.focus()
    await page.keyboard.press('Enter')
    await menu(page).waitFor()
    check(`[${p.name}] K1 Enter on the button opens the menu on its first action`, (await activeLabel(page)) === 'Edit task')
    check(`[${p.name}] K2 the focused action has a clear focus indicator`, await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }))
    await page.keyboard.press('ArrowDown')
    check(`[${p.name}] K3 Down moves to Delete task`, (await activeLabel(page)) === 'Delete task')
    await page.keyboard.press('ArrowDown')
    check(`[${p.name}] K4 Down wraps back to Edit task`, (await activeLabel(page)) === 'Edit task')
    await page.keyboard.press('End')
    check(`[${p.name}] K5 End goes to the last action; Home to the first`, (await activeLabel(page)) === 'Delete task' && (await (async () => { await page.keyboard.press('Home'); return activeLabel(page) })()) === 'Edit task')
    await page.keyboard.press('Escape')
    await menu(page).waitFor({ state: 'detached' })
    check(`[${p.name}] K6 Escape closes it and focus is back on the button, which keeps its focus ring`, (await activeLabel(page)) === (await t0.getAttribute('aria-label')) && await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle !== 'none' }))
    await page.keyboard.press('Space')
    await menu(page).waitFor()
    check(`[${p.name}] K7 Space also opens it`, (await activeLabel(page)) === 'Edit task')
    await page.keyboard.press('Escape')
    await page.keyboard.press('ArrowUp')
    await menu(page).waitFor()
    check(`[${p.name}] K8 Up on the button opens it on the last action`, (await activeLabel(page)) === 'Delete task')
    await page.keyboard.press('Tab')
    await menu(page).waitFor({ state: 'detached' })
    const moved = await page.evaluate((label) => {
      const from = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => b.getAttribute('aria-label') === label)
      const now = document.activeElement
      return { onwards: !!from && now !== from && now !== document.body && !!(from.compareDocumentPosition(now) & Node.DOCUMENT_POSITION_FOLLOWING), inTable: !!now.closest('table') }
    }, await t0.getAttribute('aria-label'))
    check(`[${p.name}] K9 Tab closes it and carries on to the next control after the button (still in the table, not lost at the end of the page)`, moved.onwards && moved.inTable, JSON.stringify(moved))
    await triggerOf(page, p, 0).focus()
    await page.keyboard.press('Enter'); await menu(page).waitFor()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.getByRole('alertdialog').waitFor()
    check(`[${p.name}] K10 Enter on Delete task opens the existing confirmation (and does not delete)`, (await page.getByRole('alertdialog').innerText()).includes('Delete task TASK-') && (await activeLabel(page)) === 'Cancel')
    await page.keyboard.press('Escape')
    await page.getByRole('alertdialog').waitFor({ state: 'detached' })
    check(`[${p.name}] K11 Escape in the confirmation cancels and focus returns to the row's button`, (await activeLabel(page)).startsWith('Actions for task '))
    await triggerOf(page, p, 0).focus(); await page.keyboard.press('Enter'); await menu(page).waitFor()
    await page.keyboard.press('Enter')
    await page.waitForURL('**/edit')
    check(`[${p.name}] K12 Enter on Edit task opens the edit page`, /\/tasks\/TASK-\d+\/edit$/.test(urlNow(page)))
    await ctx.close()

    const h = await open()
    await visit(h.page, p)
    await triggerOf(h.page, p, 0).hover()
    const hoverBg = await css(triggerOf(h.page, p, 0), 'backgroundColor')
    await triggerOf(h.page, p, 0).click(); await menu(h.page).waitFor()
    await item(h.page, 'Delete task').hover()
    const delHover = await css(item(h.page, 'Delete task'), 'backgroundColor')
    await item(h.page, 'Edit task').hover()
    const editHover = await css(item(h.page, 'Edit task'), 'backgroundColor')
    check(`[${p.name}] K13 hovering gives a subtle background on the button and on each action (red-tinted for Delete)`, hoverBg !== 'rgba(0, 0, 0, 0)' && editHover !== 'rgba(0, 0, 0, 0)' && delHover !== editHover, JSON.stringify({ hoverBg, editHover, delHover }))
    await h.ctx.close()
  } catch (e) { check(`[${p.name}] KEYBOARD aborted`, false, String(e.message).slice(0, 300)) }
}

console.log('\n== Not clipped: the last row, a short window, and the scrolling table ==')
try {
  for (const p of PAGES) {
    const { ctx, page } = await open({ viewport: { width: 1280, height: 520 } })
    await visit(page, p)
    const last = rowsOf(page, p).last()
    await last.scrollIntoViewIfNeeded()
    await last.getByRole('button', { name: /^Actions for task / }).click()
    await menu(page).waitFor()
    const r = await menu(page).boundingBox(), vp = page.viewportSize()
    const reachable = await menu(page).evaluate((m) => [...m.querySelectorAll('[role=menuitem]')].every((i) => { const b = i.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return i === top || i.contains(top) }))
    check(`[${p.name}] C1 the menu from the last row is wholly on screen and both actions can be reached (nothing covers or clips them)`, r.x >= 0 && r.y >= 0 && r.x + r.width <= vp.width && r.y + r.height <= vp.height && reachable, JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vp }))
    const trig = await last.getByRole('button', { name: /^Actions for task / }).boundingBox()
    check(`[${p.name}] C2 it opens upwards when there is no room below the button, without covering the button`, r.y + r.height <= trig.y + 1 || r.y >= trig.y + trig.height - 1)
    await ctx.close()
  }
  for (const p of PAGES) {
    const { ctx, page } = await open({ viewport: { width: 375, height: 700 } })
    await visit(page, p)
    const region = page.locator('.table-scroll').first()
    await region.evaluate((el) => { el.scrollLeft = el.scrollWidth })
    await triggerOf(page, p, 0).click(); await menu(page).waitFor()
    const r = await menu(page).boundingBox()
    check(`[${p.name}] C3 phone, table scrolled to its right end: the menu is wholly inside the 375px screen`, r.x >= 0 && r.x + r.width <= 375, JSON.stringify({ x: Math.round(r.x), w: Math.round(r.width) }))
    check(`[${p.name}] C4 phone: no horizontal page overflow, and the table keeps its own scroll area`, (await noOverflow(page)) && (await region.evaluate((el) => el.scrollWidth > el.clientWidth)))
    await region.evaluate((el) => { el.scrollLeft = 0 })
    await page.waitForTimeout(150)
    check(`[${p.name}] C5 scrolling the table sideways closes the menu rather than leaving it floating away from its row`, (await menu(page).count()) === 0)
    await ctx.close()
  }
  const t = await open({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
  await visit(t.page, PAGES[1])
  const size = await triggerOf(t.page, PAGES[1], 0).boundingBox()
  check('[touch] C6 on a touch screen the button is at least 44x44px (easy to tap)', size.width >= 44 && size.height >= 44, `${Math.round(size.width)}x${Math.round(size.height)}`)
  await triggerOf(t.page, PAGES[1], 0).tap()
  await menu(t.page).waitFor()
  const items = await menu(t.page).getByRole('menuitem').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  check('[touch] C7 tapping opens the menu and each action is at least 40px tall', items.length === 2 && items.every((h) => h >= 40), JSON.stringify(items))
  await t.ctx.close()
} catch (e) { check('SECTION C aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== A scroll that moves the page closes the menu; the existing deletion still works end to end ==')
try {
  const { ctx, page } = await open({ viewport: { width: 1280, height: 420 } })
  await visit(page, PAGES[0])
  await triggerOf(page, PAGES[0], 0).click(); await menu(page).waitFor()
  await page.mouse.move(640, 300)
  await page.mouse.wheel(0, 300)
  await menu(page).waitFor({ state: 'detached' })
  check('S1 scrolling the page with the wheel closes the open menu', true)
  await ctx.close()

  const proj = (await post('/api/projects', { name: 'Menu Probe', description: 'Fictional project for the row menu tests.', location: 'Test Annexe', department: 'Infrastructure', lead: 'Casey Lane', priority: 'Low', status: 'On track', progress: 10, startDate: '2026-01-05', dueDate: '2026-12-30' })).data
  const t = (await post(`/api/projects/${proj.id}/tasks`, { title: 'Menu probe task', description: '', status: 'To do', priority: 'Low', assigneeId: null, startDate: '2020-01-01', dueDate: '2099-01-01' })).data
  const one = await open()
  await one.page.goto(`${BASE}/projects/${proj.id}`); await one.page.waitForSelector('#tasks table tbody tr')
  await one.page.getByRole('button', { name: new RegExp(`^Actions for task ${t.id}:`) }).click()
  await item(one.page, 'Delete task').click()
  await one.page.getByRole('alertdialog').getByRole('button', { name: 'Delete task' }).click()
  await one.page.getByText(/was deleted/).waitFor()
  check('S2 delete via the menu: confirming sends exactly one DELETE for that task, the row goes and a message names it', one.requests.filter((r) => r.startsWith('DELETE ')).join() === `DELETE /api/projects/${proj.id}/tasks/${t.id}` && (await one.page.locator('#tasks tbody tr').count()) === 0 && (await raw(`/api/projects/${proj.id}/tasks/${t.id}`)).status === 404)
  await one.ctx.close()

  const dark = await open({ colorScheme: 'dark' })
  await visit(dark.page, PAGES[0])
  await triggerOf(dark.page, PAGES[0], 0).click(); await menu(dark.page).waitFor()
  const look = await menu(dark.page).evaluate((m) => ({ bg: getComputedStyle(m).backgroundColor, body: getComputedStyle(document.body).backgroundColor }))
  check('S3 still a single light theme with a dark system setting: the menu is a white panel on the light page', look.bg === 'rgb(255, 255, 255)' && look.body === 'rgb(250, 248, 247)', JSON.stringify(look))
  await dark.ctx.close()
} catch (e) { check('SECTION S aborted', false, String(e.message).slice(0, 300)) }

await browser.close()
console.log(`\n${pass}/${pass + fail} checks passed`)
