import { importedTables } from '@opengewerk/haustechnik-domain'
import { type AuditFirstValues, isUuid } from '@opengewerk/platform-server'
import { inArray } from 'drizzle-orm'

import { importRecords } from '../database/schema/index.js'

/**
 * What the log calls a record an import made (#422): the record has no entry
 * that names it, since the import is one entry in the place of one for every
 * record (#100), and the log asks here for the names it was made with, as the
 * trigger of the import kept them (migration 0080). Asked under the policy of
 * the tenant, for records of the five tables an import writes and no other;
 * whatever the log has of a field wins over what stands here.
 */
export const namedByImports: AuditFirstValues = async (tx, places) => {
  const asked = places.filter(
    (place) => (importedTables as readonly string[]).includes(place.table) && isUuid(place.id),
  )

  if (asked.length === 0) {
    return new Map()
  }

  const wanted = new Set(asked.map((place) => `${place.table}:${place.id}`))
  const rows = await tx
    .select({
      table: importRecords.tableName,
      id: importRecords.recordId,
      named: importRecords.named,
    })
    .from(importRecords)
    .where(
      inArray(
        importRecords.recordId,
        asked.map((place) => place.id),
      ),
    )

  return new Map(
    rows
      .filter((row) => wanted.has(`${row.table}:${row.id}`))
      .map((row) => [String(row.id), row.named] as const),
  )
}
