import {
  assetLimits,
  type ImportKind,
  importKinds,
  importLimits,
} from '@opengewerk/haustechnik-domain'
import { primaryId, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, integer, pgTable, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core'

import { trimmed } from './locations.js'

/**
 * An import from a table (#100, section 11 of the concept): the file, how
 * many of its lines were read and what came of them, in words.
 *
 * A row is written once, in the transaction that writes the records of the
 * import, and never changed: the application role may insert and read. It is
 * what the change log shows of an import. While the row of this transaction
 * stands, the places and assets written beside it make no entries of their
 * own (`import_writing()` in migration 0022), so an import is one entry and
 * not one for every field of every record.
 *
 * It has no area. An import of places reaches as far as the person importing
 * does, and what it says is a file name and a count.
 */
export const imports = pgTable(
  'imports',
  {
    id: primaryId<'import'>(),
    ...tenantColumn,
    kind: text('kind').$type<ImportKind>().notNull(),
    fileName: text('file_name').notNull(),
    lines: integer('lines').notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('imports_tenant_id_key').on(table.tenantId, table.id),
    check(
      'imports_kind_known',
      sql.raw(`"kind" in (${importKinds.map((kind) => `'${kind}'`).join(', ')})`),
    ),
    check('imports_file_name_shaped', trimmed(table.fileName, importLimits.fileName)),
    check('imports_summary_shaped', trimmed(table.summary, importLimits.summary)),
    check('imports_lines_counted', sql`${table.lines} > 0`),
  ],
)

/**
 * What the lists of a tenant call an asset kind (section 11: "Anlagenarten
 * zuordnen"): a word as a list writes it, and the asset kind of the
 * catalogue it means. Kept once and read by every later import.
 *
 * A word is there once, compared as `kindNameKey` compares: `name_key` holds
 * that, and the index over it is what makes saving a word again a
 * correction. Tenant-wide and without an area, like the catalogue it points
 * into.
 */
export const assetKindNames = pgTable(
  'asset_kind_names',
  {
    id: primaryId<'asset_kind_name'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    kind: text('kind').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    uniqueIndex('asset_kind_names_once').on(table.tenantId, table.nameKey),
    check('asset_kind_names_name_shaped', trimmed(table.name, assetLimits.name)),
    check(
      'asset_kind_names_key_shaped',
      sql`char_length(${table.nameKey}) between 1 and ${sql.raw(String(assetLimits.name))}`,
    ),
    check('asset_kind_names_kind_shaped', trimmed(table.kind, assetLimits.kind)),
  ],
)
