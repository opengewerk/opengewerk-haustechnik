import { Controller, Get, NotFoundException, Param } from '@nestjs/common'
import {
  byNameIn,
  type ImportedRecord,
  type ImportedTable,
  importedTables,
  type ImportOrigin,
  type ImportReading,
} from '@opengewerk/haustechnik-domain'
import {
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import {
  assets,
  buildings,
  floors,
  importRecords,
  imports,
  properties,
  rooms,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import type { Asking } from './places.js'

const importGone = 'Diesen Import gibt es nicht.'

/**
 * The records an import made that are still there, as the person asking sees
 * them: every table joined under its own policies, so a record out of their
 * areas or removed since is none of them. Places first, in the order of the
 * tables, each by what it is called.
 */
async function madeBy(tx: TenantTransaction, importId: string): Promise<ImportedRecord[]> {
  const of = (table: ImportedTable) =>
    and(eq(importRecords.importId, importId as never), eq(importRecords.tableName, table))
  const named = await Promise.all([
    tx
      .select({ id: properties.id, title: properties.name })
      .from(importRecords)
      .innerJoin(properties, eq(properties.id, importRecords.recordId as never))
      .where(and(of('properties'), isNull(properties.deletedAt))),
    tx
      .select({ id: buildings.id, title: buildings.name })
      .from(importRecords)
      .innerJoin(buildings, eq(buildings.id, importRecords.recordId as never))
      .where(and(of('buildings'), isNull(buildings.deletedAt))),
    tx
      .select({ id: floors.id, title: sql<string>`${buildings.name} || ', ' || ${floors.name}` })
      .from(importRecords)
      .innerJoin(floors, eq(floors.id, importRecords.recordId as never))
      .innerJoin(buildings, eq(buildings.id, floors.buildingId))
      .where(and(of('floors'), isNull(floors.deletedAt))),
    tx
      .select({
        id: rooms.id,
        title: sql<string>`${buildings.name} || ', ' || concat_ws(' ', ${rooms.number}, ${rooms.name})`,
      })
      .from(importRecords)
      .innerJoin(rooms, eq(rooms.id, importRecords.recordId as never))
      .innerJoin(buildings, eq(buildings.id, rooms.buildingId))
      .where(and(of('rooms'), isNull(rooms.deletedAt))),
    tx
      .select({
        id: assets.id,
        title: sql<string>`concat_ws(' ', ${assets.number}, ${assets.name})`,
      })
      .from(importRecords)
      .innerJoin(assets, eq(assets.id, importRecords.recordId as never))
      .where(and(of('assets'), isNull(assets.deletedAt))),
  ])

  return importedTables.flatMap((table, index) =>
    [...(named[index] ?? [])]
      .sort((left, right) => byNameIn(left.title, right.title))
      .map((row) => ({ table, id: String(row.id), title: row.title })),
  )
}

/**
 * Where a record came from and what an import made (#174). Both are read
 * from the change log, so whoever reads the log reads them, the Leitung: the
 * page of an import is reached from its entry there, and the import that made
 * a record stands over the record's own log.
 *
 * Under `imports` beside the routes that import, with two segments and three,
 * so that neither takes the address of another.
 */
@Controller('imports')
export class ImportOriginController {
  constructor(private readonly database: Database) {}

  /** An import with the records it made, as its page reads them. */
  @Get(':importId/made')
  @RequiresPermission('audit.read')
  made(
    @CurrentIdentity() identity: Asking,
    @Param('importId') importId: string,
  ): Promise<ImportReading> {
    return this.database.forTenant(identity, async (tx) => {
      if (!isUuid(importId)) {
        throw new NotFoundException(importGone)
      }

      const [row] = await tx
        .select()
        .from(imports)
        .where(eq(imports.id, importId as never))

      if (row === undefined) {
        throw new NotFoundException(importGone)
      }

      return {
        id: String(row.id),
        kind: row.kind,
        fileName: row.fileName,
        lines: row.lines,
        summary: row.summary,
        importedOn: dayInGermany(row.createdAt),
        records: await madeBy(tx, importId),
      }
    })
  }

  /** The import that made a record, or nothing: one made by hand or on site came from none. */
  @Get('origins/:table/:recordId')
  @RequiresPermission('audit.read')
  origin(
    @CurrentIdentity() identity: Asking,
    @Param('table') table: string,
    @Param('recordId') recordId: string,
  ): Promise<ImportOrigin | null> {
    return this.database.forTenant(identity, async (tx) => {
      if (!(importedTables as readonly string[]).includes(table) || !isUuid(recordId)) {
        return null
      }

      const [row] = await tx
        .select({ id: imports.id, fileName: imports.fileName, createdAt: imports.createdAt })
        .from(importRecords)
        .innerJoin(
          imports,
          and(eq(imports.tenantId, importRecords.tenantId), eq(imports.id, importRecords.importId)),
        )
        .where(
          and(
            eq(importRecords.tableName, table as ImportedTable),
            eq(importRecords.recordId, recordId),
          ),
        )
        .orderBy(asc(imports.createdAt))

      return row === undefined
        ? null
        : {
            importId: String(row.id),
            fileName: row.fileName,
            importedOn: dayInGermany(row.createdAt),
          }
    })
  }
}
