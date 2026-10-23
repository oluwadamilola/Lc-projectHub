import { launchBrowser } from '../lib/browser.mjs'
import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'

const SHOTS = process.env.SHOTS
const lum = (s) => { const [r, g, b] = s.match(/[\d.]+/g).map(Number); const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
let pass = 0, fail = 0
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`) }
await assertIsolated()
const b = await launchBrowser()
for (const os of ['dark', 'light']) {
  const ctx = await b.newContext({ colorScheme: os, viewport: { width: 1280, height: 800 } })
  // pretend an earlier version saved a dark choice
  await ctx.addInitScript(() => { try { localStorage.setItem('lc-projecthub-theme', 'dark') } catch {} })
  await ctx.route('**/api/**', (r) => { const u = new URL(r.request().url()); return r.continue({ url: API + u.pathname + u.search }) })
  const p = await ctx.newPage(); p.setDefaultTimeout(6000)
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  for (const [name, path, sel] of [['dashboard', '/', 'table'], ['projects', '/projects', 'table'], ['detail', '/projects/PRJ-101', '#tasks table'], ['new project', '/projects/new', 'form'], ['edit project', '/projects/PRJ-101/edit', 'form'], ['new task', '/projects/PRJ-101/tasks/new', 'form'], ['edit task', '/projects/PRJ-101/tasks/TASK-001/edit', 'form']]) {
    await p.goto(BASE + path); await p.waitForSelector(sel)
    const c = await p.evaluate(() => {
      const cs = (e) => getComputedStyle(e)
      const input = document.querySelector('input, select, textarea')
      return { bg: cs(document.body).backgroundColor, sidebar: cs(document.querySelector('.sidebar')).backgroundColor, topbar: cs(document.querySelector('.topbar')).backgroundColor, card: cs(document.querySelector('.card')).backgroundColor, input: input ? cs(input).backgroundColor : null, scheme: cs(document.documentElement).colorScheme, attr: document.documentElement.hasAttribute('data-theme') }
    })
    const allLight = [c.bg, c.sidebar, c.topbar, c.card, c.input].filter(Boolean).every((x) => lum(x) > 0.8)
    check(`[OS ${os}] ${name}: page, sidebar, top bar, cards and form controls are all light`, allLight && c.scheme === 'light' && !c.attr, `${c.bg} / ${c.sidebar} / ${c.card}`)
    if (name === 'detail' && os === 'dark') { if (SHOTS) await p.screenshot({ path: `${SHOTS}/light-only-detail.png` }) }
    if (name === 'new task' && os === 'dark') { if (SHOTS) await p.screenshot({ path: `${SHOTS}/light-only-form.png` }) }
  }
  check(`[OS ${os}] no theme switch anywhere in the top bar`, (await p.locator('[role=radiogroup], [role=radio], .theme-toggle').count()) === 0 && (await p.getByRole('radio').count()) === 0)
  check(`[OS ${os}] no console or page errors`, errors.length === 0, errors.join(' | ').slice(0, 200))
  await ctx.close()
}
// phone: drawer still fine
const m = await b.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 800 } })
await m.route('**/api/**', (r) => { const u = new URL(r.request().url()); return r.continue({ url: API + u.pathname + u.search }) })
const mp = await m.newPage(); mp.setDefaultTimeout(6000)
await mp.goto(BASE + '/projects'); await mp.waitForSelector('table')
check('phone: top bar fits without a toggle (no overflow)', await mp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
await mp.getByRole('button', { name: 'Open menu' }).click()
await mp.locator('#app-sidebar').waitFor({ state: 'visible' })
check('phone: drawer opens, is light, focus moves in', (await mp.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Close menu' && lum(await mp.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).backgroundColor)) > 0.8)
await mp.keyboard.press('Escape'); await mp.locator('#app-sidebar').waitFor({ state: 'hidden' })
check('phone: Escape closes the drawer', true)
await b.close(); console.log(`${pass}/${pass + fail} checks passed`)
