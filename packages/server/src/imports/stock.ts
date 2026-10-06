import type {
  AssetImportStock,
  Catalogue,
  ImportKind,
  StructureStock,
  TenantId,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { asc, isNotNull, isNull, or, sql } from 'drizzle-orm'

import {
  assetKindNames,
  assets,
  buildings,
  floors,
  imports,
  properties,
  rooms,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'

/**
 * What a plan of an import is held against (#100): the places and assets the
 * person importing can see. Read inside their transaction, so under the
 * policies of their tenant and their areas (ADR 0003): a line can name
 * nothing in an area they do not hold in, and nothing there is counted as
 * known or as a duplicate.
 *
 * Read once for the whole table. A question per line would be thousands of
 * them for a list of a few thousand lines, each reading the same rows.
 */
export async function structureStock(tx: TenantTransaction): Promise<StructureStock> {
  return {
    properties: await tx
      .select({ id: properties.id, name: properties.name, areaId: properties.areaId })
      .from(properties)
      .where(isNull(properties.deletedAt)),
    buildings: await tx
      .select({ id: buildings.id, propertyId: buildings.propertyId, name: buildings.name })
      .from(buildings)
      .where(isNull(buildings.deletedAt)),
    floors: await tx
      .select({ id: floors.id, buildingId: floors.buildingId, name: floors.name })
      .from(floors)
      .where(isNull(floors.deletedAt)),
    rooms: await tx
      .select({
        id: rooms.id,
        floorId: rooms.floorId,
        buildingId: rooms.buildingId,
        number: rooms.number,
        name: rooms.name,
      })
      .from(rooms)
      .where(isNull(rooms.deletedAt)),
  }
}

/** The same, with the assets a line may be a duplicate of, the words for kinds and the catalogue of today. */
export async function assetImportStock(
  tx: TenantTransaction,
  catalogue: Catalogue,
): Promise<AssetImportStock> {
  return {
    ...(await structureStock(tx)),
    assets: await tx
      .select({
        id: assets.id,
        number: assets.number,
        name: assets.name,
        serialNumber: assets.serialNumber,
        mark: assets.mark,
      })
      .from(assets)
      .where(
        sql`${isNull(assets.deletedAt)} and ${or(isNotNull(assets.serialNumber), isNotNull(assets.mark))}`,
      )
      .orderBy(asc(assets.number)),
    kindNames: await tx
      .select({ name: assetKindNames.name, kind: assetKindNames.kind })
      .from(assetKindNames)
      .orderBy(asc(assetKindNames.name)),
    kinds: new Map(
      catalogue.assetKinds(dayInGermany()).map((entry) => [entry.key, entry.definition]),
    ),
  }
}

/**
 * Writes the row of an import and names it to the transaction, so that the
 * places and assets written after it make no entries of their own in the
 * change log: the row is the entry. It has to come first. The triggers ask
 * `import_writing()`, and that is true only while the row this transaction
 * named was written by this transaction.
 */
export async function beginImport(
  tx: TenantTransaction,
  tenantId: TenantId,
  written: { kind: ImportKind; fileName: string; lines: number; summary: string },
): Promise<string> {
  const [row] = await tx
    .insert(imports)
    .values({ tenantId, ...written })
    .returning({ id: imports.id })
  const id = String(row?.id)

  await tx.execute(sql`select set_config('app.import_id', ${id}, true)`)

  return id
}

/** Rows in parts a single statement can carry. */
export function inParts<Row>(rows: readonly Row[], size = 500): Row[][] {
  const parts: Row[][] = []

  for (let at = 0; at < rows.length; at += size) {
    parts.push(rows.slice(at, at + size))
  }

  return parts
}
