import type { ApiErrorDetail } from './types.js'

/*
  Building blocks shared by the project and task validators, so both produce the same kinds of
  messages and apply the same rules to text, choices and dates.
*/

const MIN_YEAR = 1900
const MAX_YEAR = 2100

/** True for a real calendar date written as YYYY-MM-DD (so 2026-02-30 is rejected). */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (year < MIN_YEAR || year > MAX_YEAR) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Control characters have no place in these fields; only multi-line text may contain line breaks. */
function hasForbiddenCharacter(value: string, allowLineBreaks: boolean): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    const isLineBreak = code === 0x0a || code === 0x0d
    if ((code < 0x20 && !(allowLineBreaks && isLineBreak)) || code === 0x7f) return true
  }
  return false
}

export interface TextRules {
  /** Maximum length after trimming. */
  limit: number
  /** When false, an empty value is accepted and returned as "". */
  required: boolean
  /** Allow line breaks (descriptions). */
  multiline: boolean
}

/** Validates a text field and returns the trimmed value ("" when invalid or, if optional, empty). */
export function checkText(
  field: string,
  label: string,
  raw: unknown,
  rules: TextRules,
  errors: ApiErrorDetail[],
): string {
  if (raw === undefined || raw === null) {
    if (rules.required) errors.push({ field, message: `Enter the ${label}.` })
    return ''
  }
  if (typeof raw !== 'string') {
    errors.push({ field, message: `The ${label} must be text.` })
    return ''
  }
  const value = raw.trim()
  if (value === '') {
    if (rules.required) errors.push({ field, message: `Enter the ${label}.` })
  } else if (value.length > rules.limit) {
    errors.push({ field, message: `The ${label} must be ${rules.limit} characters or fewer.` })
  } else if (hasForbiddenCharacter(value, rules.multiline)) {
    errors.push({ field, message: `The ${label} contains characters that are not allowed.` })
  }
  return value
}

export function checkChoice<T extends string>(
  field: string,
  label: string,
  raw: unknown,
  allowed: readonly T[],
  errors: ApiErrorDetail[],
): T | undefined {
  if (raw === undefined || raw === null || raw === '') {
    errors.push({ field, message: `Choose a ${label}.` })
    return undefined
  }
  const match = allowed.find((option) => option === raw)
  if (!match) errors.push({ field, message: `The ${label} must be one of: ${allowed.join(', ')}.` })
  return match
}

export function checkDate(field: string, label: string, raw: unknown, errors: ApiErrorDetail[]): string | undefined {
  if (raw === undefined || raw === null || raw === '') {
    errors.push({ field, message: `Enter the ${label}.` })
    return undefined
  }
  if (typeof raw !== 'string' || !isIsoDate(raw)) {
    errors.push({ field, message: `Enter a valid ${label}.` })
    return undefined
  }
  return raw
}

/** Adds an error for every property that is not in `known`, so a mistyped name is never silently dropped. */
export function rejectUnknownFields(
  input: Record<string, unknown>,
  known: readonly string[],
  errors: ApiErrorDetail[],
): void {
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) errors.push({ field: key, message: 'This field is not recognised.' })
  }
}

/** Orders errors to match the form (unknown fields last). */
export function sortByFieldOrder(errors: ApiErrorDetail[], order: readonly string[]): void {
  const rank = (field: string) => {
    const index = order.indexOf(field)
    return index === -1 ? order.length : index
  }
  errors.sort((a, b) => rank(a.field) - rank(b.field))
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
