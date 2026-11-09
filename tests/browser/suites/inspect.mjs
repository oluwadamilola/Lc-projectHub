import { launchBrowser } from '../lib/browser.mjs'

import { WEB as BASE, API, assertIsolated } from '../lib/guard.mjs'
// Stage 2b: the technician's room inspection screens, driven in a real browser against the built stack. Every action
// goes through the real write API; each result is then checked by reading it back from the server, not from the screen.
const SHOTS = process.env.SHOTS
let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) }
const api = async (path, init) => { const r = await fetch(API + path, init); return { status: r.status, body: await r.json().catch(() => null) } }
const get = (path) => api(path)
const send = (method, path, body) => api(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

await assertIsolated()

// ---- What the seed holds (read once, through the API) ----
const cycles = (await get('/api/audit/cycles')).body.data
const openC = cycles.find((c) => c.status === 'Open')
const closedC = cycles.find((c) => c.status === 'Closed')
const technicians = (await get('/api/technicians')).body.data
const TECH = technicians[0], TECH2 = technicians[1]
const allRooms = []
for (let page = 1; ; page += 1) {
  const body = (await get(`/api/audit/rooms?status=all&pageSize=100&page=${page}`)).body
  allRooms.push(...body.data)
  if (page >= body.meta.totalPages) break
}
const detailOf = async (room) => (await get(`/api/audit/rooms/${room.id}?cycle=${openC.id}`)).body.data
const details = []
for (const r of allRooms.filter((x) => x.active)) details.push(await detailOf(r))
const used = new Set()
const pick = (predicate, why) => {
  const found = details.find((d) => !used.has(d.id) && d.inspection.inScope && d.inspection.status === 'Not started' && predicate(d))
  if (!found) throw new Error(`no seeded room for: ${why}`)
  used.add(found.id)
  return found
}
const hasChecks = (d) => d.equipment.some((l) => l.checks.length > 0)
const hasPrevious = (d) => d.equipment.some((l) => l.previous)
const R_MAIN = pick((d) => d.equipment.length >= 4 && d.equipment.length <= 9 && hasChecks(d) && hasPrevious(d), 'main walk-round: 4 to 9 items, a firmware check, earlier answers')
const R_UNABLE = pick((d) => d.equipment.length >= 2 && d.equipment.length <= 6, 'unable to inspect, then resume')
const R_EMPTY = pick((d) => d.equipment.length === 0, 'a room with no equipment')
const R_FOUND = pick((d) => d.equipment.length >= 1 && d.equipment.length <= 4, 'equipment found, validation')
const R_NET = pick((d) => d.equipment.length >= 1 && d.equipment.length <= 3, 'network failures')
const R_DUP = pick((d) => d.equipment.length >= 1 && d.equipment.length <= 3, 'duplicate submissions')
const R_TWO = pick((d) => d.equipment.length >= 1 && d.equipment.length <= 3, 'two screens on one inspection')
const R_TABLET = pick((d) => d.equipment.length >= 2, 'tablet and phone layout')
const R_RETIRED = allRooms.find((r) => !r.active)
console.log(`     (rooms: main ${R_MAIN.code} [${R_MAIN.equipment.length} items], unable ${R_UNABLE.code}, empty ${R_EMPTY.code}, found ${R_FOUND.code}, network ${R_NET.code}, duplicates ${R_DUP.code})`)

const browser = await launchBrowser()
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, ...opts })
  const requests = []
  await ctx.route('**/api/**', (route) => { const r = route.request(); const u = new URL(r.url()); requests.push(`${r.method()} ${u.pathname}${u.search}`); return route.continue({ url: API + u.pathname + u.search }) })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  return { ctx, page, requests }
}
const count = (requests, re) => requests.filter((r) => re.test(r)).length
const START = /^POST \/api\/audit\/rooms\/ROOM-\d+\/inspection$/
const SAVE = /^PUT \/api\/audit\/inspections\/INS-\d+\/results\/EQP-\d+$/
const COMPLETE = /^POST \/api\/audit\/inspections\/INS-\d+\/complete$/
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim()

const gotoRoom = async (page, room, cycleId = openC.id) => { await page.goto(BASE + `/audit/rooms/${room.id}?cycle=${cycleId}`); await page.waitForSelector('h1') }
const gotoInspect = async (page, room, cycleId = openC.id) => { await page.goto(BASE + `/audit/rooms/${room.id}/inspect?cycle=${cycleId}`); await page.waitForSelector('h1, .state--error') }
const items = (page) => page.locator('li.check-item')
const progressText = (page) => text(page.locator('.inspection-bar__progress strong'))
const saveText = (page) => text(page.locator('.inspection-bar__status'))
const settled = (page) => page.getByText('All changes saved').waitFor()
const startAs = async (page, technician) => {
  await page.selectOption('#field-inspector', { label: technician.name })
  await page.getByRole('button', { name: 'Start inspection' }).click()
  await page.waitForSelector('li.check-item, #no-equipment')
}
const pickCondition = (card, condition) => card.getByRole('radio', { name: condition, exact: true }).first().check()
/** Answers one card: its condition, any firmware-style checks, and a note when the condition needs one. */
async function answer(card, condition = 'Working', note = 'Needs attention') {
  await pickCondition(card, condition)
  if (['Not working', 'Needs replacement', 'Missing'].includes(condition)) await card.locator('textarea').first().fill(note)
  if (['Working', 'Not working', 'Needs replacement'].includes(condition)) {
    const checks = card.locator('.check-item__check')
    for (let i = 0; i < await checks.count(); i += 1) await checks.nth(i).getByRole('radio').first().check()
  }
}
const inspectionOf = async (room) => { const d = await detailOf(room); return d.inspection.inspectionId ? (await get(`/api/audit/inspections/${d.inspection.inspectionId}`)).body.data : null }

try {
  console.log('\n== A. Getting to an inspection ==')
  {
    const k = await open()
    await gotoRoom(k.page, R_MAIN)
    const link = k.page.getByRole('link', { name: 'Start inspection' })
    check('A1 the room page of a not-started room in the open cycle has a prominent "Start inspection" link', (await link.count()) === 1 && /\/inspect\?cycle=/.test(await link.getAttribute('href')))
    check('A2 the room inventory and its history are still on that page (read-only reference)', (await k.page.locator('[aria-label="Equipment table"] tbody tr').count()) === R_MAIN.equipment.length && (await k.page.getByText('Last time').count()) >= 1)
    await gotoRoom(k.page, R_MAIN, closedC.id)
    check('A3 a closed cycle offers no way to start an inspection', (await k.page.locator('main').getByRole('link', { name: /inspection|Inspect/ }).count()) === 0)
    await gotoInspect(k.page, R_MAIN, closedC.id)
    check('A4 asking for the inspection screen of a closed cycle is refused in words', /is closed/.test(await text(k.page.locator('main'))) && (await k.page.locator('li.check-item').count()) === 0)
    await gotoRoom(k.page, R_RETIRED)
    check('A5 a retired room has no start link', (await k.page.locator('main').getByRole('link', { name: /Start inspection/ }).count()) === 0)
    await gotoInspect(k.page, R_RETIRED)
    check('A6 the inspection screen of a retired room refuses', /not being inspected|not part of/.test(await text(k.page.locator('main'))))
    await k.page.goto(BASE + '/audit/rooms/ROOM-999/inspect')
    await k.page.waitForSelector('[role="alert"]')
    check('A7 an unknown room says so', /not found/i.test(await text(k.page.locator('[role="alert"]'))))
    await k.ctx.close()
  }

  console.log('\n== B. Starting, recording, reloading, resuming and completing ==')
  const main = await open()
  const mp = main.page
  let inspectionId
  try {
    await gotoRoom(mp, R_MAIN)
    await mp.getByRole('link', { name: 'Start inspection' }).click()
    await mp.waitForSelector('#field-inspector')
    check('B1 the start screen asks who is inspecting, from the existing technicians', (await mp.locator('#field-inspector option').allInnerTexts()).slice(1).join('|') === technicians.map((t) => t.name).join('|'))
    await mp.getByRole('button', { name: 'Start inspection' }).click()
    check('B2 starting without choosing a technician is refused with a message and sends nothing', /Choose who is inspecting/.test(await text(mp.locator('main'))) && count(main.requests, START) === 0)
    check('B3 nothing exists on the server until the technician starts', (await inspectionOf(R_MAIN)) === null)
    await startAs(mp, TECH)
    check('B4 starting sends exactly one request and opens the checklist', count(main.requests, START) === 1 && (await items(mp).count()) === R_MAIN.equipment.length)
    inspectionId = (await detailOf(R_MAIN)).inspection.inspectionId
    check('B5 the server now holds an in-progress inspection by that technician', (await inspectionOf(R_MAIN))?.status === 'In progress' && (await inspectionOf(R_MAIN))?.inspectorName === TECH.name)
    check('B6 the heading names the room and the progress starts at zero', /Inspect room/.test(await text(mp.locator('h1'))) && (await progressText(mp)) === `0 of ${R_MAIN.equipment.length} items checked`)
    const first = items(mp).first()
    const firstEq = R_MAIN.equipment[0]
    check('B7 each item shows its own identity (type, asset tag and serial when it has them)', (await text(first)).includes(firstEq.typeLabel) && (!firstEq.assetTag || (await text(first)).includes(firstEq.assetTag)) && (!firstEq.serialNumber || (await text(first)).includes(firstEq.serialNumber)))
    check('B8 every item offers the five conditions as radio buttons', (await items(mp).evaluateAll((els) => els.every((el) => el.querySelectorAll('.check-item__condition input[type=radio]').length === 5))))
    const previousIndex = R_MAIN.equipment.findIndex((l) => l.previous)
    const prevCard = items(mp).nth(previousIndex)
    check('B9 the answer from last time is shown beside the item', (await text(prevCard)).toLowerCase().includes('last time') && (await text(prevCard)).includes(R_MAIN.equipment[previousIndex].previous.condition))
    check('B10 the Complete button is disabled and the screen says what is still needed', (await mp.getByRole('button', { name: 'Complete inspection' }).isDisabled()) && /Still needed before you can complete \(\d+\)/.test(await text(mp.locator('.complete-help'))))
    check('B11 the controls are large enough for a finger: every condition choice is at least 44px high', await mp.locator('.choice span').first().evaluate((el) => el.getBoundingClientRect().height >= 44))
    if (SHOTS) await mp.screenshot({ path: `${SHOTS}/inspect-start.png`, fullPage: true })

    // Record several results.
    // The item with the firmware check is always the "Working" one, so its extra question appears.
    const conds = ['Working', 'Not working', 'Missing', 'Not applicable']
    const fwIdx = R_MAIN.equipment.findIndex((l) => l.checks.length > 0)
    if (fwIdx > 0 && fwIdx < conds.length) [conds[0], conds[fwIdx]] = [conds[fwIdx], conds[0]]
    const at = (c) => conds.indexOf(c)
    const saves0 = count(main.requests, SAVE)
    await answer(items(mp).nth(at('Working')), 'Working')
    await settled(mp)
    check('B12 choosing a condition saves it at once and says so', count(main.requests, SAVE) > saves0 && (await saveText(mp)).includes('All changes saved'))
    check('B13 the progress moves to "1 of N items checked"', (await progressText(mp)) === `1 of ${R_MAIN.equipment.length} items checked`)
    const second = items(mp).nth(at('Not working'))
    await pickCondition(second, 'Not working')
    check('B14 a condition that needs a note shows the note box straight away, marked required', await second.locator('textarea').first().isVisible() && /required/i.test(await text(second.locator('label[for^="note-"]'))))
    await settled(mp)
    check('B15 the problem list names the missing note and the Complete button stays disabled', (await mp.locator('.problem-list').innerText()).includes('add a note') && (await mp.getByRole('button', { name: 'Complete inspection' }).isDisabled()))
    const noteSaves = count(main.requests, SAVE)
    await second.locator('textarea').first().fill('Lamp will not light')
    check('B16 typing a note shows "Saving…" while it waits for a pause', /Saving/.test(await saveText(mp)))
    await settled(mp)
    check('B17 the note is sent once after the pause, not on every key', count(main.requests, SAVE) === noteSaves + 1)
    await answer(items(mp).nth(at('Missing')), 'Missing', 'Cannot find it in the room')
    await answer(items(mp).nth(at('Not applicable')), 'Not applicable')
    await settled(mp)
    const saved = await inspectionOf(R_MAIN)
    const byId = (id) => saved.lines.find((l) => l.id === id).current
    const ids = R_MAIN.equipment.map((l) => l.id)
    check('B18 the server holds exactly what was entered (read back through the API)', byId(ids[at('Working')]).condition === 'Working' && byId(ids[at('Not working')]).condition === 'Not working' && byId(ids[at('Not working')]).note === 'Lamp will not light' && byId(ids[at('Missing')]).condition === 'Missing' && byId(ids[at('Not applicable')]).condition === 'Not applicable', JSON.stringify(saved.lines.slice(0, 4).map((l) => [l.current.condition, l.current.note])))
    check('B19 the progress is "4 of N items checked"', (await progressText(mp)) === `4 of ${R_MAIN.equipment.length} items checked`)
    if (SHOTS) await mp.screenshot({ path: `${SHOTS}/inspect-midway.png`, fullPage: true })

    // Reload: resume where it stopped.
    const startsBefore = count(main.requests, START)
    await mp.reload()
    await mp.waitForSelector('li.check-item')
    check('B20 after a reload the same inspection opens again, without starting a new one', count(main.requests, START) === startsBefore && (await detailOf(R_MAIN)).inspection.inspectionId === inspectionId)
    check('B21 the progress and every earlier choice are still there', (await progressText(mp)) === `4 of ${R_MAIN.equipment.length} items checked` && (await items(mp).nth(at('Working')).getByRole('radio', { name: 'Working', exact: true }).first().isChecked()) && (await items(mp).nth(at('Not working')).getByRole('radio', { name: 'Not working', exact: true }).first().isChecked()) && (await items(mp).nth(at('Not working')).locator('textarea').first().inputValue()) === 'Lamp will not light')
    check('B22 the room page also offers "Continue inspection" and shows the progress', await (async () => { await gotoRoom(mp, R_MAIN); const ok = (await mp.getByRole('link', { name: 'Continue inspection' }).count()) === 1 && /In progress/.test(await text(mp.locator('main'))) && (await mp.getByText(`4 answered in`, { exact: false }).count()) === 1; await mp.getByRole('link', { name: 'Continue inspection' }).click(); await mp.waitForSelector('li.check-item'); return ok })())

    // Finish the rest and complete.
    for (let i = 4; i < R_MAIN.equipment.length; i += 1) await answer(items(mp).nth(i), 'Working')
    await mp.locator('.save-state--saving').waitFor({ state: 'detached' })
    const firmware = items(mp).filter({ has: mp.locator('.check-item__check') })
    check('B23 an item with a firmware check asks for it, in its own words (not "Working")', (await firmware.count()) >= 1 && /Up to date|Needs update/.test(await text(firmware.first())))
    check('B24 once everything is valid the Complete button is enabled', await mp.getByRole('button', { name: 'Complete inspection' }).isEnabled())
    const completeBefore = count(main.requests, COMPLETE)
    await mp.getByRole('button', { name: 'Complete inspection' }).click()
    await mp.getByText('Inspection completed for room').waitFor()
    check('B25 completing sends one request and shows a completion summary', count(main.requests, COMPLETE) === completeBefore + 1 && /Summary/.test(await text(mp.locator('main'))))
    const done = await inspectionOf(R_MAIN)
    check('B26 the server says Completed, with the same answers that were entered', done.status === 'Completed' && done.lines[at('Not working')].current.note === 'Lamp will not light' && done.lines[at('Working')].current.condition === 'Working' && done.lines[at('Missing')].current.condition === 'Missing')
    check('B27 the summary lists the issues reported (the fault and the missing item), with their notes', (await text(mp.locator('main'))).includes('Issues reported') && (await text(mp.locator('.issue-list'))).includes('Lamp will not light') && (await text(mp.locator('.issue-list'))).includes('Cannot find it in the room'))
    check('B28 the counts agree with the server summary', await (async () => { const body = await text(mp.locator('.summary-counts')); return Object.entries(done.summary.counts).every(([c, n]) => body.includes(`${c} ${n}`)) })())
    if (SHOTS) await mp.screenshot({ path: `${SHOTS}/inspect-complete.png`, fullPage: true })
    await mp.reload()
    await mp.getByText('Inspection completed for room').waitFor()
    check('B29 reloading a completed inspection shows its summary, with nothing left to edit', (await mp.locator('input[type=radio]').count()) === 0 && (await mp.getByRole('button', { name: 'Complete inspection' }).count()) === 0)
    await gotoRoom(mp, R_MAIN)
    check('B30 the room page now shows Completed, this cycle answers beside last time, and no start link', /Completed/.test(await text(mp.locator('main'))) && (await mp.locator('main').getByRole('link', { name: /inspection/i }).count()) === 0 && (await text(mp.locator('[aria-label="Equipment table"]'))).includes('Lamp will not light'))
    const late = await send('PUT', `/api/audit/inspections/${inspectionId}/results/${ids[0]}`, { condition: 'Missing', note: 'x' })
    check('B31 a completed inspection cannot be changed afterwards (409)', late.status === 409)
  } catch (e) { check('SECTION B aborted', false, String(e.message).slice(0, 300)) }
  await main.ctx.close()

  const types = (await get('/api/audit/equipment-types')).body.data
  const plainType = types.find((t) => !t.requiresName && t.checks.length === 0)
  const namedType = types.find((t) => t.requiresName)
  const answerAll = async (page, condition = 'Working') => {
    const n = await items(page).count()
    for (let i = 0; i < n; i += 1) await answer(items(page).nth(i), condition)
    await page.locator('.save-state--saving').waitFor({ state: 'detached' })
  }
  const completeBtn = (page) => page.getByRole('button', { name: 'Complete inspection' })

  console.log('\n== C. Validation: notes, found equipment, duplicate asset tags ==')
  {
    const k = await open()
    const p = k.page
    await gotoRoom(p, R_FOUND)
    await p.getByRole('link', { name: 'Start inspection' }).click()
    await startAs(p, TECH)
    const first = items(p).first()
    await pickCondition(first, 'Not working')
    await settled(p)
    const savesBefore = count(k.requests, SAVE)
    await first.locator('textarea').first().fill('x'.repeat(520))
    await p.locator('.check-item__save--error').waitFor()
    check('C1 a note over the 500 character limit is refused on screen with the reason, and is never sent', /500/.test(await text(p.locator('.check-item__save--error'))) && count(k.requests, SAVE) === savesBefore)
    check('C2 the status bar says some answers are not saved, and Complete stays disabled', /not saved/i.test(await saveText(p)) && (await completeBtn(p).isDisabled()))
    await first.locator('textarea').first().fill('Hinge is broken')
    await settled(p)
    check('C3 correcting the note saves it and clears the error', (await p.locator('.check-item__save--error').count()) === 0 && (await inspectionOf(R_FOUND)).lines[0].current.note === 'Hinge is broken')

    await p.getByRole('button', { name: 'Add equipment found' }).click()
    await p.getByRole('button', { name: 'Add to this room' }).click()
    check('C4 adding equipment with no type is refused with a message, and sends nothing', /Choose the type of equipment/.test(await text(p.locator('.error-summary'))) && count(k.requests, /\/equipment$/) === 0)
    await p.selectOption('#field-equipmentTypeId', { label: namedType.label })
    await p.getByRole('button', { name: 'Add to this room' }).click()
    check('C5 a type that needs a name is refused without one', /name/i.test(await text(p.locator('.error-summary'))) && (await p.locator('#field-name').getAttribute('aria-invalid')) === 'true')
    await p.selectOption('#field-equipmentTypeId', { label: plainType.label })
    await p.fill('#field-assetTag', 'not valid!')
    await p.getByRole('button', { name: 'Add to this room' }).click()
    check('C6 an asset tag with spaces or symbols is refused', /asset tag/i.test(await text(p.locator('#field-assetTag-error'))) && count(k.requests, /\/equipment$/) === 0)
    const taken = R_MAIN.equipment.find((l) => l.assetTag).assetTag
    await p.fill('#field-assetTag', taken)
    await p.getByRole('button', { name: 'Add to this room' }).click()
    await p.locator('#field-assetTag-error').waitFor()
    check('C7 an asset tag already used by other equipment is refused by the server, shown on the field, and nothing is added', /already used/.test(await text(p.locator('#field-assetTag-error'))) && (await detailOf(R_FOUND)).equipment.length === R_FOUND.equipment.length)
    await p.fill('#field-assetTag', 'FND-0001')
    await p.fill('#field-serialNumber', 'SN-FOUND-1')
    await p.getByRole('button', { name: 'Add to this room' }).dblclick()
    await p.locator('#field-assetTag').waitFor({ state: 'detached' })
    check('C8 submitting twice quickly adds the equipment once', count(k.requests, /^POST \/api\/audit\/inspections\/INS-\d+\/equipment$/) === 2 && (await detailOf(R_FOUND)).equipment.filter((l) => l.assetTag === 'FND-0001').length === 1)
    const found = p.locator('li.check-item', { hasText: 'FND-0001' })
    check('C9 the new item is on the checklist, flagged Needs review and "found during an inspection"', (await found.count()) === 1 && /Needs review/.test(await text(found)) && /Found during an inspection/.test(await text(found)))
    check('C10 the total rises by one and the item is not yet checked', (await progressText(p)) === `1 of ${R_FOUND.equipment.length + 1} items checked`)
    const inv = (await detailOf(R_FOUND)).equipment.find((l) => l.assetTag === 'FND-0001')
    check('C11 the equipment is now in the room inventory itself, flagged Needs review, with the serial number', inv && inv.reviewStatus === 'Needs review' && inv.source === 'Found during inspection' && inv.serialNumber === 'SN-FOUND-1')
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/inspect-found.png`, fullPage: true })
    await answerAll(p)
    check('C12 once every item including the new one is answered, Complete is enabled', await completeBtn(p).isEnabled())
    await completeBtn(p).click()
    await p.getByText('Inspection completed for room').waitFor()
    check('C13 the summary lists the equipment found, needing review', /Equipment found, needing review/.test(await text(p.locator('main'))) && /FND-0001/.test(await text(p.locator('main'))))
    await k.ctx.close()
  }

  console.log('\n== D. Network and server failures ==')
  {
    const k = await open()
    const p = k.page
    await gotoInspect(p, R_NET)
    await p.selectOption('#field-inspector', { label: TECH.name })
    await p.route('**/api/audit/rooms/*/inspection', (route) => route.abort())
    await p.getByRole('button', { name: 'Start inspection' }).click()
    await p.locator('.error-summary').waitFor()
    check('D1 if the server cannot be reached when starting, the technician is told and nothing is created', /could not be reached/.test(await text(p.locator('.error-summary'))) && (await inspectionOf(R_NET)) === null)
    check('D2 the Start button is usable again straight away', await p.getByRole('button', { name: 'Start inspection' }).isEnabled())
    await p.unroute('**/api/audit/rooms/*/inspection')
    await p.getByRole('button', { name: 'Start inspection' }).click()
    await p.waitForSelector('li.check-item')
    check('D3 trying again starts it', (await inspectionOf(R_NET))?.status === 'In progress')

    const first = items(p).first()
    await p.route('**/api/audit/inspections/*/results/*', (route) => route.abort())
    await pickCondition(first, 'Working')
    await p.locator('.check-item__save--error').waitFor()
    check('D4 a failed save is shown on the item itself, with a Try again button', /Not saved/.test(await text(first)) && (await first.getByRole('button', { name: 'Try again' }).count()) === 1)
    check('D5 the status bar says so, and Complete is disabled', /not saved/i.test(await saveText(p)) && (await completeBtn(p).isDisabled()))
    check('D6 the server still has Not checked: the screen does not pretend it was saved', (await inspectionOf(R_NET)).lines[0].current.condition === 'Not checked')
    await p.unroute('**/api/audit/inspections/*/results/*')
    await first.getByRole('button', { name: 'Try again' }).click()
    await settled(p)
    check('D7 after the connection returns, Try again saves it', (await inspectionOf(R_NET)).lines[0].current.condition === 'Working' && (await progressText(p)).startsWith('1 of'))
    await p.route('**/api/audit/inspections/*/results/*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' } }) }))
    await pickCondition(first, 'Not applicable')
    await p.locator('.check-item__save--error').waitFor()
    check('D8 a server error (500) is reported with the server message and not saved', /Something went wrong on the server/.test(await text(first)) && (await inspectionOf(R_NET)).lines[0].current.condition === 'Working')
    await p.unroute('**/api/audit/inspections/*/results/*')
    await p.getByRole('button', { name: 'Try again' }).first().click()
    await settled(p)
    await answerAll(p)
    await p.route('**/api/audit/inspections/*/complete', (route) => route.abort())
    await completeBtn(p).click()
    await p.locator('.error-summary').waitFor()
    check('D9 if completing fails to reach the server, the technician is told, nothing is lost, and it is still In progress', /could not be reached/.test(await text(p.locator('.error-summary'))) && (await inspectionOf(R_NET)).status === 'In progress' && (await completeBtn(p).isEnabled()))
    await p.unroute('**/api/audit/inspections/*/complete')
    await completeBtn(p).click()
    await p.getByText('Inspection completed for room').waitFor()
    check('D10 completing again works', (await inspectionOf(R_NET)).status === 'Completed')

    // Failing to load an inspection that is under way.
    const r = R_TABLET
    const started = await send('POST', `/api/audit/rooms/${r.id}/inspection`, { inspectorId: TECH.id })
    await p.route('**/api/audit/inspections/*', (route) => route.request().method() === 'GET' ? route.abort() : route.fallback())
    await gotoInspect(p, r)
    await p.locator('.state--error').waitFor()
    check('D11 if the inspection under way cannot be loaded, the screen says so and offers Try again', /could not be opened/.test(await text(p.locator('.state--error'))) && (await p.getByRole('button', { name: 'Try again' }).count()) === 1)
    await p.unroute('**/api/audit/inspections/*')
    await p.getByRole('button', { name: 'Try again' }).click()
    await p.waitForSelector('li.check-item')
    check('D12 Try again opens it', (await items(p).count()) === r.equipment.length && started.status === 201)
    await k.ctx.close()
  }

  console.log('\n== E. Unable to inspect, and resuming ==')
  {
    const k = await open()
    const p = k.page
    await gotoInspect(p, R_UNABLE)
    await startAs(p, TECH)
    await answer(items(p).nth(0), 'Working')
    await answer(items(p).nth(1), 'Not working', 'Screen flickers')
    await settled(p)
    await p.getByRole('button', { name: 'Unable to inspect' }).click()
    await p.getByRole('button', { name: 'Record: unable to inspect' }).click()
    check('E1 recording "unable" with no reason is refused with a message, and sends nothing', /at least 3 characters|reason/i.test(await text(p.locator('#field-unableReason-error'))) && count(k.requests, /\/unable$/) === 0)
    await p.fill('#field-unableReason', 'no')
    await p.getByRole('button', { name: 'Record: unable to inspect' }).click()
    check('E2 a reason of two characters is refused', (await p.locator('#field-unableReason-error').count()) === 1 && count(k.requests, /\/unable$/) === 0)
    await p.getByRole('button', { name: 'Room locked' }).click()
    check('E3 a common reason can be picked with one tap', (await p.inputValue('#field-unableReason')) === 'Room locked')
    await p.getByRole('button', { name: 'Record: unable to inspect' }).click()
    await p.getByRole('heading', { name: 'Inspect this room again' }).waitFor()
    const after = await inspectionOf(R_UNABLE)
    check('E4 the server records the reason, the technician and the time, and the status', after.status === 'Unable to inspect' && after.attempts.length === 1 && after.attempts[0].reason === 'Room locked' && after.attempts[0].byName === TECH.name && !Number.isNaN(Date.parse(after.attempts[0].at)))
    check('E5 the answers already given are kept on the server', after.lines[0].current.condition === 'Working' && after.lines[1].current.condition === 'Not working' && after.lines[1].current.note === 'Screen flickers' && after.progress.checked === 2)
    check('E6 the screen says so: the reason, and that the earlier answers were kept', /Room locked/.test(await text(p.locator('main'))) && /kept/.test(await text(p.locator('main'))))
    await gotoRoom(p, R_UNABLE)
    check('E7 the room page shows Unable to inspect with the reason, and offers to inspect it again', /Unable to inspect/.test(await text(p.locator('main'))) && (await p.getByRole('link', { name: 'Inspect this room again' }).count()) === 1)
    await p.getByRole('link', { name: 'Inspect this room again' }).click()
    await p.getByRole('heading', { name: 'Inspect this room again' }).waitFor()
    await p.reload()
    await p.getByRole('heading', { name: 'Inspect this room again' }).waitFor()
    check('E8 a reload keeps showing the same recorded visit (the server holds it, not the screen)', /Room locked/.test(await text(p.locator('main'))))
    const startsBefore = count(k.requests, START)
    await startAs(p, TECH2)
    check('E9 starting again resumes the SAME inspection, now in progress, with the second technician', count(k.requests, START) === startsBefore + 1 && (await detailOf(R_UNABLE)).inspection.inspectionId === after.id && (await inspectionOf(R_UNABLE)).status === 'In progress' && (await inspectionOf(R_UNABLE)).inspectorName === TECH2.name)
    check('E10 the earlier answers are back on screen and counted: "2 of N items checked"', (await progressText(p)) === `2 of ${R_UNABLE.equipment.length} items checked` && (await items(p).nth(1).locator('textarea').first().inputValue()) === 'Screen flickers' && (await items(p).nth(0).getByRole('radio', { name: 'Working', exact: true }).first().isChecked()))
    check('E11 the earlier visit and its reason are shown while carrying on', /Earlier visit: Room locked/.test(await text(p.locator('main'))))
    for (let i = 2; i < R_UNABLE.equipment.length; i += 1) await answer(items(p).nth(i), 'Working')
    await p.locator('.save-state--saving').waitFor({ state: 'detached' })
    await completeBtn(p).click()
    await p.getByText('Inspection completed for room').waitFor()
    const finished = await inspectionOf(R_UNABLE)
    check('E12 it completes, the earlier visit stays in the history, and the first answers are unchanged', finished.status === 'Completed' && finished.attempts.length === 1 && finished.lines[1].current.note === 'Screen flickers')
    await k.ctx.close()
  }

  console.log('\n== F. A room with no equipment ==')
  {
    const k = await open()
    const p = k.page
    await gotoRoom(p, R_EMPTY)
    await p.getByRole('link', { name: 'Start inspection' }).click()
    await startAs(p, TECH)
    check('F1 an empty room shows "No equipment recorded" and an explicit confirmation, not a checklist', /No equipment recorded/.test(await text(p.locator('#no-equipment'))) && (await items(p).count()) === 0)
    check('F2 Complete is disabled and the screen asks for the confirmation', (await completeBtn(p).isDisabled()) && /Confirm that this room has no equipment/.test(await text(p.locator('.problem-list'))))
    await p.getByLabel('I confirm there is no equipment in this room').check()
    await p.getByText('Everything is answered').waitFor()
    check('F3 ticking the confirmation is saved on the server and enables Complete', (await inspectionOf(R_EMPTY)).noEquipmentConfirmed === true && (await completeBtn(p).isEnabled()))
    await p.getByLabel('I confirm there is no equipment in this room').uncheck()
    await p.getByText('Still needed before you can complete').waitFor()
    check('F4 taking it back is saved too, and Complete is disabled again', (await inspectionOf(R_EMPTY)).noEquipmentConfirmed === false && (await completeBtn(p).isDisabled()))
    await p.reload()
    await p.locator('#no-equipment').waitFor()
    check('F5 after a reload the empty room is still in progress and unconfirmed', (await progressText(p)) === '0 of 0 items checked' && !(await p.getByLabel('I confirm there is no equipment in this room').isChecked()))
    await p.getByLabel('I confirm there is no equipment in this room').check()
    await p.getByText('Everything is answered').waitFor()
    await completeBtn(p).click()
    await p.getByText('Inspection completed for room').waitFor()
    const done = await inspectionOf(R_EMPTY)
    check('F6 completing records the room as inspected with no equipment, and the summary says so', done.status === 'Completed' && done.noEquipmentConfirmed === true && done.lines.length === 0 && /no equipment to inspect/.test(await text(p.locator('main'))))
    await gotoRoom(p, R_EMPTY)
    check('F7 the room page says an inspector confirmed the room has no equipment', /confirmed in this cycle that the room has no equipment/.test(await text(p.locator('main'))))
    const k2 = await open()
    await gotoInspect(k2.page, R_TABLET)
    await k2.page.waitForSelector('li.check-item')
    check('F8 a room that has equipment never shows the "no equipment" confirmation', (await k2.page.locator('#no-equipment').count()) === 0)
    await k2.ctx.close()
    await k.ctx.close()
  }

  console.log('\n== G. Duplicate submissions ==')
  {
    const k = await open()
    const p = k.page
    await gotoInspect(p, R_DUP)
    await p.selectOption('#field-inspector', { label: TECH.name })
    await p.getByRole('button', { name: 'Start inspection' }).dblclick()
    await p.waitForSelector('li.check-item')
    check('G1 a double click on Start sends one request', count(k.requests, START) === 1)
    const inRoom = (await get(`/api/audit/rooms?cycle=${openC.id}&inspection=inProgress&pageSize=100`)).body.data.filter((r) => r.id === R_DUP.id)
    check('G2 the server has one inspection for the room', inRoom.length === 1)
    await p.reload()
    await p.waitForSelector('li.check-item')
    check('G3 reloading never starts a second one', count(k.requests, START) === 1)
    await answerAll(p)
    await completeBtn(p).dblclick()
    await p.getByText('Inspection completed for room').waitFor()
    check('G4 a double click on Complete sends one request, and the inspection completes once', count(k.requests, COMPLETE) === 1 && (await inspectionOf(R_DUP)).status === 'Completed')

    // Two screens open on the same inspection (two tabs, or two technicians).
    const room = R_TWO
    const a = await open()
    await gotoInspect(a.page, room)
    await startAs(a.page, TECH)
    await answerAll(a.page)
    const b = await open()
    await gotoInspect(b.page, room)
    await b.page.waitForSelector('li.check-item')
    check('G5 a second screen opened on the same room resumes the same inspection (no second start)', count(b.requests, START) === 0 && (await b.page.locator('input:checked').count()) >= room.equipment.length)
    await completeBtn(a.page).click()
    await a.page.getByText('Inspection completed for room').waitFor()
    check('G6 the Complete button on the other screen is still live (it cannot know yet)', await completeBtn(b.page).isEnabled())
    await completeBtn(b.page).click()
    await b.page.getByText('Inspection completed for room').waitFor()
    check('G7 completing from the second screen is handled: it shows the completed summary, and the server completed once', (await inspectionOf(room)).status === 'Completed' && count(b.requests, COMPLETE) === 1)
    await a.ctx.close()
    await b.ctx.close()
    await k.ctx.close()
  }

  console.log('\n== H. Tablet, phone and keyboard ==')
  {
    const t = await open({ viewport: { width: 820, height: 1180 } })
    await gotoInspect(t.page, R_TABLET)
    await t.page.waitForSelector('li.check-item')
    check('H1 tablet: no horizontal scrolling', await t.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    check('H2 tablet: every condition choice and every action button is at least 44px high', await t.page.evaluate(() => [...document.querySelectorAll('.choice span, .inspection-bar__actions .btn')].every((el) => el.getBoundingClientRect().height >= 44)))
    await t.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const barTop = await t.page.locator('.inspection-bar').evaluate((el) => el.getBoundingClientRect().top)
    check('H3 the progress, save status and Complete button stay in view while scrolling a long checklist', barTop >= 0 && barTop < 140, `bar top ${Math.round(barTop)}px`)
    if (SHOTS) await t.page.screenshot({ path: `${SHOTS}/inspect-tablet.png`, fullPage: true })
    const card = items(t.page).first()
    await card.getByRole('radio', { name: 'Working', exact: true }).first().focus()
    await t.page.keyboard.press('ArrowRight')
    await settled(t.page)
    check('H4 keyboard: arrow keys move through the conditions inside an item and the choice is saved', (await card.getByRole('radio', { name: 'Not working', exact: true }).first().isChecked()) && (await inspectionOf(R_TABLET)).lines[0].current.condition === 'Not working')
    check('H5 every radio button has an accessible name (its condition)', await t.page.evaluate(() => [...document.querySelectorAll('.check-item input[type=radio]')].every((el) => (el.labels?.[0]?.textContent ?? '').replace(/✓/g, '').trim().length > 0)))
    check('H6 each item card has its own heading, and the page one level-one heading', (await t.page.locator('h1').count()) === 1 && (await t.page.locator('.check-item h3').count()) === R_TABLET.equipment.length)
    await t.page.getByRole('radio', { name: 'Working', exact: true }).first().focus()
    const ring = await t.page.locator('.choice input:focus-visible + span').first().evaluate((el) => { const cs = getComputedStyle(el); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }).catch(() => false)
    check('H7 keyboard focus on a choice shows a clear ring', ring)
    await t.ctx.close()
    const ph = await open({ viewport: { width: 390, height: 844 } })
    await gotoInspect(ph.page, R_TABLET)
    await ph.page.waitForSelector('li.check-item')
    check('H8 phone: no horizontal scrolling, and the conditions wrap rather than overflow', await ph.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    if (SHOTS) await ph.page.screenshot({ path: `${SHOTS}/inspect-phone.png`, fullPage: false })
    await ph.ctx.close()
    const l = await open({ colorScheme: 'dark' })
    await gotoInspect(l.page, R_TABLET)
    await l.page.waitForSelector('li.check-item')
    check('H9 the light theme is kept even when the system asks for dark', await l.page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(250, 248, 247)'))
    await l.ctx.close()
  }
} catch (e) { check('SETUP aborted', false, String(e.message).slice(0, 300)) }

await browser.close()
console.log(`\n${pass}/${pass + fail} checks passed`)
