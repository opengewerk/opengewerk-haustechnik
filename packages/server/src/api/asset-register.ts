import { BadRequestException } from '@nestjs/common'
import {
  type AssetCondition,
  assetConditions,
  type AssetEntry,
  type AssetRegister,
  type AssetRegisterFilter,
  assetRegisterPage,
  type BuildingId,
  type Catalogue,
  type DocumentFilter,
  documentFilters,
  type DocumentKind,
  inCostGroup,
  type IsoDate,
  lackingDocuments,
  lacksFor,
  type LifecycleState,
  lifecycleStates,
  type PropertyId,
  withoutLifecycle,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import { assetsOnADay } from '../database/duty-standing.js'
import { assets, attachments } from '../database/schema/index.js'
import { counted, said } from './register-question.js'
import { tenantCatalogue } from '../own-kinds/catalogue.js'

/**
 * The register of assets over every building (section 4.2 of the concept):
 * what an address asks for, and the page of it the person asking sees.
 *
 * The list is narrowed and cut into pages here and not in the browser, so
 * that a few thousand assets never lie there at once. The place and the kind
 * narrow in the database. The condition and the life cycle are derived
 * (ADR 0002, point 16) and so narrow after the records are read: no column
 * holds them, and none is to.
 */

/** What a page of the register is asked with. */
export interface RegisterQuestion {
  readonly filter: AssetRegisterFilter
  readonly offset: number
  readonly limit: number
}

/**
 * What an address asks the register for. A condition and a state of the life
 * cycle are one of those there are, and a page begins at a whole number and
 * holds no more than the most a page may; anything else is refused rather
 * than read as "everything".
 */
export function registerQuestion(query: Readonly<Record<string, unknown>>): RegisterQuestion {
  const condition = said(query, 'condition')
  const lifecycle = said(query, 'lifecycle')

  if (condition !== undefined && !(assetConditions as readonly string[]).includes(condition)) {
    throw new BadRequestException('Diesen Zustand kennt das Anlagenverzeichnis nicht.')
  }

  if (
    lifecycle !== undefined &&
    lifecycle !== withoutLifecycle &&
    !(lifecycleStates as readonly string[]).includes(lifecycle)
  ) {
    throw new BadRequestException('Diesen Zustand im Lebenszyklus gibt es nicht.')
  }

  const documents = said(query, 'documents')

  if (documents !== undefined && !(documentFilters as readonly string[]).includes(documents)) {
    throw new BadRequestException('Nach diesen Unterlagen filtert das Anlagenverzeichnis nicht.')
  }

  const propertyId = said(query, 'propertyId')
  const buildingId = said(query, 'buildingId')
  const costGroup = said(query, 'costGroup')
  const kind = said(query, 'kind')

  return {
    filter: {
      ...(propertyId === undefined ? {} : { propertyId }),
      ...(buildingId === undefined ? {} : { buildingId }),
      ...(costGroup === undefined ? {} : { costGroup }),
      ...(kind === undefined ? {} : { kind }),
      ...(condition === undefined ? {} : { condition: condition as AssetCondition }),
      ...(lifecycle === undefined
        ? {}
        : { lifecycle: lifecycle as LifecycleState | typeof withoutLifecycle }),
      ...(documents === undefined ? {} : { documents: documents as DocumentFilter }),
    },
    offset: counted(
      said(query, 'offset'),
      0,
      { least: 0, most: Number.MAX_SAFE_INTEGER },
      'Eine Seite beginnt bei einer ganzen Zahl ab 0.',
    ),
    limit: counted(
      said(query, 'limit'),
      assetRegisterPage.size,
      { least: 1, most: assetRegisterPage.most },
      `Eine Seite hält zwischen 1 und ${assetRegisterPage.most} Anlagen.`,
    ),
  }
}

/**
 * A page of the register on a day: the assets that pass every filter, in the
 * order of their numbers, each with the state of its life cycle and its
 * condition on that day, and how many there are behind the page.
 *
 * The transaction is the person's, so the register holds the assets of their
 * areas and no other, whatever the address names.
 */
export async function assetRegister(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  question: RegisterQuestion,
): Promise<AssetRegister> {
  const passing = await assetsPassing(tx, catalogue, today, question.filter)

  return {
    total: passing.length,
    properties: new Set(passing.map((entry) => entry.propertyId)).size,
    assets: passing.slice(question.offset, question.offset + question.limit),
  }
}

/**
 * Every asset of the register that passes the filter on a day, in the order
 * of their numbers, each with the state of its life cycle and its condition:
 * the whole list a page is cut from, and what its table holds (#138).
 *
 * The transaction is the person's, so these are the assets of their areas
 * and no other, whatever the filter names.
 */
export async function assetsPassing(
  tx: TenantTransaction,
  shipped: Catalogue,
  today: IsoDate,
  filter: AssetRegisterFilter,
): Promise<AssetEntry[]> {
  // The kinds of the operator's own as well (#62).
  const catalogue = await tenantCatalogue(tx, shipped)
  // An id that is no id names nothing the person could see.
  if ([filter.propertyId, filter.buildingId].some((id) => id !== undefined && !isUuid(id))) {
    return []
  }

  // The cost group is said by the kind, and the kinds are the catalogue's. A
  // group holds the groups below it: 460 the elevators of 461.
  const { costGroup } = filter
  const ofTheGroup =
    costGroup === undefined
      ? undefined
      : catalogue
          .assetKinds(today)
          .filter((kind) => inCostGroup(kind.definition.costGroup, costGroup))
          .map((kind) => kind.key)

  if (ofTheGroup?.length === 0) {
    return []
  }

  const rows = await tx
    .select({
      id: assets.id,
      propertyId: assets.propertyId,
      buildingId: assets.buildingId,
      roomId: assets.roomId,
      parentAssetId: assets.parentAssetId,
      kind: assets.kind,
      number: assets.number,
      name: assets.name,
    })
    .from(assets)
    .where(
      and(
        isNull(assets.deletedAt),
        filter.propertyId === undefined
          ? undefined
          : eq(assets.propertyId, filter.propertyId as PropertyId),
        filter.buildingId === undefined
          ? undefined
          : eq(assets.buildingId, filter.buildingId as BuildingId),
        filter.kind === undefined ? undefined : eq(assets.kind, filter.kind),
        ofTheGroup === undefined ? undefined : inArray(assets.kind, ofTheGroup),
      ),
    )
    .orderBy(asc(assets.number), asc(assets.name), asc(assets.id))

  const onThisDay = await assetsOnADay(tx, today, catalogue)
  const kindsAt = await documentKindsAtAssets(tx)

  return (
    rows as Omit<AssetEntry, 'lifecycleState' | 'condition' | 'until' | 'shutDown' | 'lacking'>[]
  )
    .map((row): AssetEntry => {
      const { lifecycleState, condition, until, shutDownBy } = onThisDay(row.id)
      const lacking = lackingDocuments(
        catalogue.assetKind(row.kind, today)?.definition ?? null,
        kindsAt.get(row.id) ?? [],
      ).map(({ key, label, demand }) => ({ key, label, demand }))

      return { ...row, lifecycleState, condition, until, shutDown: shutDownBy.length > 0, lacking }
    })
    .filter((entry) => filter.documents === undefined || lacksFor(filter.documents, entry.lacking))
    .filter((entry) => filter.condition === undefined || entry.condition === filter.condition)
    .filter(
      (entry) =>
        filter.lifecycle === undefined ||
        (filter.lifecycle === withoutLifecycle
          ? entry.lifecycleState === null
          : entry.lifecycleState === filter.lifecycle),
    )
}

/**
 * The kinds of the documents that hang on each asset itself and are not
 * removed (#347): what fulfils the documents its kind expects. A document at
 * the room or the building of an asset is not among them, and one without a
 * kind fulfils nothing. The transaction is the person's, so these are the
 * documents of their areas, as are the assets they hang on.
 */
async function documentKindsAtAssets(tx: TenantTransaction): Promise<Map<string, DocumentKind[]>> {
  const rows = await tx
    .selectDistinct({ assetId: attachments.assetId, kind: attachments.kind })
    .from(attachments)
    .where(
      and(
        isNull(attachments.deletedAt),
        isNotNull(attachments.assetId),
        isNotNull(attachments.kind),
      ),
    )
  const kinds = new Map<string, DocumentKind[]>()

  for (const { assetId, kind } of rows) {
    if (assetId !== null && kind !== null) {
      kinds.set(assetId, [...(kinds.get(assetId) ?? []), kind])
    }
  }

  return kinds
}
