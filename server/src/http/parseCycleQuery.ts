import { CYCLE_REFERENCE_PATTERN, type ApiErrorDetail } from '@lc-projecthub/shared'
import { ValidationError } from '../errors.js'
import { readText, rejectUnknownParameters } from './queryParsing.js'

/**
 * Reads the optional `cycle` parameter shared by the audit block, floor and room-detail endpoints.
 * Returns the cycle reference, or undefined to mean "the open cycle" (a missing or empty value). Throws a
 * ValidationError for anything else in the query string, so a misspelt parameter fails loudly.
 */
export function parseCycleQuery(query: Record<string, unknown>): string | undefined {
  const errors: ApiErrorDetail[] = []
  rejectUnknownParameters(query, ['cycle'], errors)
  const cycleId = readText(query, 'cycle', errors)
  if (cycleId !== undefined && !CYCLE_REFERENCE_PATTERN.test(cycleId)) {
    errors.push({ field: 'cycle', message: 'Must be a cycle reference such as CYC-001.' })
  }
  if (errors.length > 0) throw new ValidationError(errors)
  return cycleId
}
