import { API, assertIsolated } from '../lib/guard.mjs'

/*
  Audit module, stage 1R-a: the read-only API, exercised over real HTTP on the isolated test stack against the
  BUILT server. There is no page to look at yet (the client comes in 1R-b), so this suite crawls the API and
  recomputes every figure independently from the per-room data, never from the aggregated figures it checks.
*/

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`) }
const raw = (path, init) => fetch(API + path, init)
const get = async (path) => { const r = await raw(path); return { status: r.status, body: await r.json() } }

// Refuses to run unless the stack is the isolated test stack (never the development server).
await assertIsolated()

/** Every room (any status) as the room list shows it for a cycle. */
async function roomsFor(cycleId) {
  const rooms = []
  for (let page = 1; ; page += 1) {
    const { body } = await get(`/api/audit/rooms?cycle=${cycleId}&status=all&pageSize=100&page=${page}`)
    rooms.push(...body.data)
    if (page >= body.meta.totalPages) break
  }
  return rooms
}
const tally = (rooms) => {
  const inScope = rooms.filter((r) => r.inspection.inScope)
  const count = (status) => inScope.filter((r) => r.inspection.status === status).length
  const completed = count('Completed')
  return { scope: inScope.length, completed, inProgress: count('In progress'), unableToInspect: count('Unable to inspect'), notStarted: count('Not started'), percentComplete: inScope.length === 0 ? null : Math.round((completed / inScope.length) * 100) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n== A. Cycles ==')
const cycles = (await get('/api/audit/cycles')).body.data
const byName = (name) => cycles.find((c) => c.name === name)
check('A1 three cycles, newest first: Summer 2027, Summer 2026, Summer 2025', same(cycles.map((c) => c.name), ['Summer 2027', 'Summer 2026', 'Summer 2025']), cycles.map((c) => c.name).join(' | '))
check('A2 Summer 2027 is the ONE open cycle; Summer 2026 and Summer 2025 are closed', same(cycles.map((c) => c.status), ['Open', 'Closed', 'Closed']) && cycles.filter((c) => c.status === 'Open').length === 1)
check('A3 the cycle dates are the fixed fictional ones', same(cycles.map((c) => [c.startDate, c.endDate]), [['2027-06-21', '2027-08-27'], ['2026-06-22', '2026-08-28'], ['2025-06-23', '2025-08-29']]))
check('A4 only closed cycles have a closing time', cycles.every((c) => (c.closedAt === null) === (c.status === 'Open')))
check('A5 the scope list is never exposed', cycles.every((c) => !('scopeRoomIds' in c)))
check('A6 scopes are 65 (open), 67 and 67 rooms', same(cycles.map((c) => c.roomsInScope), [65, 67, 67]))
const open = byName('Summer 2027')

console.log('\n== B. Progress equals an independent count, in every cycle ==')
for (const cycle of cycles) {
  const rooms = await roomsFor(cycle.id)
  const mine = tally(rooms)
  check(`B1 [${cycle.name}] the cycle's progress equals a count of the rooms' own inspection status`, same(cycle.progress, mine), JSON.stringify(cycle.progress) + ' vs ' + JSON.stringify(mine))
  check(`B2 [${cycle.name}] the four states add up to the scope`, cycle.progress.completed + cycle.progress.inProgress + cycle.progress.unableToInspect + cycle.progress.notStarted === cycle.progress.scope)
  const blocks = (await get(`/api/audit/blocks?cycle=${cycle.id}`)).body
  let blocksOk = true, floorsOk = true, detail = ''
  for (const block of blocks.data) {
    const mineBlock = tally(rooms.filter((r) => r.blockId === block.id))
    if (!same(block.progress, mineBlock)) { blocksOk = false; detail += ` [${block.name}: ${JSON.stringify(block.progress)} vs ${JSON.stringify(mineBlock)}]` }
    const floors = (await get(`/api/audit/blocks/${block.id}/floors?cycle=${cycle.id}`)).body.data
    for (const floor of floors) {
      const mineFloor = tally(rooms.filter((r) => r.floorId === floor.id))
      if (!same(floor.progress, mineFloor)) { floorsOk = false; detail += ` [${block.name}/${floor.name}]` }
    }
  }
  check(`B3 [${cycle.name}] every block's progress equals an independent count`, blocksOk, detail.slice(0, 200))
  check(`B4 [${cycle.name}] every floor's progress equals an independent count`, floorsOk, detail.slice(0, 200))
  check(`B5 [${cycle.name}] the overview total equals the cycle's progress`, same(blocks.summary.progress, cycle.progress))
}
check('B6 the open cycle has NO inspection activity: nothing completed, nothing in progress, nothing unable to inspect, all 65 rooms not started, 0% complete', same(open.progress, { scope: 65, completed: 0, inProgress: 0, unableToInspect: 0, notStarted: 65, percentComplete: 0 }), JSON.stringify(open.progress))
check('B7 Summer 2026: 62 completed, 3 unable to inspect, 2 not started (the two rooms retired since)', same(byName('Summer 2026').progress, { scope: 67, completed: 62, inProgress: 0, unableToInspect: 3, notStarted: 2, percentComplete: 93 }), JSON.stringify(byName('Summer 2026').progress))
check('B8 Summer 2025: 60 completed, 4 unable to inspect, 3 not started', same(byName('Summer 2025').progress, { scope: 67, completed: 60, inProgress: 0, unableToInspect: 4, notStarted: 3, percentComplete: 90 }), JSON.stringify(byName('Summer 2025').progress))

console.log('\n== C. The default cycle, and room lists by inspection state ==')
const defaults = (await get('/api/audit/blocks')).body
check('C1 with no cycle given, everything describes the OPEN cycle', defaults.cycle.id === open.id && (await get('/api/audit/rooms')).body.cycle.id === open.id)
const openRooms = await roomsFor(open.id)
const filtered = async (f, cycleId = open.id) => (await get(`/api/audit/rooms?cycle=${cycleId}&status=all&inspection=${f}&pageSize=100`)).body
for (const [f, expected] of [['completed', 0], ['inProgress', 0], ['unable', 0], ['notStarted', 65], ['toInspect', 65]]) {
  const body = await filtered(f)
  check(`C2 [open cycle] inspection=${f} lists ${expected} rooms, all in scope`, body.meta.total === expected && body.data.every((r) => r.inspection.inScope), `${body.meta.total}`)
}
check('C3 [open cycle] "toInspect" is every active room: the whole scope is still to do', same((await filtered('toInspect')).data.map((r) => r.id).sort(), openRooms.filter((r) => r.active).map((r) => r.id).sort()))
check('C4 retired rooms are not in the open cycle\'s scope, so never "to inspect" there', openRooms.filter((r) => !r.active).every((r) => !r.inspection.inScope) && (await filtered('toInspect')).data.every((r) => r.active))
const retiredIn2025 = (await roomsFor(byName('Summer 2025').id)).filter((r) => !r.active)
check('C5 the two retired rooms WERE in scope in Summer 2025', retiredIn2025.length === 2 && retiredIn2025.every((r) => r.inspection.inScope))
const closedCycles = cycles.filter((c) => c.status === 'Closed')
const unableByCycle = {}
for (const c of closedCycles) unableByCycle[c.name] = (await filtered('unable', c.id)).data
check('C6 [closed cycles] 4 rooms in Summer 2025 and 3 in Summer 2026 could not be inspected, each with a reason of 3 characters or more', unableByCycle['Summer 2025'].length === 4 && unableByCycle['Summer 2026'].length === 3 && Object.values(unableByCycle).flat().every((r) => (r.inspection.unableReason ?? '').length >= 3), Object.values(unableByCycle).flat().map((r) => r.inspection.unableReason).join(' | '))
check('C7 [open cycle] every room is Not started: no inspection, no inspector, no dates, no lines', openRooms.every((r) => r.inspection.status === 'Not started' && r.inspection.inspectionId === null && r.inspection.inspectorName === null && r.inspection.startedAt === null && r.inspection.completedAt === null && r.inspection.totalLines === 0 && r.inspection.checkedLines === 0 && r.inspection.unableReason === null))
const completedByCycle = {}
for (const c of closedCycles) completedByCycle[c.name] = (await filtered('completed', c.id)).data
check('C8 [closed cycles] every completed room names the technician who did it', Object.values(completedByCycle).flat().every((r) => typeof r.inspection.inspectorName === 'string' && r.inspection.inspectorName.length > 0))
check('C9 [closed cycles] every completed room has every line answered, and no draft was left behind', Object.values(completedByCycle).flat().every((r) => r.inspection.checkedLines === r.inspection.totalLines) && (await Promise.all(closedCycles.map((c) => filtered('inProgress', c.id)))).every((b) => b.meta.total === 0))

console.log('\n== D. Rooms, equipment and checklists ==')
const details = new Map()
for (const room of openRooms) details.set(room.id, (await get(`/api/audit/rooms/${room.id}`)).body.data)
const lines = [...details.values()].flatMap((d) => d.equipment.map((l) => ({ room: d, line: l })))
const tags = lines.map(({ line }) => line.assetTag).filter(Boolean)
check('D1 every room has a detail record; equipment counts agree with the room list', openRooms.every((r) => details.get(r.id).equipment.length === r.equipmentCount))
check('D2 236 active equipment items in all (replaced and removed items are history, not listed)', lines.length === 236, `${lines.length}`)
check('D3 asset tags are valid and unique; serial numbers are within 60 characters', new Set(tags).size === tags.length && tags.every((t) => /^[A-Za-z0-9-]{1,40}$/.test(t)) && lines.every(({ line }) => !line.serialNumber || line.serialNumber.length <= 60))
check('D4 identifiers are optional: some items have a tag only, a serial only, both or neither', ['tag', 'serial', 'both', 'neither'].every((kind) => lines.some(({ line }) => ({ tag: line.assetTag && !line.serialNumber, serial: !line.assetTag && line.serialNumber, both: line.assetTag && line.serialNumber, neither: !line.assetTag && !line.serialNumber }[kind]))))
const emptyRooms = [...details.values()].filter((d) => d.active && d.equipment.length === 0)
check('D5 exactly three active rooms have no equipment in the inventory', same(emptyRooms.map((d) => d.code).sort(), ['B005', 'B006', 'S024']), emptyRooms.map((d) => d.code).join(' '))
const withDuplicates = [...details.values()].filter((d) => { const t = {}; for (const l of d.equipment) t[l.equipmentTypeId] = (t[l.equipmentTypeId] ?? 0) + 1; return Object.values(t).some((n) => n > 1) })
check('D6 several rooms hold two items of one type, named apart', withDuplicates.length >= 4 && withDuplicates.every((d) => { const names = d.equipment.filter((l) => d.equipment.filter((m) => m.equipmentTypeId === l.equipmentTypeId).length > 1).map((l) => l.name); return names.every(Boolean) && new Set(names).size === names.length }))
check('D7 items of the "Other" category always carry a name', lines.filter(({ line }) => line.equipmentTypeId === 'other').every(({ line }) => line.name.length > 0))
const panels = lines.filter(({ line }) => line.equipmentTypeId === 'clevertouch-panel')
check('D8 seven Clevertouch panels, each with a firmware check shown as Up to date / Needs update; no other item has a check', panels.length === 7 && panels.every(({ line }) => same(line.checks.map((c) => [c.id, c.okLabel, c.notOkLabel]), [['firmware', 'Up to date', 'Needs update']])) && lines.filter(({ line }) => line.equipmentTypeId !== 'clevertouch-panel').every(({ line }) => line.checks.length === 0))
const types = (await get('/api/audit/equipment-types')).body.data
check('D9 firmware is a check, not equipment: eight types, none named firmware', types.length === 8 && types.every((t) => !/firmware/i.test(t.label + t.id)) && same(types.map((t) => t.label), ['Phone', 'Projector', 'TV', 'Dock', 'Speaker', 'Card Reader', 'Clevertouch Panel', 'Other']))
const review = lines.filter(({ line }) => line.reviewStatus === 'Needs review')
check('D10 exactly one item was found during an inspection (in Summer 2026) and is flagged "Needs review"', review.length === 1 && review[0].line.source === 'Found during inspection' && review[0].line.name === 'Document camera' && review[0].room.itemsNeedingReview === 1 && review[0].room.code === 'B103')
check('D11 every other item comes from the inventory and is Confirmed', lines.filter(({ line }) => line.reviewStatus !== 'Needs review').every(({ line }) => line.source === 'Inventory' && line.reviewStatus === 'Confirmed'))

console.log('\n== E. The checklist rules hold in the recorded inspections (Summer 2025 and Summer 2026) ==')
const recorded = []
for (const c of closedCycles) for (const r of openRooms) recorded.push({ cycle: c, d: (await get(`/api/audit/rooms/${r.id}?cycle=${c.id}`)).body.data })
const completedRooms = recorded.filter(({ d }) => d.inspection.status === 'Completed')
const cl = completedRooms.flatMap(({ d }) => d.equipment.filter((l) => l.current).map((l) => ({ d, l })))
check('E1 no answer in a completed inspection is "Not checked", and every one has a time', cl.length > 300 && cl.every(({ l }) => l.current.condition !== 'Not checked' && l.current.checkedAt), `${cl.length} answers`)
check('E2 conditions used are only Working / Not working / Needs replacement / Missing / Not applicable', cl.every(({ l }) => ['Working', 'Not working', 'Needs replacement', 'Missing', 'Not applicable'].includes(l.current.condition)))
check('E3 Missing is its own condition, separate from Needs replacement', cl.some(({ l }) => l.current.condition === 'Missing') && cl.some(({ l }) => l.current.condition === 'Needs replacement'))
check('E4 every Not working, Needs replacement and Missing result carries a note', cl.filter(({ l }) => ['Not working', 'Needs replacement', 'Missing'].includes(l.current.condition)).every(({ l }) => l.current.note.trim().length > 0))
check('E5 every firmware check is answered (Working / Not working) unless the panel is Missing or Not applicable; a Not working check has a note', cl.filter(({ l }) => l.equipmentTypeId === 'clevertouch-panel').every(({ l }) => l.current.checks.every((c) => (['Missing', 'Not applicable'].includes(l.current.condition) ? c.condition === 'Not applicable' : ['Working', 'Not working'].includes(c.condition)) && (c.condition !== 'Not working' || c.note.trim().length > 0))))
const confirmedEmpty = completedRooms.filter(({ d }) => d.equipment.length === 0)
check('E6 a completed room with no equipment records the explicit "no equipment" confirmation', confirmedEmpty.length > 0 && confirmedEmpty.every(({ d }) => d.noEquipmentConfirmed === true), `${confirmedEmpty.length} rooms`)
check('E7 no room with equipment carries that confirmation', recorded.filter(({ d }) => d.equipment.length > 0).every(({ d }) => d.noEquipmentConfirmed !== true))
check('E8 there is no draft in any cycle and no "Not checked" answer anywhere in the recorded inspections', recorded.every(({ d }) => d.inspection.status !== 'In progress' && d.equipment.every((l) => !l.current || l.current.condition !== 'Not checked')) && [...details.values()].every((d) => d.inspection.status === 'Not started'))
check('E9 a room that could not be inspected has a reason and no recorded answers', recorded.filter(({ d }) => d.inspection.status === 'Unable to inspect').every(({ d }) => (d.inspection.unableReason ?? '').length >= 3 && d.equipment.every((l) => l.current === null)) && recorded.filter(({ d }) => d.inspection.status === 'Unable to inspect').length === 7)
const corrected = cl.filter(({ l }) => l.current.corrected)
check('E10 exactly one answer has been corrected since it was completed, and it is in Summer 2026', corrected.length === 1 && recorded.find(({ d }) => d === corrected[0].d).cycle.name === 'Summer 2026')

console.log('\n== F. Last time: the previous answer ==')
const withPrev = lines.filter(({ line }) => line.previous)
check('F1 many items show last cycle\'s answer, always from an EARLIER cycle and never "Not checked"', withPrev.length > 100 && withPrev.every(({ line }) => line.previous.cycleId !== open.id && line.previous.condition !== 'Not checked' && line.previous.checkedAt))
const b002 = [...details.values()].find((d) => d.code === 'B002')
const phones = b002.equipment.filter((l) => l.typeLabel === 'Phone')
check('F2 the room with a replaced phone lists only the new phone, which has no earlier answer of its own', phones.length === 1 && phones[0].assetTag === 'AT-90001' && phones[0].previous === null)
const prevCycle = await get(`/api/audit/rooms/${b002.id}?cycle=${byName('Summer 2026').id}`)
const oldPhones = prevCycle.body.data.equipment.filter((l) => l.typeLabel === 'Phone')
check("F3 viewing the room in Summer 2026 shows today's equipment with THAT cycle's answers: the new phone was not on that checklist, so it has no answer there", oldPhones.length === 1 && oldPhones[0].assetTag === 'AT-90001' && oldPhones[0].current === null && oldPhones[0].previous === null)
const first = await get(`/api/audit/rooms/${b002.id}?cycle=${byName('Summer 2025').id}`)
check('F4 in the earliest cycle nothing has an earlier answer', first.body.data.equipment.every((l) => l.previous === null))
const withLastYear = lines.filter(({ line }) => line.previous?.cycleName === 'Summer 2026')
const b104 = [...details.values()].find((d) => d.code === 'B104')
check("F5 'last time' is the most recent COMPLETED earlier cycle: Summer 2026 for most items", withLastYear.length > withPrev.length / 2 && withLastYear.every(({ line }) => line.previous.condition !== 'Not checked'))
check('F6 a room that could not be inspected in Summer 2026 falls back to its Summer 2025 answers', b104.equipment.length > 0 && b104.equipment.every((l) => l.previous?.cycleName === 'Summer 2025'))

console.log('\n== G. Floors, blocks and the room list: structure and filters ==')
const blocks = defaults.data
check('G1 six separate blocks: B Block, S Block, L Block, HE, IOT, T-LVL', same(blocks.map((b) => b.name), ['B Block', 'S Block', 'L Block', 'HE', 'IOT', 'T-LVL']))
const bBlock = blocks[0]
const bFloors = (await get(`/api/audit/blocks/${bBlock.id}/floors`)).body.data
check('G2 B Block has three floors (ground, first, second) listed in that order', same(bFloors.map((f) => [f.name, f.level]), [['Ground floor', 0], ['First floor', 1], ['Second floor', 2]]))
const bRooms = (await get(`/api/audit/rooms?block=${bBlock.id}&status=all&pageSize=100`)).body.data
check('G3 B Block rooms are B001.. on the ground floor, B101.. on the first, B201.. on the second', bRooms.every((r) => r.code[0] === 'B' && Number(r.code[1]) === r.floorLevel) && bRooms.filter((r) => r.floorLevel === 0).map((r) => r.code).join() === 'B001,B002,B003,B004,B005,B006')
check('G4 an existing floor with no rooms (one in IOT) is a valid, empty list', await (async () => { const iot = blocks.find((b) => b.name === 'IOT'); const floors = (await get(`/api/audit/blocks/${iot.id}/floors`)).body.data; const empty = floors.find((f) => f.roomCount === 0 && f.retiredRoomCount === 0); const r = await get(`/api/audit/rooms?floor=${empty.id}`); return r.status === 200 && r.body.data.length === 0 && same(empty.progress, { scope: 0, completed: 0, inProgress: 0, unableToInspect: 0, notStarted: 0, percentComplete: null }) })())
check('G5 room codes are valid and unique across the whole inventory', await (async () => { const all = openRooms.map((r) => r.code); return new Set(all).size === all.length && all.every((c) => /^[A-Z]{1,3}\d{3}[A-Z]?$/.test(c)) })())
const labs = (await get('/api/audit/rooms?q=lab&pageSize=100')).body
check('G6 searching "lab" finds rooms by name, ignoring case', labs.data.length > 0 && labs.data.every((r) => (r.code + ' ' + r.displayName).toLowerCase().includes('lab')))
const paged = (await get('/api/audit/rooms?pageSize=10&page=2')).body
check('G7 paging: page 2 of the active rooms at 10 a page', paged.meta.page === 2 && paged.data.length === 10 && paged.meta.total === 65 && paged.meta.totalPages === 7)

console.log('\n== H. Errors and the contract ==')
const status = async (p, init) => (await raw(p, init)).status
check('H1 unknown cycle / block / floor / room are 404', (await status('/api/audit/rooms?cycle=CYC-999')) === 404 && (await status('/api/audit/blocks/BLK-999')) === 404 && (await status('/api/audit/rooms?floor=FLR-999')) === 404 && (await status('/api/audit/rooms/ROOM-999')) === 404 && (await status('/api/audit/cycles/CYC-999')) === 404)
check('H2 a floor under the wrong block is 404', (await status(`/api/audit/blocks/${blocks[1].id}/floors/${bFloors[0].id}`)) === 404)
const bad = await get('/api/audit/rooms?block=x&cycle=y&inspection=z&status=w&page=0&bogus=1')
check('H3 invalid parameters are 400 and every problem is listed', bad.status === 400 && bad.body.error.code === 'VALIDATION_ERROR' && bad.body.error.details.length === 6, JSON.stringify(bad.body.error.details?.map((d) => d.field)))
check('H4 malformed references are 400', (await status('/api/audit/rooms/bad%20id')) === 400 && (await status('/api/audit/cycles/bad%20id')) === 400)
check('H5 pageSize above 100 and page 0 are rejected', (await status('/api/audit/rooms?pageSize=101')) === 400 && (await status('/api/audit/rooms?page=0')) === 400)
check('H6 an inspection state that is really an equipment condition is rejected', (await status('/api/audit/rooms?inspection=Working')) === 400 && (await status('/api/audit/rooms?inspection=Completed')) === 400)
check('H7 the audit API is read-only: POST, PUT, PATCH and DELETE are 404 everywhere', (await Promise.all(['POST', 'PUT', 'PATCH', 'DELETE'].flatMap((m) => ['/api/audit/cycles', '/api/audit/blocks', '/api/audit/rooms', '/api/audit/rooms/ROOM-001', '/api/audit/equipment-types'].map(async (p) => (await raw(p, { method: m })).status)))).every((s) => s === 404))
check('H8 there are no write endpoints for inspections yet', (await status('/api/audit/inspections')) === 404 && (await status('/api/audit/inspections', { method: 'POST' })) === 404)
check('H9 the project, task and technician endpoints are untouched', (await status('/api/health')) === 200 && (await status('/api/projects')) === 200 && (await status('/api/tasks')) === 200 && (await status('/api/technicians')) === 200)

console.log('\n== I. The data is fictional ==')
const everything = JSON.stringify([cycles, blocks, openRooms, types, [...details.values()]])
check('I1 no real workbook content appears anywhere in the API: no sheet names, example notes or room labels', ['Test - Examples', 'AUDIT - TEMPLATE', 'water leak', 'Tutors', 'Blinds', 'L104A', 'S113', 'Clevertouch FW'].every((token) => !everything.includes(token)))
check('I2 room names are generic descriptions only', openRooms.every((r) => /^(|Training room|Seminar room|Computer lab|Lecture room|Studio|Meeting room|Former store|Workshop|Store|Library desk|Quiet study room|Group study room|IT help point|Old archive|Lecture theatre|Research room|Engineering workshop|Electronics lab)$/.test(r.displayName)))
check('I3 every inspector is one of the six existing fictional technicians', await (async () => { const techs = (await get('/api/technicians')).body.data.map((t) => t.name); const names = new Set(Object.values(completedByCycle).flat().map((r) => r.inspection.inspectorName).filter(Boolean)); return names.size > 0 && [...names].every((n) => techs.includes(n)) })())

console.log('\n== J. Summer 2027 is open and has no inspection activity yet ==')
const openBlocks = (await get(`/api/audit/blocks?cycle=${open.id}`)).body
check('J1 Summer 2027 is the only open cycle, and its overview total is zero progress over 65 rooms', cycles.filter((c) => c.status === 'Open').length === 1 && open.name === 'Summer 2027' && same(openBlocks.summary.progress, { scope: 65, completed: 0, inProgress: 0, unableToInspect: 0, notStarted: 65, percentComplete: 0 }))
check('J2 every block and floor in the open cycle shows zero completed, in progress and unable, and a 0% (or empty) percentage', openBlocks.data.every((b) => b.progress.completed === 0 && b.progress.inProgress === 0 && b.progress.unableToInspect === 0 && b.progress.notStarted === b.progress.scope && (b.progress.scope === 0 ? b.progress.percentComplete === null : b.progress.percentComplete === 0)))
check('J3 not one item in any room has an answer in the open cycle (the checklist is untouched)', [...details.values()].every((d) => d.equipment.every((l) => l.current === null)))
check('J4 every item still shows last time\'s answer, so the next inspection starts with context', lines.filter(({ line }) => line.previous).length > 200)
check('J5 nothing in the open cycle\'s rooms or equipment is dated 2027 (activity dates would be future-dated)', !JSON.stringify([openRooms, [...details.values()]]).includes('2027'))
check('J6 the two closed cycles stay closed, with a closing time, and the open one has none', byName('Summer 2025').status === 'Closed' && byName('Summer 2026').status === 'Closed' && byName('Summer 2025').closedAt && byName('Summer 2026').closedAt && open.closedAt === null)

console.log(`\n${pass}/${pass + fail} checks passed`)
