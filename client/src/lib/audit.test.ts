import { describe, expect, it } from 'vitest'
import { checkWords, describeInspection, describeProgress, describeRemaining, plural, readCycle, withCycle } from './audit'
import { progress, roomDone, roomUnable, roomB001, roomB205 } from '../test/auditFixtures'

describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'floor')).toBe('1 floor')
    expect(plural(0, 'floor')).toBe('0 floors')
    expect(plural(2, 'floor')).toBe('2 floors')
  })
})

describe('readCycle', () => {
  it('accepts a plain reference and ignores anything else', () => {
    expect(readCycle('CYC-003')).toBe('CYC-003')
    expect(readCycle(null)).toBeUndefined()
    expect(readCycle('')).toBeUndefined()
    expect(readCycle('CYC 3; drop')).toBeUndefined()
    expect(readCycle('x'.repeat(33))).toBeUndefined()
  })
})

describe('withCycle', () => {
  it('adds the cycle to a path, with the right separator, and leaves it alone when there is none', () => {
    expect(withCycle('/audit', 'CYC-002')).toBe('/audit?cycle=CYC-002')
    expect(withCycle('/audit/rooms/R?x=1', 'CYC-002')).toBe('/audit/rooms/R?x=1&cycle=CYC-002')
    expect(withCycle('/audit', undefined)).toBe('/audit')
  })
})

describe('describeProgress / describeRemaining', () => {
  it('describes progress, and does not call an empty scope "0%"', () => {
    expect(describeProgress(progress(12, 0, 0, 53))).toBe('12 of 65 rooms completed')
    expect(describeProgress(progress(0, 0, 0, 0))).toBe('No rooms to inspect')
    expect(describeProgress(progress(1, 0, 0, 0))).toBe('1 of 1 room completed')
  })
  it('lists only the non-zero remaining parts', () => {
    expect(describeRemaining(progress(5, 2, 1, 3))).toBe('2 in progress · 1 unable to inspect · 3 not started')
    expect(describeRemaining(progress(5, 0, 0, 0))).toBe('')
    expect(describeRemaining(progress(0, 0, 0, 65))).toBe('65 not started')
  })
})

describe('checkWords', () => {
  const base = { checkId: 'firmware', label: 'Firmware', okLabel: 'Up to date', notOkLabel: 'Needs update', note: '' }
  it('shows a check answer in its own words', () => {
    expect(checkWords({ ...base, condition: 'Working' })).toBe('Up to date')
    expect(checkWords({ ...base, condition: 'Not working' })).toBe('Needs update')
    expect(checkWords({ ...base, condition: 'Not applicable' })).toBe('Not applicable')
    expect(checkWords({ ...base, condition: 'Not checked' })).toBe('Not checked')
  })
})

describe('describeInspection', () => {
  it('says who finished a completed room, and why an uninspected one was skipped', () => {
    expect(describeInspection(roomDone.inspection)).toBe('Aisha Rahman · 1 Jul 2026')
    expect(describeInspection(roomUnable.inspection)).toBe('Room locked')
  })
  it('says nothing for a room not started, or one outside the cycle', () => {
    expect(describeInspection(roomB001.inspection)).toBe('')
    expect(describeInspection(roomB205.inspection)).toBe('')
  })
})
