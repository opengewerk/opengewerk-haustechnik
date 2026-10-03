import { createHash } from 'node:crypto'

import type { PackageRuleRecord } from './format.js'

export function sha256(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * The checksum of a version of an entry: of its file, byte for byte, as the
 * repository holds it.
 */
export function entryChecksum(bytes: Uint8Array): string {
  return sha256(bytes)
}

/**
 * The checksum of a rule. A rule is one record in a file that changes
 * whenever a rule is added, so the checksum is taken over the record alone,
 * in one fixed form: its fields in the order of the format, a rule of the
 * whole country without a scope, no spacing. A record that is corrected after
 * it was accepted has another checksum, and its acceptance no longer matches
 * (ADR 0005, point 9).
 */
export function ruleChecksum(record: PackageRuleRecord): string {
  return sha256(
    JSON.stringify({
      key: record.key,
      scope: record.scope,
      validFrom: record.validFrom,
      validUntil: record.validUntil,
      unit: record.unit,
      value: record.value,
      source: record.source,
      origin: record.origin,
      note: record.note,
    }),
  )
}
