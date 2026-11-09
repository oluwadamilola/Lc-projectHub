import { API, assertIsolated } from '../lib/guard.mjs'

/*
  Audit module API (stage 1R-a read side, stage 2a write side), exercised over real HTTP on the isolated test stack
  against the BUILT server. Sections A to J crawl the read API and recompute every figure independently from the
  per-room data, never from the aggregated figures they check. Section K, last, then carries out real inspections
  through the write endpoints. It runs last because it changes the (in-memory, per-suite) seed data.
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
check('H7 the inventory and progress endpoints are read-only: POST, PUT, PATCH and DELETE are 404 on every one of them', (await Promise.all(['POST', 'PUT', 'PATCH', 'DELETE'].flatMap((m) => ['/api/audit/cycles', '/api/audit/blocks', '/api/audit/rooms', '/api/audit/rooms/ROOM-001', '/api/audit/equipment-types'].map(async (p) => (await raw(p, { method: m })).status)))).every((s) => s === 404))
check('H8 inspections cannot be listed, deleted or patched: there is no such endpoint (they are only started, filled in and completed)', (await status('/api/audit/inspections')) === 404 && (await status('/api/audit/inspections', { method: 'POST' })) === 404 && (await status('/api/audit/inspections/INS-001', { method: 'DELETE' })) === 404 && (await status('/api/audit/inspections/INS-001', { method: 'PATCH' })) === 404)
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

console.log('\n== K. Carrying out inspections (the write API) ==')
const send = async (method, path, body) => {
  const r = await raw(`/api/audit${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, location: r.headers.get('location'), body: await r.json() }
}
const technicians = (await get('/api/technicians')).body.data
const TECH = technicians[0], TECH2 = technicians[1]
const roomByCode = (code) => openRooms.find((r) => r.code === code)
const stateOf = async (cycleId = open.id) => (await get(`/api/audit/cycles/${cycleId}`)).body.data.progress
const before = await stateOf()

// A room with equipment (B101 has a Clevertouch panel), taken from its own record rather than assumed.
const b101 = roomByCode('B101')
const b101Lines = (await get(`/api/audit/rooms/${b101.id}`)).body.data.equipment
const started = await send('POST', `/rooms/${b101.id}/inspection`, { inspectorId: TECH.id })
check('K1 starting an inspection of B101 in the open cycle is 201, with a Location, in progress, with the chosen technician', started.status === 201 && started.location === `/api/audit/inspections/${started.body.data.id}` && started.body.data.status === 'In progress' && started.body.data.inspectorName === TECH.name && started.body.data.cycle.id === open.id, JSON.stringify(started.body.data).slice(0, 120))
const insId = started.body.data.id
check('K2 the checklist is exactly the room\'s own active equipment, each line Not checked, with identifiers where it has them', same(started.body.data.lines.map((l) => l.id), b101Lines.map((l) => l.id)) && started.body.data.lines.every((l) => l.current.condition === 'Not checked') && started.body.data.progress.total === b101Lines.length && started.body.data.progress.checked === 0)
check('K3 every line shows last time\'s answer (the room was inspected in earlier cycles)', started.body.data.lines.filter((l) => l.previous).length === b101Lines.filter((l) => l.previous).length && started.body.data.lines.some((l) => l.previous))
const again = await send('POST', `/rooms/${b101.id}/inspection`, { inspectorId: TECH2.id })
check('K4 starting again is idempotent: 200, the same inspection, the first inspector kept, no duplicate', again.status === 200 && again.body.data.id === insId && again.body.data.inspectorId === TECH.id)
const afterStart = await stateOf()
check('K5 the cycle progress moved by exactly one room: in progress +1, not started -1', afterStart.inProgress === before.inProgress + 1 && afterStart.notStarted === before.notStarted - 1 && afterStart.completed === before.completed)
check('K6 the room list and room page now show it in progress, with 0 of N items checked', (await get(`/api/audit/rooms/${b101.id}`)).body.data.inspection.status === 'In progress' && (await get(`/api/audit/rooms/${b101.id}`)).body.data.inspection.totalLines === b101Lines.length)

const early = await send('POST', `/inspections/${insId}/complete`)
check('K7 completing too early is 400 and names every item still to check', early.status === 400 && same(early.body.error.details.map((d) => d.field), b101Lines.map((l) => `results.${l.id}`)), JSON.stringify(early.body.error.details?.map((d) => d.field)))
const answerOf = (line, over = {}) => ({ condition: 'Working', note: '', checks: line.checks.map((c) => ({ checkId: c.id, condition: 'Working', note: '' })), ...over })
const target = b101Lines[0]
const missingNote = await send('PUT', `/inspections/${insId}/results/${target.id}`, answerOf(target, { condition: 'Not working', note: '' }))
check('K8 a Not working answer without a note can be saved as a draft (200) but completion then lists the missing note', missingNote.status === 200 && missingNote.body.data.completion.problems.some((p) => p.field === `results.${target.id}` && /note/.test(p.message)))
let last
for (const line of b101Lines.slice(1)) last = await send('PUT', `/inspections/${insId}/results/${line.id}`, answerOf(line))
check('K9 saving each remaining line is 200 and progress counts up to N-1 of N', last.status === 200 && last.body.data.progress.checked === b101Lines.length && last.body.data.progress.total === b101Lines.length)
const stillBlocked = await send('POST', `/inspections/${insId}/complete`)
check('K10 completion is still refused while the one required note is missing', stillBlocked.status === 400 && same(stillBlocked.body.error.details.map((d) => d.field), [`results.${target.id}`]))
const withNote = await send('PUT', `/inspections/${insId}/results/${target.id}`, answerOf(target, { condition: 'Not working', note: 'Does not power on' }))
check('K11 once the note is written the inspection reports it can be completed', withNote.status === 200 && withNote.body.data.completion.canComplete === true && withNote.body.data.completion.problems.length === 0)
const resumed = await send('GET', `/inspections/${insId}`)
check('K12 leaving and coming back loses nothing: GET returns every saved answer', resumed.status === 200 && resumed.body.data.lines.find((l) => l.id === target.id).current.note === 'Does not power on' && resumed.body.data.progress.checked === b101Lines.length)

const found = await send('POST', `/inspections/${insId}/equipment`, { equipmentTypeId: 'other', name: 'Test visualiser', serialNumber: 'SN-K-1' })
check('K13 equipment found in the room: 201, flagged "Needs review", on the checklist as a line still to check, and not yet completable', found.status === 201 && found.body.data.lines.some((l) => l.id === found.body.equipmentItemId && l.reviewStatus === 'Needs review' && l.source === 'Found during inspection' && l.current.condition === 'Not checked') && found.body.data.completion.canComplete === false)
const roomAfterFound = (await get(`/api/audit/rooms/${b101.id}`)).body.data
check('K14 it is in the room inventory too: one more item, one more needing review', roomAfterFound.equipmentCount === b101Lines.length + 1 && roomAfterFound.itemsNeedingReview === roomByCode('B101').itemsNeedingReview + 1)
const dupTag = await send('POST', `/inspections/${insId}/equipment`, { equipmentTypeId: 'phone', assetTag: b101Lines.find((l) => l.assetTag)?.assetTag ?? 'NO-SUCH' })
check('K15 an asset tag already in use is 409 (when the room has a tagged item)', b101Lines.some((l) => l.assetTag) ? dupTag.status === 409 && dupTag.body.error.code === 'CONFLICT' : true)
await send('PUT', `/inspections/${insId}/results/${found.body.equipmentItemId}`, { condition: 'Working', note: '' })

const done = await send('POST', `/inspections/${insId}/complete`)
check('K16 completing is 200 with a summary: totals, the fault with its note, and the equipment that needs inventory review', done.status === 200 && done.body.data.status === 'Completed' && done.body.data.summary.totalItems === b101Lines.length + 1 && done.body.data.summary.issues.some((i) => i.equipmentItemId === target.id && i.kind === 'Fault' && i.note === 'Does not power on') && done.body.data.summary.foundItems.some((f) => f.equipmentItemId === found.body.equipmentItemId))
const afterDone = await stateOf()
check('K17 the cycle progress now shows the room completed: completed +1 against the start, in progress back to where it was', afterDone.completed === before.completed + 1 && afterDone.inProgress === before.inProgress && afterDone.notStarted === before.notStarted - 1)
const second = await send('POST', `/inspections/${insId}/complete`)
check('K18 submitting completion a second time is 409 and the completion time does not change', second.status === 409 && second.body.error.code === 'CONFLICT' && (await send('GET', `/inspections/${insId}`)).body.data.completedAt === done.body.data.completedAt)
const frozen = await Promise.all([
  send('PUT', `/inspections/${insId}/results/${target.id}`, { condition: 'Working', note: '' }),
  send('POST', `/inspections/${insId}/equipment`, { equipmentTypeId: 'phone' }),
  send('PUT', `/inspections/${insId}/no-equipment`, { confirmed: false }),
  send('POST', `/inspections/${insId}/unable`, { reason: 'Room locked' }),
  send('POST', `/rooms/${b101.id}/inspection`, { inspectorId: TECH.id }),
])
check('K19 a completed inspection cannot be changed, extended, marked unable or restarted: all 409', frozen.every((r) => r.status === 409 && r.body.error.code === 'CONFLICT'), frozen.map((r) => r.status).join())
check('K20 the room page now shows the technician, completed, and this cycle\'s answers beside last time\'s', (await get(`/api/audit/rooms/${b101.id}?cycle=${open.id}`)).body.data.equipment.every((l) => l.current && l.current.condition !== 'Not checked' && l.current.inspectorName === TECH.name))

// A room with no equipment.
const empty = openRooms.find((r) => r.active && r.equipmentCount === 0 && r.inspection.status === 'Not started')
const e = await send('POST', `/rooms/${empty.id}/inspection`, { inspectorId: TECH.id })
const eEarly = await send('POST', `/inspections/${e.body.data.id}/complete`)
check('K21 a room with no equipment cannot be completed without the explicit confirmation', e.status === 201 && e.body.data.lines.length === 0 && eEarly.status === 400 && eEarly.body.error.details[0].field === 'noEquipmentConfirmed')
const eOk = await send('PUT', `/inspections/${e.body.data.id}/no-equipment`, { confirmed: true })
const eDone = await send('POST', `/inspections/${e.body.data.id}/complete`)
check('K22 ... but can once it is confirmed, and the summary records that', eOk.status === 200 && eDone.status === 200 && eDone.body.data.summary.noEquipmentConfirmed === true && eDone.body.data.summary.totalItems === 0)
const unconfirmable = await send('PUT', `/inspections/${(await send('POST', `/rooms/${roomByCode('B102').id}/inspection`, { inspectorId: TECH.id })).body.data.id}/no-equipment`, { confirmed: true })
check('K23 confirming "no equipment" for a room that has equipment is rejected (409)', unconfirmable.status === 409 && unconfirmable.body.error.code === 'CONFLICT')

// A room that cannot be inspected, then tried again.
const locked = openRooms.find((r) => r.active && r.equipmentCount > 0 && r.inspection.status === 'Not started' && ![b101.id, roomByCode('B102').id].includes(r.id))
const l = await send('POST', `/rooms/${locked.id}/inspection`, { inspectorId: TECH.id })
const lockedLine = l.body.data.lines[0]
await send('PUT', `/inspections/${l.body.data.id}/results/${lockedLine.id}`, { condition: 'Not working', note: 'Lamp will not light' })
const u = await send('POST', `/inspections/${l.body.data.id}/unable`, { reason: 'Room locked', inspectorId: TECH2.id })
check('K24 "unable to inspect" records the reason, the technician who recorded it and when', u.status === 200 && u.body.data.status === 'Unable to inspect' && u.body.data.attempts.length === 1 && u.body.data.attempts[0].reason === 'Room locked' && u.body.data.attempts[0].byId === TECH2.id && u.body.data.attempts[0].byName === TECH2.name && !Number.isNaN(Date.parse(u.body.data.attempts[0].at)))
const lr = (await get(`/api/audit/rooms/${locked.id}`)).body.data
check('K25 the room list and page show it Unable to inspect with that reason', lr.inspection.status === 'Unable to inspect' && lr.inspection.unableReason === 'Room locked' && (await get(`/api/audit/rooms?cycle=${open.id}&inspection=unable&pageSize=100`)).body.data.some((r) => r.id === locked.id))
const retry = await send('POST', `/rooms/${locked.id}/inspection`, { inspectorId: TECH.id })
check('K26 the room is still eligible: starting again is 200, the same record, in progress, with the earlier attempt kept', retry.status === 200 && retry.body.data.id === l.body.data.id && retry.body.data.status === 'In progress' && retry.body.data.attempts.length === 1 && retry.body.data.lines.length === locked.equipmentCount)
const keptLine = retry.body.data.lines.find((x) => x.id === lockedLine.id)
check('K26a the answer saved before "unable to inspect" is still there after starting again (nothing lost), and the progress shows it', u.body.data.progress.checked === 1 && keptLine.current.condition === 'Not working' && keptLine.current.note === 'Lamp will not light' && retry.body.data.progress.checked === 1)
check('K26b the audit clock is in effect: the inspection was started inside the Summer 2027 window (2027-06-21 to 2027-08-27)', l.body.data.startedAt >= '2027-06-21' && l.body.data.startedAt <= '2027-08-27T23:59:59Z' && l.body.data.cycle.startDate === '2027-06-21')

// Concurrency.
const other = openRooms.find((r) => r.active && r.inspection.status === 'Not started' && ![b101.id, empty.id, roomByCode('B102').id, locked.id].includes(r.id))
const burst = await Promise.all(Array.from({ length: 6 }, () => send('POST', `/rooms/${other.id}/inspection`, { inspectorId: TECH.id })))
check('K27 six simultaneous starts make ONE inspection: one 201, five 200, one id', burst.filter((r) => r.status === 201).length === 1 && burst.filter((r) => r.status === 200).length === 5 && new Set(burst.map((r) => r.body.data.id)).size === 1)

// Closed cycles, unknown references, invalid data.
const closedStart = await send('POST', `/rooms/${other.id}/inspection`, { inspectorId: TECH.id, cycleId: byName('Summer 2026').id })
check('K28 a closed cycle cannot be inspected in: 409', closedStart.status === 409 && closedStart.body.error.code === 'CONFLICT')
const retired = openRooms.find((r) => !r.active)
check('K29 a retired room (outside the cycle) cannot be inspected: 409', (await send('POST', `/rooms/${retired.id}/inspection`, { inspectorId: TECH.id })).status === 409)
check('K30 unknown room, cycle, inspection and item are 404', (await send('POST', '/rooms/ROOM-999/inspection', { inspectorId: TECH.id })).status === 404 && (await send('POST', `/rooms/${other.id}/inspection`, { inspectorId: TECH.id, cycleId: 'CYC-999' })).status === 404 && (await send('GET', '/inspections/INS-999')).status === 404 && (await send('PUT', `/inspections/${burst[0].body.data.id}/results/EQP-999`, { condition: 'Working', note: '' })).status === 404)
const invalid = await Promise.all([
  send('POST', `/rooms/${other.id}/inspection`, {}),
  send('POST', `/rooms/${other.id}/inspection`, { inspectorId: 'TECH-999' }),
  send('POST', `/inspections/${burst[0].body.data.id}/unable`, { reason: 'x' }),
  send('POST', `/inspections/${burst[0].body.data.id}/equipment`, { equipmentTypeId: 'nonsense' }),
])
check('K31 invalid or unknown input is 400 with the offending field named', invalid.every((r) => r.status === 400 && r.body.error.code === 'VALIDATION_ERROR' && r.body.error.details.length >= 1), invalid.map((r) => r.status).join())
const malformed = await raw(`/api/audit/rooms/${other.id}/inspection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"inspectorId":' })
check('K32 a malformed JSON body is 400, never a server error', malformed.status === 400)
check('K33 the project, task and technician endpoints are untouched by all of it', (await status('/api/projects')) === 200 && (await status('/api/tasks')) === 200 && (await status('/api/technicians')) === 200)

console.log(`\n${pass}/${pass + fail} checks passed`)
