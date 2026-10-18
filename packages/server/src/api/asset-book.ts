import {
  addressWords,
  type Asset,
  assetBookColumns,
  type AssetBookHead,
  type AssetBookLine,
  assetBookLines,
  assetBookRows,
  assetBookTitle,
  assetFieldValueWords,
  type Catalogue,
  dayInWords,
  evidenceStandingOf,
  isAllowed,
  type IsoDate,
  placeWords,
  readEvidenceState,
} from '@opengewerk/haustechnik-domain'
import type { OutgoingTable, TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { dutyTitle } from '../database/duty-standing.js'
import {
  assetLifecycle,
  buildings,
  duties,
  evidence,
  evidenceVoidings,
  properties,
  rooms,
} from '../database/schema/index.js'
import { keeperOf } from '../labels/faces.js'
import { tenantCatalogue } from '../own-kinds/catalogue.js'
import type { Asking } from './places.js'

/** The book of an asset: its head and its lines in the order of time. */
export interface AssetBook {
  readonly head: AssetBookHead
  readonly lines: readonly AssetBookLine[]
}

/** Where the asset stands in words, and the address of its property. */
async function whereOf(
  tx: TenantTransaction,
  asset: Asset,
): Promise<{ readonly place: string; readonly address: string | null }> {
  const [property] = await tx
    .select({
      name: properties.name,
      street: properties.street,
      postalCode: properties.postalCode,
      city: properties.city,
    })
    .from(properties)
    .where(eq(properties.id, asset.propertyId))
  const [building] = await tx
    .select({ name: buildings.name })
    .from(buildings)
    .where(eq(buildings.id, asset.buildingId))
  const [room] =
    asset.roomId === null
      ? []
      : await tx
          .select({ number: rooms.number, name: rooms.name })
          .from(rooms)
          .where(eq(rooms.id, asset.roomId))

  return {
    place: placeWords([
      property?.name,
      building?.name,
      room === undefined ? null : [room.number, room.name].filter(Boolean).join(' '),
    ]),
    address: property === undefined ? null : addressWords(property),
  }
}

/**
 * The book of an asset (#437, section 8 of the concept), read as the person
 * asking: the life cycle and the evidence of every duty that hangs on the
 * asset, also of one that ended, each from its frozen state. Its place stands
 * in the head only for whoever reads places, as every list of the office
 * names one (#237). The evidence of its components stands in their books.
 */
export async function assetBookOf(
  tx: TenantTransaction,
  identity: Asking,
  base: Catalogue,
  asset: Asset,
  today: IsoDate,
): Promise<AssetBook> {
  const catalogue = await tenantCatalogue(tx, base)
  const kind = catalogue.assetKind(asset.kind, today)?.definition
  const lifecycle = await tx
    .select({ state: assetLifecycle.state, validFrom: assetLifecycle.validFrom })
    .from(assetLifecycle)
    .where(and(eq(assetLifecycle.assetId, asset.id), isNull(assetLifecycle.deletedAt)))
    .orderBy(asc(assetLifecycle.validFrom))
  const its = await tx
    .select({
      id: duties.id,
      kind: duties.kind,
      kindVersion: duties.kindVersion,
      label: duties.label,
    })
    .from(duties)
    .where(eq(duties.assetId, asset.id))
  const titles = new Map(its.map((duty) => [duty.id as string, dutyTitle(duty, base)]))
  const written =
    its.length === 0
      ? []
      : await tx
          .select({
            id: evidence.id,
            dutyId: evidence.dutyId,
            number: evidence.number,
            performedOn: evidence.performedOn,
            result: evidence.result,
            replacesEvidenceId: evidence.replacesEvidenceId,
            state: evidence.state,
            emptiedAt: evidence.emptiedAt,
          })
          .from(evidence)
          .where(
            inArray(
              evidence.dutyId,
              its.map((duty) => duty.id),
            ),
          )
  const voidings =
    written.length === 0
      ? []
      : await tx
          .select({ evidenceId: evidenceVoidings.evidenceId, reason: evidenceVoidings.reason })
          .from(evidenceVoidings)
          .where(
            inArray(
              evidenceVoidings.evidenceId,
              written.map((row) => row.id),
            ),
          )
  const voidedFor = new Map(voidings.map((row) => [row.evidenceId as string, row.reason]))
  const standing = evidenceStandingOf(written, new Set(voidedFor.keys()))
  const lines = assetBookLines(
    lifecycle,
    written.map((row) => ({
      id: row.id,
      number: row.number,
      performedOn: row.performedOn,
      result: row.result,
      duty: titles.get(row.dutyId as string) ?? 'Pflicht',
      standing: standing(row),
      voidedFor: voidedFor.get(row.id as string) ?? null,
      // An emptied evidence keeps its number, day and result, and no state (#340).
      state: row.emptiedAt === null ? readEvidenceState(row.state) : null,
    })),
    (key) => catalogue.defectClass(key)?.defectClass.label ?? null,
  )
  const where = isAllowed(identity, 'location.read') ? await whereOf(tx, asset) : null

  return {
    head: {
      ...assetBookTitle(kind?.book),
      today,
      operator: await keeperOf(tx),
      asset: [asset.number, asset.name].filter(Boolean).join(' '),
      kind: kind?.label ?? asset.kind,
      place: where?.place ?? null,
      address: where?.address ?? null,
      commissionedOn: asset.commissionedOn,
      fields: (kind?.fields ?? []).flatMap((field) => {
        const value = asset.values[field.key]

        return value === undefined || value === ''
          ? []
          : [
              {
                label: field.label,
                value: assetFieldValueWords(field, value, (day) => dayInWords(day as IsoDate)),
              },
            ]
      }),
    },
    lines,
  }
}

/** The book as a table (#437): a row per entry, under the name the book has. */
export function assetBookTable(book: AssetBook): OutgoingTable {
  return {
    name: book.head.title,
    columns: assetBookColumns,
    rows: assetBookRows(book.lines),
  }
}
