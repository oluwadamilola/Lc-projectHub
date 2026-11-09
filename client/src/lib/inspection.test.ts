import { describe, expect, it } from 'vitest'
import { foundLine, panelLine, projectorLine } from '../test/auditFixtures'
import { checksApply, conditionNeedsNote, describeChecked, draftFromLine, itemTitle, percentChecked, problemTarget } from './inspection'

describe('draftFromLine', () => {
  it('starts an unanswered line as Not checked, with one unanswered entry per check', () => {
    expect(draftFromLine(projectorLine)).toEqual({ condition: 'Not checked', note: '', checks: [] })
    expect(draftFromLine(panelLine)).toEqual({ condition: 'Not checked', note: '', checks: [{ checkId: 'firmware', condition: 'Not checked', note: '' }] })
  })

  it('carries what the server already holds, so a resumed inspection shows earlier answers', () => {
    const line = {
      ...panelLine,
      current: {
        ...panelLine.previous!,
        condition: 'Not working' as const,
        note: 'Screen dead',
        checks: [{ checkId: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update', condition: 'Working' as const, note: '' }],
      },
    }
    expect(draftFromLine(line)).toEqual({ condition: 'Not working', note: 'Screen dead', checks: [{ checkId: 'firmware', condition: 'Working', note: '' }] })
  })

  it('does not take the previous cycle answer as this cycle answer', () => {
    expect(draftFromLine(projectorLine).condition).toBe('Not checked')
  })
})

describe('checksApply and conditionNeedsNote', () => {
  it('asks the extra checks only of an item that is present', () => {
    expect(['Working', 'Not working', 'Needs replacement'].every((c) => checksApply(c as 'Working'))).toBe(true)
    expect(['Missing', 'Not applicable', 'Not checked'].some((c) => checksApply(c as 'Missing'))).toBe(false)
  })

  it('uses the shared rule for which conditions need a note', () => {
    expect(['Not working', 'Needs replacement', 'Missing'].every((c) => conditionNeedsNote(c as 'Missing'))).toBe(true)
    expect(['Working', 'Not applicable', 'Not checked'].some((c) => conditionNeedsNote(c as 'Working'))).toBe(false)
  })
})

describe('describing an item and progress', () => {
  it('titles an item by type, adding its own name when it has one', () => {
    expect(itemTitle(projectorLine)).toBe('Projector')
    expect(itemTitle(foundLine)).toBe('Other: Document camera')
  })

  it('says "3 of 7 items checked", and "1 of 1 item checked" in the singular', () => {
    expect(describeChecked({ total: 7, checked: 3 })).toBe('3 of 7 items checked')
    expect(describeChecked({ total: 1, checked: 1 })).toBe('1 of 1 item checked')
    expect(describeChecked({ total: 0, checked: 0 })).toBe('0 of 0 items checked')
  })

  it('gives a whole-number percentage, and zero for an empty list', () => {
    expect(percentChecked({ total: 3, checked: 1 })).toBe(33)
    expect(percentChecked({ total: 3, checked: 3 })).toBe(100)
    expect(percentChecked({ total: 0, checked: 0 })).toBe(0)
  })
})

describe('problemTarget', () => {
  it('points an item problem at its card, a check problem at the same card, and the confirmation at its panel', () => {
    expect(problemTarget('results.EQP-014')).toBe('item-EQP-014')
    expect(problemTarget('results.EQP-014.checks.firmware')).toBe('item-EQP-014')
    expect(problemTarget('noEquipmentConfirmed')).toBe('no-equipment')
  })

  it('has no target for anything else', () => {
    expect(problemTarget('body')).toBeNull()
    expect(problemTarget('results.')).toBeNull()
  })
})
