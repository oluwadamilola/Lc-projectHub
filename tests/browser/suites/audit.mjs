import { launchBrowser } from '../lib/browser.mjs'

import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'
const SHOTS = process.env.SHOTS
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) }
const raw = (path, init) => fetch(API + path, init)
const api = async (path) => (await raw(path)).json()
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---- Independent expectations: built from every room's own detail record, never from the aggregated figures the pages show ----
const cycles = (await api('/api/audit/cycles')).data
const byName = (name) => cycles.find((c) => c.name === name)
const openC = byName('Summer 2027'), c2026 = byName('Summer 2026'), c2025 = byName('Summer 2025')
const blocks = (await api('/api/audit/blocks')).data
const rooms = []
for (let page = 1; ; page += 1) {
  const body = await api(`/api/audit/rooms?status=all&pageSize=100&page=${page}`)
  rooms.push(...body.data)
  if (page >= body.meta.totalPages) break
}
const floorsByBlock = new Map()
for (const b of blocks) floorsByBlock.set(b.id, (await api(`/api/audit/blocks/${b.id}/floors`)).data)
const detail = new Map() // `${cycleId}|${roomId}` -> room detail
for (const c of cycles) for (const r of rooms) detail.set(`${c.id}|${r.id}`, (await api(`/api/audit/rooms/${r.id}?cycle=${c.id}`)).data)
const dOf = (cycle, room) => detail.get(`${cycle.id}|${room.id}`)

/** Progress for a cycle (optionally one block / floor), counted room by room from each room's own record. */
function count(cycle, filter = () => true) {
  const inScope = rooms.filter((r) => filter(r) && dOf(cycle, r).inspection.inScope)
  const n = (s) => inScope.filter((r) => dOf(cycle, r).inspection.status === s).length
  const p = { scope: inScope.length, completed: n('Completed'), inProgress: n('In progress'), unable: n('Unable to inspect'), notStarted: n('Not started') }
  return { ...p, pct: p.scope === 0 ? null : Math.round((p.completed / p.scope) * 100) }
}
const rem = (p) => [p.inProgress ? `${p.inProgress} in progress` : '', p.unable ? `${p.unable} unable to inspect` : '', p.notStarted ? `${p.notStarted} not started` : ''].filter(Boolean).join(' · ')
const sentence = (p) => `${p.completed} of ${p.scope} ${p.scope === 1 ? 'room' : 'rooms'} completed`

await assertIsolated()
const browser = await launchBrowser()
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts })
  const requests = []
  await ctx.route('**/api/**', (route) => { const r = route.request(); const u = new URL(r.url()); requests.push(`${r.method()} ${u.pathname}${u.search}`); return route.continue({ url: API + u.pathname + u.search }) })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  return { ctx, page, requests }
}
const urlNow = (page) => { const u = new URL(page.url()); return u.pathname + u.search }
const rows = (page) => page.locator('[aria-label="Rooms table"] tbody tr')
const codes = (page) => page.locator('[aria-label="Rooms table"] tbody tr th a').allInnerTexts()
const floorNav = (page) => page.getByRole('navigation', { name: 'Floors' })
const settled = (page) => page.waitForSelector('.results[aria-busy="false"], .state--error')
const act = async (page, action) => { const done = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/audit/rooms'); await action(); await done; await settled(page) }
const gotoBlock = async (page, path) => { await page.goto(BASE + path); await page.waitForSelector('nav[aria-label="Floors"]'); await settled(page) }
const gotoOverview = async (page, path = '/audit') => { await page.goto(BASE + path); await page.waitForSelector('[aria-label="Blocks table"]'); await settled(page) }
const gotoRoom = async (page, room, cycle) => { await page.goto(BASE + `/audit/rooms/${room.id}${cycle ? `?cycle=${cycle.id}` : ''}`); await page.waitForSelector('[aria-label="Equipment table"], .card__body, .state--error'); await page.waitForSelector('#equipment-heading, .state--error') }
const card = (page, label) => page.locator('.stat-card', { has: page.locator('.stat-card__label', { hasText: new RegExp(`^${label}$`) }) })
const val = async (page, label) => (await card(page, label).locator('.stat-card__value').innerText()).trim()
const hint = async (page, label) => (await card(page, label).locator('.stat-card__hint').innerText()).trim()
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const errorJson = (message) => JSON.stringify({ error: { code: 'INTERNAL_ERROR', message } })
const codeOf = (r) => r.code
const room = (code) => rooms.find((r) => r.code === code)
const itemRow = (page, text) => page.locator('[aria-label="Equipment table"] tbody tr', { hasText: text })
const allRequests = []

const bBlock = blocks.find((b) => b.name === 'B Block')
const bFloors = floorsByBlock.get(bBlock.id)
console.log(`     (independent calculation: ${blocks.length} blocks, ${rooms.length} rooms incl. ${rooms.filter((r) => !r.active).length} retired, ${cycles.length} cycles; Summer 2027 ${JSON.stringify(count(openC))})`)

console.log('\n== A. Navigation ==')
try {
  const { ctx, page, requests } = await open()
  await page.goto(BASE + '/'); await page.waitForSelector('table')
  await page.locator('.sidebar').getByRole('link', { name: 'Audit' }).click()
  await page.waitForSelector('[aria-label="Blocks table"]')
  check('A1 the Audit item opens /audit: a real overview, not "Coming soon"', urlNow(page) === '/audit' && (await page.locator('h1').innerText()) === 'Audit' && (await page.getByText('Coming soon').count()) === 0)
  check('A2 it is marked as the current page, and Tasks is not', (await page.locator('.sidebar').getByRole('link', { name: 'Audit' }).getAttribute('aria-current')) === 'page' && (await page.locator('.sidebar').getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')) === null)
  await page.getByRole('link', { name: 'B Block' }).click(); await page.waitForSelector('nav[aria-label="Floors"]')
  check('A3 Audit stays the current page on a block address', (await page.locator('.sidebar').getByRole('link', { name: 'Audit' }).getAttribute('aria-current')) === 'page')
  await page.locator('.sidebar').getByRole('link', { name: 'Locations' }).click()
  await page.getByText('Coming soon').first().waitFor()
  check('A4 Locations is still "Coming soon" (a separate, later section)', (await page.getByText('Coming soon').count()) >= 1 && urlNow(page) === '/locations')
  allRequests.push(...requests)
  await ctx.close()
  const m = await open({ viewport: { width: 375, height: 800 } })
  await m.page.goto(BASE + '/'); await m.page.waitForSelector('table')
  await m.page.getByRole('button', { name: 'Open menu' }).click()
  await m.page.locator('.sidebar').getByRole('link', { name: 'Audit' }).click()
  await m.page.waitForSelector('[aria-label="Blocks table"]')
  check('A5 phone: the menu opens the Audit overview', urlNow(m.page) === '/audit' && (await m.page.locator('h1').innerText()) === 'Audit')
  await m.ctx.close()
} catch (e) { check('SECTION A aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== B. Overview: Summer 2027 is open and untouched ==')
try {
  const { ctx, page, requests } = await open()
  await gotoOverview(page)
  const p = count(openC)
  check('B1 four progress cards, in order', same(await page.locator('.stat-card__label').allInnerTexts(), ['Rooms to inspect', 'Completed', 'Still to inspect', 'Unable to inspect']))
  check('B2 with no cycle chosen the page shows the OPEN cycle: Summer 2027, marked Open', (await page.locator('#audit-cycle').inputValue()) === openC.id && (await page.locator('.cycle-bar .badge').innerText()) === 'Open')
  check('B3 Rooms to inspect equals the independent count of active rooms in scope', (await val(page, 'Rooms to inspect')) === String(p.scope) && p.scope === rooms.filter((r) => r.active).length, `${await val(page, 'Rooms to inspect')} vs ${p.scope}`)
  check('B4 Completed is 0 (0%): no inspection activity yet', (await val(page, 'Completed')) === '0 (0%)' && p.completed === 0, await val(page, 'Completed'))
  check('B5 Still to inspect is every room: all of them are not started', (await val(page, 'Still to inspect')) === String(p.scope) && (await hint(page, 'Still to inspect')) === `${p.scope} not started · 0 in progress`)
  check('B6 Unable to inspect is 0', (await val(page, 'Unable to inspect')) === '0')
  check('B7 a note says plainly that nothing has been recorded in the cycle yet', (await page.getByText(/No inspections have been recorded in this cycle yet/).count()) === 1)
  const trs = await page.locator('[aria-label="Blocks table"] tbody tr').evaluateAll((els) => els.map((tr) => ({ name: tr.querySelector('th a').textContent.trim(), href: tr.querySelector('th a').getAttribute('href'), cells: [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim()) })))
  check('B8 one row per block, in order', same(trs.map((t) => t.name), blocks.map((b) => b.name)), trs.map((t) => t.name).join('|'))
  let ok = true, why = ''
  for (const t of trs) {
    const b = blocks.find((x) => x.name === t.name), q = count(openC, (r) => r.blockId === b.id)
    const retiredHere = rooms.filter((r) => r.blockId === b.id && !r.active).length
    const progressOk = q.scope === 0 ? t.cells[2].includes('No rooms to inspect') : t.cells[2].includes('0%') && t.cells[2].includes(`0 of ${q.scope} ${q.scope === 1 ? 'room' : 'rooms'} completed`) && t.cells[2].includes(rem(q))
    const roomsOk = t.cells[1].startsWith(String(rooms.filter((r) => r.blockId === b.id && r.active).length)) && (retiredHere === 0 ? !t.cells[1].includes('retired') : t.cells[1].includes(`+${retiredHere} retired`))
    if (!(t.cells[0] === String(floorsByBlock.get(b.id).length) && roomsOk && progressOk && t.href === `/audit/blocks/${b.id}?cycle=${openC.id}`)) { ok = false; why += ` [${t.name}: ${JSON.stringify(t.cells)}]` }
  }
  check('B9 every block row (floors, rooms, retired, progress, link to the same cycle) equals an independent calculation', ok, why.slice(0, 250))
  check('B10 no row shows NaN, undefined or null', trs.every((t) => !/NaN|undefined|null/.test(t.cells.join(' '))))
  check('B11 two requests fed the page: the blocks and the list of cycles (no per-room requests)', same(requests.filter((r) => r.startsWith('GET /api/audit')).sort(), ['GET /api/audit/blocks', 'GET /api/audit/cycles']), requests.join(' '))
  check('B12 a "Demonstration data" note is shown', (await page.getByText('Demonstration data').count()) === 1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/audit-overview.png`, fullPage: true })
  allRequests.push(...requests)
  await ctx.close()
} catch (e) { check('SECTION B aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== C. Switching to a closed cycle ==')
try {
  const { ctx, page, requests } = await open()
  await gotoOverview(page)
  const opts = await page.locator('#audit-cycle option').allInnerTexts()
  check('C1 the cycle chooser lists all three cycles, saying which is open and which closed', same(opts.sort(), ['Summer 2025 (closed)', 'Summer 2026 (closed)', 'Summer 2027 (open)']), opts.join('|'))
  const done = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/audit/blocks' && r.url().includes('cycle=' + c2026.id))
  await page.locator('#audit-cycle').selectOption(c2026.id); await done; await page.waitForSelector('.cycle-bar .badge:text("Closed")'); await settled(page)
  const p = count(c2026)
  check('C2 choosing Summer 2026 puts it in the address and marks it Closed', urlNow(page) === `/audit?cycle=${c2026.id}` && (await page.locator('.cycle-bar .badge').innerText()) === 'Closed' && (await page.getByText(/Closed: kept as a record/).count()) === 1)
  check('C3 Completed equals the independent count and percentage', (await val(page, 'Completed')) === `${p.completed} (${p.pct}%)` && p.completed > 50, `${await val(page, 'Completed')} vs ${p.completed} (${p.pct}%)`)
  check('C4 Unable to inspect and Still to inspect equal the independent counts', (await val(page, 'Unable to inspect')) === String(p.unable) && (await val(page, 'Still to inspect')) === String(p.notStarted + p.inProgress) && p.unable > 0, `${await val(page, 'Unable to inspect')} / ${await val(page, 'Still to inspect')}`)
  check('C5 Rooms to inspect includes the two rooms retired since (they were in scope then)', (await val(page, 'Rooms to inspect')) === String(p.scope) && p.scope === rooms.length)
  check('C6 the "nothing recorded" note is gone for a cycle with work done', (await page.getByText(/No inspections have been recorded/).count()) === 0)
  let ok = true, why = ''
  for (const tr of await page.locator('[aria-label="Blocks table"] tbody tr').all()) {
    const name = (await tr.locator('th a').innerText()).trim(), b = blocks.find((x) => x.name === name), q = count(c2026, (r) => r.blockId === b.id)
    const text = (await tr.locator('td').nth(2).innerText()).replace(/\s+/g, ' ')
    const good = q.scope === 0 ? text.includes('No rooms to inspect') : text.includes(`${q.pct}%`) && text.includes(sentence(q)) && (rem(q) === '' || text.includes(rem(q)))
    if (!good) { ok = false; why += ` [${name}: ${text} vs ${sentence(q)}]` }
  }
  check('C7 every block row in Summer 2026 equals an independent count', ok, why.slice(0, 250))
  await page.getByRole('link', { name: 'B Block' }).click(); await page.waitForSelector('nav[aria-label="Floors"]'); await settled(page)
  check('C8 following a block keeps the cycle in the address and in the page', urlNow(page) === `/audit/blocks/${bBlock.id}?cycle=${c2026.id}` && (await page.locator('#audit-cycle').inputValue()) === c2026.id)
  await page.goBack(); await page.waitForSelector('[aria-label="Blocks table"]'); await settled(page)
  check('C9 Back returns to the overview still on Summer 2026', urlNow(page) === `/audit?cycle=${c2026.id}` && (await page.locator('#audit-cycle').inputValue()) === c2026.id)
  await gotoOverview(page, `/audit?cycle=${c2025.id}`)
  const q25 = count(c2025)
  check('C10 opening a cycle by its address works (Summer 2025)', (await val(page, 'Completed')) === `${q25.completed} (${q25.pct}%)` && (await page.locator('#audit-cycle').inputValue()) === c2025.id)
  await gotoOverview(page, '/audit?cycle=%3Cscript%3E')
  check('C11 a malformed cycle in the address is ignored: the open cycle is shown and nothing odd is sent', (await page.locator('#audit-cycle').inputValue()) === openC.id && !requests.some((r) => r.includes('script')))
  allRequests.push(...requests)
  await ctx.close()
} catch (e) { check('SECTION C aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== D. Block, floors and the room list ==')
try {
  const { ctx, page, requests } = await open()
  await gotoBlock(page, `/audit/blocks/${bBlock.id}`)
  const bActive = rooms.filter((r) => r.blockId === bBlock.id && r.active)
  const expectedAll = bActive.map(codeOf)
  check('D1 the header counts match the independent calculation', (await page.getByText(`${bFloors.length} floors · ${bActive.length} active rooms`).count()) === 1)
  const links = (await floorNav(page).getByRole('link').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())
  check('D2 the floor navigation is All floors, then each floor, with its active room count', same(links, ['All floors ' + bActive.length, ...bFloors.map((f) => `${f.name} ${rooms.filter((r) => r.floorId === f.id && r.active).length}`)]), links.join('|'))
  const bp = count(openC, (r) => r.blockId === bBlock.id)
  check('D3 a line states the progress of the block in the open cycle', (await page.getByText(`B Block: ${sentence(bp)} · ${rem(bp)}`).count()) === 1)
  check('D4 the first page shows 10 rooms in code order', (await rows(page).count()) === 10 && same(await codes(page), expectedAll.slice(0, 10)), (await codes(page)).join(' '))
  const first = await rows(page).first().evaluate((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim()))
  const b001 = dOf(openC, room('B001'))
  check('D5 a row shows code, name, floor, equipment count, inspection state and status', first[0] === 'B001' && first[1] === b001.displayName && first[2] === b001.floorName && first[3].startsWith(`${b001.equipment.length} items`) && first[4] === 'Not started' && first[5] === 'Active', JSON.stringify(first))

  await act(page, () => floorNav(page).getByRole('link', { name: /First floor/ }).click()); await page.waitForURL(`**/floors/${bFloors[1].id}**`)
  const firstFloor = rooms.filter((r) => r.floorId === bFloors[1].id && r.active).map(codeOf)
  check('D6 choosing First floor puts it in the address and shows only that floor', urlNow(page).startsWith(`/audit/blocks/${bBlock.id}/floors/${bFloors[1].id}`) && same(await codes(page), firstFloor), (await codes(page)).join(' '))
  const fp = count(openC, (r) => r.floorId === bFloors[1].id)
  check('D7 the progress line now describes that floor', (await page.getByText(`First floor: ${sentence(fp)}`, { exact: false }).count()) === 1)
  check('D8 the floor is marked current and All floors is not; the floor filter went to the server', (await floorNav(page).getByRole('link', { name: /First floor/ }).getAttribute('aria-current')) === 'page' && (await floorNav(page).getByRole('link', { name: /All floors/ }).getAttribute('aria-current')) === null && requests.some((r) => r.includes('/api/audit/rooms?') && r.includes(`floor=${bFloors[1].id}`)))

  // Summer 2026: states, reasons and inspectors, checked against each room own record.
  await gotoBlock(page, `/audit/blocks/${bBlock.id}?cycle=${c2026.id}&status=all&inspection=unable`)
  const unable26 = rooms.filter((r) => r.blockId === bBlock.id && dOf(c2026, r).inspection.status === 'Unable to inspect')
  check('D9 the "Unable to inspect" filter lists exactly the rooms that could not be inspected in Summer 2026, each with its reason', unable26.length > 0 && same(await codes(page), unable26.map(codeOf).slice(0, 10)) && (await rows(page).allInnerTexts()).every((t, i) => t.includes(dOf(c2026, unable26[i]).inspection.unableReason)), (await codes(page)).join(' '))
  await gotoBlock(page, `/audit/blocks/${bBlock.id}?cycle=${c2026.id}&inspection=completed`)
  const done26 = bActive.filter((r) => dOf(c2026, r).inspection.status === 'Completed')
  const firstDone = await rows(page).first().evaluate((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim()))
  const fd = dOf(c2026, done26[0])
  check('D10 the "Completed" filter lists the completed rooms, each naming its inspector and date', same(await codes(page), done26.map(codeOf).slice(0, 10)) && firstDone[4].startsWith('Completed') && firstDone[4].includes(fd.inspection.inspectorName), firstDone[4])
  await gotoBlock(page, `/audit/blocks/${bBlock.id}?cycle=${c2026.id}&status=all&inspection=notStarted`)
  const ns26 = rooms.filter((r) => r.blockId === bBlock.id && dOf(c2026, r).inspection.inScope && dOf(c2026, r).inspection.status === 'Not started')
  check('D11 "Not started" in Summer 2026 lists the rooms never reached', same(await codes(page), ns26.map(codeOf)) && ns26.length > 0, (await codes(page)).join(' '))
  await gotoBlock(page, `/audit/blocks/${bBlock.id}?inspection=completed`)
  check('D12 in the open cycle the "Completed" filter is an empty state with a way to clear it', (await page.getByText('No rooms match your filters').count()) === 1 && (await page.getByRole('button', { name: 'Clear filters' }).count()) >= 1)
  await act(page, () => page.getByRole('button', { name: 'Clear filters' }).last().click()); await page.waitForURL(`**/audit/blocks/${bBlock.id}`)
  check('D13 Clear filters removes the filter and shows the rooms again', (await rows(page).count()) === 10 && urlNow(page) === `/audit/blocks/${bBlock.id}`)

  // retired room is outside the open cycle
  const retired = room('B205')
  await gotoBlock(page, `/audit/blocks/${bBlock.id}?status=retired`)
  const rr = (await rows(page).first().innerText()).replace(/\s+/g, ' ')
  check('D14 the retired room shows "Not in this cycle" and Retired in Summer 2027', same(await codes(page), [retired.code]) && rr.includes('Not in this cycle') && rr.includes('Retired'), rr)
  await gotoBlock(page, `/audit/blocks/${bBlock.id}?status=retired&cycle=${c2025.id}`)
  check('D15 the same room WAS in scope in Summer 2025 (its state there is shown instead)', !(await rows(page).first().innerText()).includes('Not in this cycle'))

  // search and paging keep the cycle
  await gotoBlock(page, `/audit/blocks/${bBlock.id}?cycle=${c2026.id}`)
  await act(page, () => page.fill('#room-search', 'b10')); await page.waitForURL('**q=b10**')
  check('D16 searching keeps the cycle and finds the independent matches', urlNow(page).includes(`cycle=${c2026.id}`) && same(await codes(page), bActive.filter((r) => r.code.toLowerCase().includes('b10')).map(codeOf).slice(0, 10)))
  await gotoBlock(page, `/audit/blocks/${bBlock.id}?cycle=${c2026.id}`)
  const pages = Math.ceil(bActive.length / 10)
  check('D17 shows Page 1 of N for the independent page count', (await page.getByText(`Page 1 of ${pages}`).count()) === 1)
  await act(page, () => page.getByRole('button', { name: 'Next' }).click()); await page.waitForURL('**page=2**')
  check('D18 Next shows page 2 and keeps the cycle in the address', same(await codes(page), expectedAll.slice(10, 20)) && urlNow(page).includes(`cycle=${c2026.id}`))
  await page.reload(); await settled(page)
  check('D19 reloading keeps the page and cycle', same(await codes(page), expectedAll.slice(10, 20)))
  await gotoBlock(page, `/audit/blocks/${bBlock.id}?inspection=bogus&status=bogus&page=-3`)
  check('D20 unknown values in the address are ignored: all rooms, active, page 1', (await page.inputValue('#room-inspection')) === 'all' && (await page.inputValue('#room-status')) === 'active' && (await rows(page).count()) === 10)
  await gotoBlock(page, `/audit/blocks/${bBlock.id}?cycle=${c2026.id}`)
  const done2 = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/audit/rooms' && r.url().includes('cycle=' + c2025.id))
  await page.locator('#audit-cycle').selectOption(c2025.id); await done2; await settled(page)
  check('D21 switching cycle on a block page stays on the block, reloads the rooms and records the cycle', urlNow(page).startsWith(`/audit/blocks/${bBlock.id}`) && urlNow(page).includes(`cycle=${c2025.id}`) && (await page.locator('.cycle-bar').innerText()).includes('Summer 2025'))
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/audit-block.png`, fullPage: true })
  allRequests.push(...requests)
  await ctx.close()
} catch (e) { check('SECTION D aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== E. A room and its equipment checklist ==')
try {
  const { ctx, page, requests } = await open()
  // Open cycle: nothing answered, last time visible.
  const b101 = room('B101'), d101 = dOf(openC, b101)
  await gotoBlock(page, `/audit/blocks/${bBlock.id}`)
  await page.getByRole('link', { name: 'B001', exact: true }).click(); await page.waitForSelector('#equipment-heading')
  const b001 = dOf(openC, room('B001'))
  check('E1 choosing a room opens its page: the heading is the room code, the address keeps the cycle', (await page.locator('h1').innerText()) === 'B001' && urlNow(page) === `/audit/rooms/${b001.id}?cycle=${openC.id}`)
  check('E2 the checklist has one row per active item, equal to the room\'s own data', (await page.locator('[aria-label="Equipment table"] tbody tr').count()) === b001.equipment.length, `${b001.equipment.length}`)
  check('E3 in the open cycle no item has an answer: each says so', (await page.getByText('This room has not been inspected yet.').count()) === 1 && (await page.locator('[aria-label="Equipment table"] tbody tr td:nth-child(2)').allInnerTexts()).every((t) => t.trim() === 'No answer yet'))
  const withPrev = b001.equipment.filter((l) => l.previous)
  check('E4 every item with an earlier answer shows it ("Last time"), with its cycle', withPrev.length > 0 && (await page.locator('[aria-label="Equipment table"] tbody tr td:nth-child(3)').allInnerTexts()).every((t, i) => b001.equipment[i].previous ? t.includes(b001.equipment[i].previous.condition) && t.includes(b001.equipment[i].previous.cycleName) : t.includes('No earlier inspection')))
  check('E5 the page has no buttons to edit, inspect or delete (this stage is read-only)', (await page.locator('main button').count()) === 0)
  check('E6 the back link returns to that room floor in its block, keeping the cycle', (await page.getByRole('link', { name: /Back to B Block, / }).getAttribute('href')) === `/audit/blocks/${bBlock.id}/floors/${b001.floorId}?cycle=${openC.id}`)

  // Summer 2026: answers and corrections.
  const done = rooms.find((r) => dOf(c2026, r).inspection.status === 'Completed' && dOf(c2026, r).equipment.length >= 3)
  const dd = dOf(c2026, done)
  await gotoRoom(page, done, c2026)
  const trs = await page.locator('[aria-label="Equipment table"] tbody tr').evaluateAll((els) => els.map((tr) => tr.children[1].innerText.replace(/\s+/g, ' ').trim()))
  check('E7 in Summer 2026 each item shows its recorded condition, equal to the room\'s own data', dd.equipment.length === trs.length && dd.equipment.every((l, i) => trs[i].includes(l.current.condition)), JSON.stringify(trs).slice(0, 200))
  check('E8 the inspector and completion date are shown', (await page.getByText(dd.inspection.inspectorName).count()) >= 1 && (await page.getByText('Completed', { exact: true }).count()) >= 1)
  const corrected = rooms.find((r) => dOf(c2026, r).equipment.some((l) => l.current?.corrected))
  await gotoRoom(page, corrected, c2026)
  check('E9 the one answer corrected after completion is marked "Corrected"', (await page.locator('.answer .badge', { hasText: 'Corrected' }).count()) === 1)
  check('E10 no other room in Summer 2026 is marked corrected', rooms.filter((r) => dOf(c2026, r).equipment.some((l) => l.current?.corrected)).length === 1)

  // Firmware wording
  const panel = rooms.find((r) => dOf(c2026, r).equipment.some((l) => l.equipmentTypeId === 'clevertouch-panel' && l.current && l.current.checks.length))
  await gotoRoom(page, panel, c2026)
  const panelText = await itemRow(page, 'Clevertouch panel').first().innerText()
  check('E11 a Clevertouch panel shows its firmware check as "Up to date" or "Needs update", never as Working / Not working', /Firmware: (Up to date|Needs update)/.test(panelText) && !/Firmware: (Working|Not working)/.test(panelText), panelText.replace(/\s+/g, ' '))

  // Found equipment needing review
  const withReview = rooms.find((r) => dOf(openC, r).equipment.some((l) => l.reviewStatus === 'Needs review'))
  await gotoRoom(page, withReview, openC)
  const found = itemRow(page, 'Document camera')
  check('E12 equipment found during an inspection is flagged "Needs review" and says where it came from', (await found.locator('.badge', { hasText: 'Needs review' }).count()) === 1 && (await found.getByText('Found during an inspection').count()) === 1)
  const foundCells = [await found.locator('td').nth(0).innerText(), await found.locator('td').nth(1).innerText()]
  check('E13 ... and shows its answer from the inspection in which it was found (Summer 2026), as last time', foundCells[0].includes('No answer yet') && foundCells[1].includes('Summer 2026'), JSON.stringify(foundCells))

  // Rooms with no equipment
  const empty = rooms.find((r) => r.code === 'B005')
  await gotoRoom(page, empty, c2026)
  const confirmed = dOf(c2026, empty).noEquipmentConfirmed === true
  check('E14 a room with no equipment says so, and shows the inspector confirmation when one was given', (await page.getByText('No equipment is recorded for this room.').count()) === 1 && (await page.getByText(/confirmed in this cycle that the room has no equipment/).count()) === (confirmed ? 1 : 0) && confirmed, `confirmed=${confirmed}`)

  // Unable to inspect
  const unable = rooms.find((r) => dOf(c2026, r).inspection.status === 'Unable to inspect')
  await gotoRoom(page, unable, c2026)
  check('E15 a room that could not be inspected shows the reason and no recorded answers', (await page.getByText(dOf(c2026, unable).inspection.unableReason).count()) >= 1 && (await page.locator('[aria-label="Equipment table"] tbody tr td:nth-child(2)').allInnerTexts()).every((t) => t.trim() === 'No answer yet'))

  // Retired room
  await gotoRoom(page, room('B205'), openC)
  check('E16 a retired room says it was not part of the cycle, not that it was never inspected', (await page.getByText('This room was not part of this cycle.').count()) === 1 && (await page.getByText('This room has not been inspected yet.').count()) === 0)

  // Switching cycle on the room page
  await gotoRoom(page, done, openC)
  const rl = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/audit/rooms/${done.id}` && r.url().includes('cycle=' + c2026.id))
  await page.locator('#audit-cycle').selectOption(c2026.id); await rl; await page.waitForSelector('.cycle-bar .badge:text("Closed")')
  check('E17 switching cycle on a room reloads that room for the chosen cycle', urlNow(page) === `/audit/rooms/${done.id}?cycle=${c2026.id}` && (await page.getByText(dd.inspection.inspectorName).count()) >= 1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/audit-room.png`, fullPage: true })
  allRequests.push(...requests)
  await ctx.close()
} catch (e) { check('SECTION E aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== F. Failures and unknown addresses ==')
try {
  let failures = 1
  const f = await open()
  await f.page.route((url) => url.pathname === '/api/audit/rooms', (route) => (failures-- > 0 ? route.fulfill({ status: 500, contentType: 'application/json', body: errorJson('Something went wrong on the server.') }) : route.fallback()))
  await f.page.goto(BASE + `/audit/blocks/${bBlock.id}`); await f.page.waitForSelector('[role=alert]')
  const alertText = await f.page.locator('[role=alert]').innerText()
  check('F1 a failed room list: "Rooms could not be loaded", the reason and Try again; the floors still work', alertText.includes('Rooms could not be loaded') && alertText.includes('Something went wrong on the server.') && (await floorNav(f.page).getByRole('link').count()) === bFloors.length + 1)
  check('F2 no table or stale figures beside the error', (await f.page.locator('table').count()) === 0)
  await act(f.page, () => f.page.getByRole('button', { name: 'Try again' }).click())
  check('F3 Try again reloads the rooms and removes the error', (await rows(f.page).count()) === 10 && (await f.page.locator('[role=alert]').count()) === 0)
  await f.ctx.close()

  let blockFailures = 1
  const o = await open()
  await o.page.route((url) => url.pathname === '/api/audit/blocks', (route) => (blockFailures-- > 0 ? route.abort() : route.fallback()))
  await o.page.goto(BASE + '/audit'); await o.page.waitForSelector('[role=alert]')
  check('F4 overview, server unreachable: ONE alert with Try again, and no figures at all', (await o.page.locator('[role=alert]').count()) === 1 && (await o.page.locator('.stat-card').count()) === 0 && (await o.page.getByRole('button', { name: 'Try again' }).count()) === 1)
  await o.page.getByRole('button', { name: 'Try again' }).click(); await o.page.waitForSelector('[aria-label="Blocks table"]')
  check('F5 and recovers with the real figures once it is back', (await o.page.locator('[role=alert]').count()) === 0 && (await o.page.locator('.stat-card').count()) === 4)
  await o.ctx.close()

  let roomFailures = 1
  const r = await open()
  await r.page.route((url) => url.pathname.startsWith('/api/audit/rooms/'), (route) => (roomFailures-- > 0 ? route.fulfill({ status: 500, contentType: 'application/json', body: errorJson('Something went wrong on the server.') }) : route.fallback()))
  await r.page.goto(BASE + `/audit/rooms/${room('B001').id}`); await r.page.waitForSelector('[role=alert]')
  check('F6 a failed room page: "The room could not be loaded" with Try again, and recovers', (await r.page.getByText('The room could not be loaded').count()) === 1)
  await r.page.getByRole('button', { name: 'Try again' }).click(); await r.page.waitForSelector('#equipment-heading')
  check('F7 ... showing the room once it is back', (await r.page.locator('h1').innerText()) === 'B001')
  await r.ctx.close()

  const u = await open()
  await u.page.goto(BASE + '/audit?cycle=CYC-999'); await u.page.waitForSelector('[role=alert]')
  check('F8 an unknown cycle: "Inspection cycle not found" with a link to the current cycle and no pointless retry', (await u.page.getByText('Inspection cycle not found').count()) === 1 && (await u.page.getByRole('link', { name: 'Show the current cycle' }).count()) === 1 && (await u.page.getByRole('button', { name: 'Try again' }).count()) === 0)
  await u.page.goto(BASE + '/audit/blocks/BLK-999'); await u.page.waitForSelector('[role=alert]')
  check('F9 an unknown block: "Block or cycle not found" with a way back and no retry', (await u.page.getByText('Block or cycle not found').count()) === 1 && (await u.page.getByRole('link', { name: /Back to audit overview/ }).count()) === 1 && (await u.page.getByRole('button', { name: 'Try again' }).count()) === 0)
  await u.page.goto(BASE + '/audit/rooms/ROOM-999'); await u.page.waitForSelector('[role=alert]')
  check('F10 an unknown room: "Room or cycle not found" with a way back', (await u.page.getByText('Room or cycle not found').count()) === 1 && (await u.page.getByRole('link', { name: /Back to audit overview/ }).count()) === 1)
  await u.page.goto(BASE + `/audit/rooms/${room('B001').id}?cycle=CYC-999`); await u.page.waitForSelector('[role=alert]')
  check('F11 a real room in an unknown cycle is also reported, not shown as empty', (await u.page.getByText('Room or cycle not found').count()) === 1)
  await u.ctx.close()
} catch (e) { check('SECTION F aborted', false, String(e.message).slice(0, 300)) }

console.log('\n== G. Read-only, look and small screens ==')
try {
  check('G1 across the whole journey the pages only ever read: every audit request was a GET', allRequests.length > 20 && allRequests.every((r) => r.startsWith('GET ')), `${allRequests.length} requests`)
  const pages = [['overview', '/audit', '[aria-label="Blocks table"]'], ['block', `/audit/blocks/${bBlock.id}?cycle=${c2026.id}`, '[aria-label="Rooms table"]'], ['room', `/audit/rooms/${room('B101').id}?cycle=${c2026.id}`, '[aria-label="Equipment table"]']]
  for (const [name, path, ready] of pages) {
    for (const [device, width] of [['phone', 375], ['tablet', 768], ['desktop', 1280]]) {
      const c = await open({ viewport: { width, height: 800 } })
      await c.page.goto(BASE + path); await c.page.waitForSelector(ready)
      check(`G2 [${name} ${device}] no horizontal page overflow`, await noOverflow(c.page))
      if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/audit-${name}-${device}.png`, fullPage: true })
      await c.ctx.close()
    }
  }
  const k = await open({ colorScheme: 'dark' })
  await gotoBlock(k.page, `/audit/blocks/${bBlock.id}?cycle=${c2026.id}`)
  check('G3 still a single light theme with a dark system setting, and no theme switch', (await k.page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(250, 248, 247)' && (await k.page.getByRole('radio').count()) === 0)
  check('G4 one level-one heading, and the room table has column and row headers', (await k.page.locator('h1').count()) === 1 && (await k.page.locator('[aria-label="Rooms table"] thead th[scope="col"]').count()) === 6 && (await k.page.locator('[aria-label="Rooms table"] tbody th[scope="row"]').count()) === 10)
  check('G5 filters are a labelled search landmark, floors a labelled navigation, tables labelled regions', (await k.page.getByRole('search', { name: 'Find rooms' }).count()) === 1 && (await floorNav(k.page).count()) === 1 && (await k.page.getByRole('region', { name: 'Rooms table' }).count()) === 1)
  const unnamed = await k.page.evaluate(() => [...document.querySelectorAll('main a, main button, main input, main select')].filter((el) => { const label = el.getAttribute('aria-label') || el.textContent.trim() || (el.labels && el.labels.length ? el.labels[0].textContent.trim() : ''); return !label }).length)
  check('G6 every link, button and field has an accessible name', unnamed === 0, `${unnamed} unnamed`)
  check('G7 inspection state is text in a badge, so it is never shown by colour alone', await k.page.locator('[aria-label="Rooms table"] .badge').evaluateAll((els) => els.length > 0 && els.every((e) => e.textContent.trim().length > 0)))
  await k.page.focus('#room-search'); await k.page.keyboard.press('Tab')
  check('G8 the filters are reached in order by keyboard (search, then inspection)', (await k.page.evaluate(() => document.activeElement.id)) === 'room-inspection')
  const f = k.page.locator('nav[aria-label="Floors"] a').nth(1)
  await f.focus()
  check('G9 a floor link shows a clear keyboard focus ring', await f.evaluate((el) => { const cs = getComputedStyle(el); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }))
  await k.ctx.close()
  const ph = await open({ viewport: { width: 375, height: 800 } })
  await gotoBlock(ph.page, `/audit/blocks/${bBlock.id}`)
  const scroller = await ph.page.locator('[aria-label="Rooms table"]').evaluate((el) => ({ tab: el.getAttribute('tabindex'), sw: el.scrollWidth, cw: el.clientWidth }))
  check('G10 phone: the room table scrolls inside its own region, reachable by keyboard', scroller.tab === '0' && scroller.sw >= scroller.cw, JSON.stringify(scroller))
  await ph.ctx.close()
} catch (e) { check('SECTION G aborted', false, String(e.message).slice(0, 300)) }

await browser.close()
console.log(`\n${pass}/${pass + fail} checks passed`)
