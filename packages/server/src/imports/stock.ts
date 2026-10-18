import {
  type AssetImportStock,
  type Catalogue,
  type DeadlineImportStock,
  type DuplicateField,
  type ImportKind,
  type IsoDate,
  keyDayOf,
  type MeterImportStock,
  standingEvidence,
  type StructureStock,
  type TableRecord,
  type TemplateImportStock,
  type TenantId,
  validReadings,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm'

import { duplicateCandidatesOfList } from '../database/asset-duplicates.js'
import { operatorKeyDay } from '../database/meter-standing.js'
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
  meterExchanges,
  meterPauses,
  meterPoints,
  meterReadings,
  properties,
  rooms,
  roundTemplates,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { tenantCatalogue } from '../own-kinds/catalogue.js'

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
      .select({
        id: buildings.id,
        propertyId: buildings.propertyId,
        name: buildings.name,
        areaId: buildings.areaId,
      })
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
  shipped: Catalogue,
  records: readonly TableRecord[],
): Promise<AssetImportStock> {
  // The kinds of the operator's own as well (#62).
  const catalogue = await tenantCatalogue(tx, shipped)
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

/** Rows by the asset they hang at. */
function byAsset<Row extends { readonly assetId: string }>(
  rows: readonly Row[],
): Map<string, Row[]> {
  const found = new Map<string, Row[]>()

  for (const row of rows) {
    found.set(row.assetId, [...(found.get(row.assetId) ?? []), row])
  }

  return found
}

/**
 * What a list of the history of meters is held against (#130): the assets
 * the person importing sees, and for each measuring point among them the
 * readings that count, the replacements of its meter, the periods it rests
 * and the day of the month its readings are due on. Read inside their
 * transaction, under the policies of their tenant and their areas: a line
 * can name no asset beyond them.
 *
 * Every asset is in it, a measuring point or not, so that a line that names
 * a pump is told it names no meter rather than nothing at all. Read once for
 * the whole table; the places of the assets come back beside it, for what
 * the take-over writes.
 */
export async function meterImportStock(
  tx: TenantTransaction,
  today: IsoDate,
): Promise<{ stock: MeterImportStock; places: ReadonlyMap<string, AssetPlace> }> {
  const seen = await tx
    .select({
      id: assets.id,
      number: assets.number,
      name: assets.name,
      mark: assets.mark,
      serialNumber: assets.serialNumber,
      meterNumber: assets.meterNumber,
      meterUnit: assets.meterUnit,
      propertyId: assets.propertyId,
      areaId: assets.areaId,
    })
    .from(assets)
    .where(isNull(assets.deletedAt))
    .orderBy(asc(assets.number))
  const operatorDay = await operatorKeyDay(tx)
  const points = new Map(
    (
      await tx
        .select({
          assetId: meterPoints.assetId,
          keyDay: meterPoints.keyDay,
          conversionFactor: meterPoints.conversionFactor,
        })
        .from(meterPoints)
        .where(isNull(meterPoints.deletedAt))
    ).map((point) => [point.assetId as string, point]),
  )
  const readings = byAsset(
    validReadings(
      await tx
        .select({
          id: meterReadings.id,
          assetId: meterReadings.assetId,
          keyDate: meterReadings.keyDate,
          readOn: meterReadings.readOn,
          valueMilli: meterReadings.valueMilli,
          correctsId: meterReadings.correctsId,
        })
        .from(meterReadings)
        .where(isNull(meterReadings.deletedAt)),
    ),
  )
  const exchanges = byAsset(
    await tx
      .select({
        assetId: meterExchanges.assetId,
        exchangedOn: meterExchanges.exchangedOn,
        oldNumber: meterExchanges.oldNumber,
        oldEndMilli: meterExchanges.oldEndMilli,
        newNumber: meterExchanges.newNumber,
        newStartMilli: meterExchanges.newStartMilli,
      })
      .from(meterExchanges)
      .where(isNull(meterExchanges.deletedAt)),
  )
  const pauses = byAsset(
    await tx
      .select({
        assetId: meterPauses.assetId,
        startsOn: meterPauses.startsOn,
        endsOn: meterPauses.endsOn,
      })
      .from(meterPauses)
      .where(isNull(meterPauses.deletedAt)),
  )

  return {
    stock: {
      meters: seen.map(({ id, number, name, mark, serialNumber, meterNumber, meterUnit }) => {
        const point = points.get(id) ?? null

        return {
          id,
          number,
          name,
          mark,
          serialNumber,
          meterNumber,
          // A measuring point without a unit is none the forms make; its figures are read as the page writes them.
          unit: meterUnit ?? 'cubic_metres',
          keyDay: keyDayOf(point, { keyDay: operatorDay }),
          conversionFactor: point?.conversionFactor ?? null,
          readings: readings.get(id) ?? [],
          exchanges: exchanges.get(id) ?? [],
          pauses: pauses.get(id) ?? [],
        }
      }),
      today,
    },
    places: new Map(
      seen.map(({ id, propertyId, areaId }) => [id as string, { propertyId, areaId }]),
    ),
  }
}

/**
 * What a list of templates of rounds is held against (#130): the titles of
 * the templates the operator has. A template belongs to the operator and to
 * no area, so every one of them is in it.
 */
export async function templateImportStock(tx: TenantTransaction): Promise<TemplateImportStock> {
  return {
    templates: await tx
      .select({ title: roundTemplates.title })
      .from(roundTemplates)
      .where(isNull(roundTemplates.deletedAt)),
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
