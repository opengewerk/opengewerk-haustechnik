import {
  type AssetImportStock,
  type Catalogue,
  type DeadlineImportStock,
  type DuplicateField,
  type ImportKind,
  type IsoDate,
  standingEvidence,
  type StructureStock,
  type TableRecord,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm'

import { duplicateCandidatesOfList } from '../database/asset-duplicates.js'
import {
  assetKindNames,
  assets,
  attachments,
  attachmentVersions,
  buildings,
  duties,
  evidence,
  evidenceVoidings,
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
 * known. An asset there may still be a duplicate of a line, which
 * `assetImportStock` asks about on its own way.
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

/**
 * The same, with the assets a line may be a duplicate of, the words for kinds
 * and the catalogue of today.
 *
 * A duplicate is asked about past the areas as well (#255, ADR 0003, addendum
 * on #255), as the form in the office asks: once for the whole table, with
 * the serial numbers and the marks of its lines, through the one door there
 * is. What comes back from beyond the areas of the person is handed on
 * without its id. The plan says of such an asset the field a line shares
 * with it, and it is given nothing else it could say.
 */
export async function assetImportStock(
  tx: TenantTransaction,
  catalogue: Catalogue,
  records: readonly TableRecord[],
): Promise<AssetImportStock> {
  const seen = await tx
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
    .orderBy(asc(assets.number))
  const inSight = new Set<string>(seen.map((asset) => asset.id))
  const asked = (field: DuplicateField) => [
    ...new Set(records.map(({ values }) => values[field] ?? '')),
  ]
  const everywhere = await duplicateCandidatesOfList(tx, {
    serialNumber: asked('serialNumber'),
    mark: asked('mark'),
  })

  return {
    ...(await structureStock(tx)),
    assets: seen,
    beyond: everywhere
      .filter((asset) => !inSight.has(asset.id))
      .map(({ serialNumber, mark }) => ({ serialNumber, mark })),
    kindNames: await tx
      .select({ name: assetKindNames.name, kind: assetKindNames.kind })
      .from(assetKindNames)
      .orderBy(asc(assetKindNames.name)),
    kinds: new Map(
      catalogue.assetKinds(dayInGermany()).map((entry) => [entry.key, entry.definition]),
    ),
  }
}

/** The property and the area of an asset, which a duty and a document at it carry. */
export interface AssetPlace {
  readonly propertyId: (typeof assets.$inferSelect)['propertyId']
  readonly areaId: (typeof assets.$inferSelect)['areaId']
}

/**
 * What a list of running deadlines is held against (#130): the assets the
 * person importing sees, the duties that stand at them with the days of the
 * evidence that stands for each, and the documents taken over before. Read
 * inside their transaction, under the policies of their tenant and their
 * areas: a line can name no asset beyond them.
 *
 * Read once for the whole table, like the stock of every import. The places
 * of the assets come back beside it, for what the take-over writes.
 */
export async function deadlineImportStock(
  tx: TenantTransaction,
  catalogue: Catalogue,
  files: readonly string[],
  today: IsoDate,
): Promise<{ stock: DeadlineImportStock; places: ReadonlyMap<string, AssetPlace> }> {
  const seen = await tx
    .select({
      id: assets.id,
      number: assets.number,
      name: assets.name,
      mark: assets.mark,
      serialNumber: assets.serialNumber,
      kind: assets.kind,
      federalState: properties.federalState,
      propertyId: assets.propertyId,
      areaId: assets.areaId,
    })
    .from(assets)
    .innerJoin(properties, eq(properties.id, assets.propertyId))
    .where(isNull(assets.deletedAt))
    .orderBy(asc(assets.number))
  const standing = await tx
    .select({
      id: duties.id,
      assetId: duties.assetId,
      kind: duties.kind,
      label: duties.label,
      counting: duties.counting,
      intervalDays: duties.intervalDays,
      intervalMonths: duties.intervalMonths,
    })
    .from(duties)
    .where(
      and(
        isNull(duties.deletedAt),
        isNotNull(duties.assetId),
        or(isNull(duties.endsOn), gt(duties.endsOn, today)),
      ),
    )
  const voided = new Set(
    (await tx.select({ evidenceId: evidenceVoidings.evidenceId }).from(evidenceVoidings)).map(
      (row) => row.evidenceId as string,
    ),
  )
  const days = new Map<string, IsoDate[]>()

  for (const row of standingEvidence(
    await tx
      .select({
        id: evidence.id,
        replacesEvidenceId: evidence.replacesEvidenceId,
        dutyId: evidence.dutyId,
        performedOn: evidence.performedOn,
      })
      .from(evidence),
    voided,
  )) {
    days.set(row.dutyId, [...(days.get(row.dutyId) ?? []), row.performedOn])
  }

  const takenOver = await tx
    .select({ assetId: attachments.assetId, fileName: attachmentVersions.fileName })
    .from(attachments)
    .innerJoin(
      attachmentVersions,
      and(
        eq(attachmentVersions.tenantId, attachments.tenantId),
        eq(attachmentVersions.attachmentId, attachments.id),
      ),
    )
    .where(
      and(
        eq(attachments.legacy, true),
        isNull(attachments.deletedAt),
        isNotNull(attachments.assetId),
      ),
    )

  return {
    stock: {
      assets: seen.map(({ id, number, name, mark, serialNumber, kind, federalState }) => ({
        id,
        number,
        name,
        mark,
        serialNumber,
        kind,
        federalState,
      })),
      duties: standing.map((duty) => ({
        ...duty,
        assetId: duty.assetId as string,
        evidenceDays: days.get(duty.id) ?? [],
      })),
      takenOver: takenOver.map((each) => ({
        assetId: each.assetId as string,
        fileName: each.fileName,
      })),
      files,
      catalogue,
      today,
    },
    places: new Map(
      seen.map(({ id, propertyId, areaId }) => [id as string, { propertyId, areaId }]),
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
