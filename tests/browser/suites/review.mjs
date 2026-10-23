import { launchBrowser } from '../lib/browser.mjs'

import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
}

process.on('unhandledRejection', () => {})
// Refuses to run unless the page is served through the isolated test stack (never the development server).
await assertIsolated()
const browser = await launchBrowser()
/* ---------- A. Light-only design ---------- */
console.log('\n== A. Light-only design (the Light/Dark switch was removed on purpose) ==')
const lumOf = (s) => { const [r, g, b] = s.match(/[\d.]+/g).map(Number); const q = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2] }
try {
  for (const os of ['dark', 'light']) {
    const ctx = await browser.newContext({ colorScheme: os, viewport: { width: 1280, height: 800 } })
    // A value the removed switch may have saved earlier must have no effect.
    await ctx.addInitScript(() => { try { localStorage.setItem('lc-projecthub-theme', 'dark') } catch {} })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE + '/'); await page.waitForSelector('h1')
    const look = () => page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, sidebar: getComputedStyle(document.querySelector('.sidebar')).backgroundColor, topbar: getComputedStyle(document.querySelector('.topbar')).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme, attr: document.documentElement.hasAttribute('data-theme') }))
    let l = await look()
    check(`A1 [OS ${os}] page, sidebar and top bar are all light (stale saved "dark" ignored)`, l.bg === 'rgb(250, 248, 247)' && lumOf(l.sidebar) > 0.8 && lumOf(l.topbar) > 0.8 && l.scheme === 'light', JSON.stringify(l))
    check(`A2 [OS ${os}] no theme switch and no theme attribute`, !l.attr && (await page.getByRole('radio').count()) === 0 && (await page.getByRole('radiogroup').count()) === 0)
    await page.reload(); await page.waitForSelector('h1')
    l = await look()
    check(`A3 [OS ${os}] still light after a refresh`, l.bg === 'rgb(250, 248, 247)' && !l.attr)
    await page.emulateMedia({ colorScheme: os === 'dark' ? 'light' : 'dark' })
    await new Promise((r) => setTimeout(r, 300))
    check(`A4 [OS ${os}] changing the system setting while open changes nothing`, (await look()).bg === 'rgb(250, 248, 247)')
    check(`A5 [OS ${os}] no page errors`, errors.length === 0, errors.join('; '))
    await ctx.close()
  }
  const blocked = await browser.newContext({ colorScheme: 'light' })
  await blocked.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked') } }) })
  const bp = await blocked.newPage()
  const blockedErrors = []
  bp.on('pageerror', (e) => blockedErrors.push(e.message))
  await bp.goto(BASE + '/'); await bp.waitForSelector('h1')
  check('A6 the app works when browser storage is blocked', blockedErrors.length === 0)
  await blocked.close()
} catch (e) { check('SECTION A aborted', false, String(e.message).slice(0, 200)) }

/* ---------- B. Mobile drawer ---------- */
console.log('\n== B. Mobile drawer ==')
try {
  const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(4000)
  await page.goto(BASE + '/')
  await page.waitForSelector('h1')
  const menu = page.getByRole('button', { name: 'Open menu' })
  const sidebar = page.locator('#app-sidebar')
  check('B1 hamburger visible, drawer hidden on phone', (await menu.isVisible()) && !(await sidebar.isVisible()))
  check('B2 aria-expanded=false when closed', (await menu.getAttribute('aria-expanded')) === 'false')

  // closed drawer must not be reachable by keyboard
  const focusables = await page.evaluate(() => {
    const out = []
    for (let i = 0; i < 6; i++) {}
    return [...document.querySelectorAll('#app-sidebar a, #app-sidebar button')].map((el) => el.checkVisibility?.({ visibilityProperty: true }) ?? true)
  })
  check('B3 closed drawer controls are not rendered/focusable (visibility:hidden)', focusables.every((v) => v === false), JSON.stringify(focusables))

  await menu.click()
  await sidebar.waitFor({ state: 'visible' })
  check('B4 click hamburger -> drawer visible, aria-expanded=true', (await menu.getAttribute('aria-expanded')) === 'true')
  check('B5 scrim shown', await page.locator('.scrim').isVisible())
  const active = await page.evaluate(() => {
    const el = document.activeElement
    return { inSidebar: !!el?.closest('#app-sidebar'), label: el?.getAttribute('aria-label') || el?.textContent?.trim() }
  })
  check('B6 focus moves into the drawer when it opens', active.inSidebar, JSON.stringify(active))

  // can keyboard users reach the drawer links and are they trapped inside?
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const afterTabs = await page.evaluate(() => ({ inSidebar: !!document.activeElement?.closest('#app-sidebar'), text: document.activeElement?.textContent?.trim().slice(0, 30) }))
  check('B7 Tab stays within the open drawer (no tabbing into hidden page behind)', afterTabs.inSidebar, JSON.stringify(afterTabs))

  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('#app-sidebar')?.dataset.open === 'false')
  await sidebar.waitFor({ state: 'hidden' })
  check('B8 Escape closes the drawer', !(await sidebar.isVisible()))
  const back = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  check('B9 focus returns to the hamburger after Escape', back === 'Open menu', String(back))

  await menu.click()
  await sidebar.waitFor({ state: 'visible' })
  await page.locator('.scrim').click({ position: { x: 380, y: 400 } })
  await page.waitForFunction(() => document.querySelector('#app-sidebar')?.dataset.open === 'false')
  check('B10 clicking the scrim closes the drawer', true)

  await menu.click()
  await page.getByRole('button', { name: 'Close menu' }).click()
  await page.waitForFunction(() => document.querySelector('#app-sidebar')?.dataset.open === 'false')
  check('B11 Close button closes the drawer', true)

  await menu.click()
  await page.locator('#app-sidebar').getByRole('link', { name: 'Projects', exact: true }).click()
  await page.waitForURL('**/projects')
  await page.waitForFunction(() => document.querySelector('#app-sidebar')?.dataset.open === 'false')
  await sidebar.waitFor({ state: 'hidden' })
  await page.waitForSelector('h1')
  check('B12 choosing Projects navigates and closes the drawer', (await page.locator('h1').innerText()) === 'Projects')
  await menu.click()
  const current = await page.locator('#app-sidebar a[aria-current=page]').innerText()
  check('B13 current page marked aria-current=page', current.trim() === 'Projects', current)
  await page.keyboard.press('Escape')

  // skip link + visible focus ring
  await page.goto(BASE + '/')
  await page.waitForSelector('h1')
  await page.keyboard.press('Tab')
  const skip = await page.evaluate(() => ({ text: document.activeElement?.textContent, top: document.activeElement?.getBoundingClientRect().top }))
  check('B14 first Tab reaches the skip link and it is on screen', skip.text === 'Skip to main content' && skip.top >= 0, JSON.stringify(skip))
  await page.keyboard.press('Enter')
  const mainFocused = await page.evaluate(() => document.activeElement?.id)
  check('B15 skip link moves focus to main content', mainFocused === 'main-content', String(mainFocused))
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${s.outlineWidth}` })
  check('B16 focused control shows a visible focus ring', /solid 3px/.test(outline), outline)
  await ctx.close()

  // open the drawer on a phone, then widen the window
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 800 } })
    const p = await c.newPage()
    await p.goto(BASE + '/')
    await p.waitForSelector('h1')
    await p.getByRole('button', { name: 'Open menu' }).click()
    await p.setViewportSize({ width: 1280, height: 800 })
    await p.waitForFunction(() => document.querySelector('#app-sidebar')?.dataset.open === 'false')
    const inert = await p.evaluate(() => document.querySelector('.main').hasAttribute('inert'))
    check('B18 widening the window with the drawer open leaves an interactive page (not inert)', !inert)
    await c.close()
  }

  // desktop: no hamburger, sidebar permanent
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const dp = await dctx.newPage()
  await dp.goto(BASE + '/')
  await dp.waitForSelector('h1')
  check('B17 desktop: sidebar permanent, no hamburger/close button', (await dp.locator('#app-sidebar').isVisible()) && !(await dp.getByRole('button', { name: 'Open menu' }).isVisible()) && !(await dp.getByRole('button', { name: 'Close menu' }).isVisible()))
  // resize phone->desktop while drawer open leaves a sane layout
  await dctx.close()
} catch (e) { check('SECTION B aborted', false, String(e.message).slice(0, 200)) }

/* ---------- C. Projects at phone size ---------- */
console.log('\n== C. Projects (390px) ==')
try {
  const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(4000)
  await page.goto(BASE + '/projects')
  await page.waitForSelector('table')
  const overflow = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  let o = await overflow()
  check('C1 no horizontal page overflow after load', o.sw <= o.cw, JSON.stringify(o))
  const scroll = await page.evaluate(() => { const r = document.querySelector('.table-scroll'); return { sw: r.scrollWidth, cw: r.clientWidth } })
  check('C2 table scrolls inside its own container', scroll.sw > scroll.cw, JSON.stringify(scroll))
  const region = page.getByRole('region', { name: 'Projects table' })
  check('C3 scroll container is keyboard focusable', (await region.getAttribute('tabindex')) === '0')
  check('C4 summary reads "Showing 1–10 of 12"', (await page.getByText(/Showing 1–10 of 12/).count()) === 1)

  await page.getByLabel('Search projects').fill('laptop')
  await page.waitForFunction(() => /of 2 projects|of 1 projects/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  const rows = await page.locator('tbody tr').count()
  check('C5 search "laptop" narrows results and updates URL', rows >= 1 && rows <= 3 && page.url().includes('q=laptop'), `rows=${rows} url=${page.url()}`)
  o = await overflow()
  check('C6 no horizontal overflow after search', o.sw <= o.cw)

  await page.getByRole('button', { name: 'Clear filters' }).first().click()
  await page.waitForFunction(() => /of 12 projects/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  check('C7 Clear filters restores all 12 and clears the URL', !page.url().includes('q='))

  await page.getByLabel('Status').selectOption('Delayed')
  await page.waitForFunction(() => /of 2 projects/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  const statuses = await page.locator('tbody tr .badge').allInnerTexts()
  check('C8 status=Delayed shows only Delayed projects (2)', statuses.filter((s) => s === 'Delayed').length === 2 && page.url().includes('status=Delayed'), statuses.join(','))
  await page.getByLabel('Status').selectOption('')

  await page.waitForFunction(() => /of 12 projects/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  await page.getByRole('button', { name: 'Next' }).click()
  await page.waitForFunction(() => /Showing 11–12 of 12/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  check('C9 Next -> page 2 shows 11–12 of 12, Next disabled', (await page.getByRole('button', { name: 'Next' }).isDisabled()) && page.url().includes('page=2'))
  o = await overflow()
  check('C10 no horizontal overflow on page 2', o.sw <= o.cw)
  await page.getByRole('button', { name: 'Previous' }).click()
  await page.waitForFunction(() => /Showing 1–10/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  check('C11 Previous returns to page 1', !page.url().includes('page='))

  // filter + page interplay: changing status while on page 2 resets to page 1
  await page.getByRole('button', { name: 'Next' }).click()
  await page.waitForFunction(() => /Showing 11–12/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  await page.getByLabel('Status').selectOption('On track')
  await page.waitForFunction(() => /of 4 projects/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  check('C12 changing status on page 2 resets to page 1 (no empty page)', (await page.locator('tbody tr').count()) === 4 && !page.url().includes('page='))
  await page.getByLabel('Status').selectOption('')

  await page.waitForFunction(() => /of 12 projects/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  await page.getByRole('link', { name: 'Library Wi-Fi Upgrade' }).click()
  await page.waitForURL('**/projects/PRJ-101')
  await page.getByRole('heading', { name: 'Library Wi-Fi Upgrade', level: 1 }).waitFor()
  o = await overflow()
  check('C13 detail page opens, no horizontal overflow', o.sw <= o.cw, JSON.stringify(o))
  await page.getByRole('link', { name: /Back to projects/ }).click()
  await page.waitForURL('**/projects')
  check('C14 Back to projects works', true)

  // browser Back keeps filters
  await page.getByLabel('Status').selectOption('At risk')
  await page.waitForFunction(() => /of 2 projects/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  await page.getByRole('link', { name: 'Lecture Theatre AV Refresh' }).click()
  await page.waitForURL('**/projects/PRJ-102')
  await page.goBack()
  await page.waitForSelector('table')
  check('C15 browser Back returns to the filtered list', page.url().includes('status=At+risk') || page.url().includes('status=At%20risk'), page.url())
  await ctx.close()
} catch (e) { check('SECTION C aborted', false, String(e.message).slice(0, 200)) }

/* ---------- D. States ---------- */
console.log('\n== D. Loading / empty / error / not-found ==')
try {
  const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1100, height: 800 } })
  const page = await ctx.newPage()
  page.setDefaultTimeout(4000)

  let release
  const gate = new Promise((r) => (release = r))
  await page.route('**/api/projects?**', async (route) => { await gate; await route.fallback() })
  await page.goto(BASE + '/projects')
  await page.getByText('Loading projects…').waitFor()
  check('D1 loading state shown while request pending (role=status)', (await page.getByRole('status').filter({ hasText: 'Loading projects…' }).count()) === 1)
  release()
  await page.waitForSelector('table')
  check('D2 loading state replaced by the table', (await page.getByText('Loading projects…').count()) === 0)
  await page.unroute('**/api/projects?**')

  await page.goto(BASE + '/projects?q=zzzz')
  await page.getByText('No projects match your filters').waitFor()
  check('D3 empty state for a search with no matches', true)
  await page.goto(BASE + '/projects?page=99')
  await page.getByText('No projects match your filters').waitFor()
  check('D4 empty (not broken) for a page beyond the end, with a way back', (await page.getByRole('button', { name: 'Clear filters' }).count()) >= 1)
  await page.goto(BASE + '/projects?status=bogus&page=-2&q=' + 'x'.repeat(300))
  await page.waitForSelector('h1')
  const bogus = await page.locator('table, .state').first().innerText().catch(() => '')
  const searchValue = await page.getByLabel('Search projects').inputValue()
  check('D5 hostile URL params do not crash the page', (await page.locator('h1').innerText()) === 'Projects', `q length shown=${searchValue.length}`)

  // error: network failure
  await page.route('**/api/projects?**', (route) => route.abort())
  await page.goto(BASE + '/projects')
  await page.getByRole('alert').waitFor()
  check('D6 unreachable API shows an error with Try again', (await page.getByRole('alert').innerText()).includes('could not be reached'))
  await page.unroute('**/api/projects?**')
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.waitForSelector('table')
  check('D7 Try again recovers once API is back', (await page.getByRole('alert').count()) === 0)

  // error: API 500 with JSON body
  await page.route('**/api/projects?**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } }) }))
  await page.goto(BASE + '/projects')
  await page.getByRole('alert').waitFor()
  check('D8 API 500 shows the API message', (await page.getByRole('alert').innerText()).includes('Something went wrong on the server.'))
  await page.unroute('**/api/projects?**')

  // a failed refresh must not leave rows that contradict the chosen filter
  await page.goto(BASE + '/projects')
  await page.waitForSelector('table')
  await page.route('**/api/projects?**', (route) => route.abort())
  await page.getByLabel('Status').selectOption('Delayed')
  await page.getByRole('alert').waitFor()
  check('D9 failed refresh replaces rows with the error (no rows that contradict the filter)', (await page.locator('tbody tr').count()) === 0)
  await page.unroute('**/api/projects?**')
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.waitForFunction(() => /of 2 projects/.test(document.querySelector('.results-summary')?.textContent ?? ''))
  check('D9b retry then shows the 2 Delayed projects', (await page.locator('tbody tr').count()) === 2)

  await page.goto(BASE + '/projects/PRJ-999')
  await page.getByText('Project not found').waitFor()
  check('D10 unknown project -> not-found state with link back', (await page.getByRole('link', { name: 'View all projects' }).count()) === 1)
  await page.goto(BASE + '/projects/<script>')
  await page.getByText('Project not found').waitFor()
  check('D11 malformed id -> not-found (and rendered as text, not HTML)', (await page.locator('script', { hasText: 'alert' }).count()) === 0)
  await page.goto(BASE + '/nope')
  await page.getByRole('heading', { name: 'Page not found' }).waitFor()
  check('D12 unknown page -> "Page not found"', true)

  await page.route('**/api/projects/PRJ-101', (route) => route.abort())
  await page.goto(BASE + '/projects/PRJ-101')
  await page.getByRole('alert').waitFor()
  check('D13 detail: unreachable API -> error with retry (not "not found")', (await page.getByText('Project not found').count()) === 0)
  await ctx.close()
} catch (e) { check('SECTION D aborted', false, String(e.message).slice(0, 200)) }

/* ---------- E. Dashboard ---------- */
console.log('\n== E. Dashboard ==')
try {
  const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/')
  await page.waitForSelector('table')
  const text = await page.locator('main').innerText()
  console.log('     page text excerpt:\n' + text.split('\n').filter(Boolean).slice(0, 14).map((l) => '       | ' + l).join('\n'))
  const samples = await page.getByText(/sample/i).count()
  check('E1 only the three hard-coded sections (equipment, milestones, activity) are labelled as sample data', samples === 3, `labels found=${samples}`)
  await ctx.close()
} catch (e) { check('SECTION E aborted', false, String(e.message).slice(0, 200)) }

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) console.log('FAILED:\n - ' + failed.map((f) => f.name).join('\n - '))
