import {
  assetLimits,
  type ImportedTable,
  importedTables,
  type ImportKind,
  importKinds,
  importLimits,
} from '@opengewerk/haustechnik-domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

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

/**
 * What each import made (#174): a row for every property, building, floor,
 * room and asset an import wrote, so that its page leads to them and the log
 * of each of them begins with the import. Written by a trigger on the five
 * tables while `import_writing()` is true, and only then; the application
 * writes no row itself and changes none.
 *
 * It does not travel (decided on 15.10.2026): a device has no use for it, so
 * the table has no columns of the sync. It has no area: a row says no more
 * than the import it names, and every page that reads it joins the record
 * under the policies of the record's own table.
 */
export const importRecords = pgTable(
  'import_records',
  {
    ...tenantColumn,
    importId: reference<'import'>('import_id').notNull(),
    tableName: text('table_name').$type<ImportedTable>().notNull(),
    recordId: uuid('record_id').notNull(),
    /**
     * The naming fields of the record as the import wrote them, `name`,
     * `number` and `kind` as text (#422): the log of the record has no entry
     * that names it, and its page says what it was, not what it is.
     */
    named: jsonb('named')
      .$type<Readonly<Record<string, string | null>>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    tenantIsolation(table.tenantId),
    primaryKey({
      name: 'import_records_pkey',
      columns: [table.tenantId, table.tableName, table.recordId],
    }),
    foreignKey({
      columns: [table.tenantId, table.importId],
      foreignColumns: [imports.tenantId, imports.id],
      name: 'import_records_of_an_import',
    }),
    check(
      'import_records_table_known',
      sql.raw(`"table_name" in (${importedTables.map((name) => `'${name}'`).join(', ')})`),
    ),
    index('import_records_by_import').on(table.tenantId, table.importId),
    check('import_records_named_object', sql`jsonb_typeof(${table.named}) = 'object'`),
  ],
)
