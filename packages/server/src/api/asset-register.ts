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
  inCostGroup,
  type IsoDate,
  type LifecycleState,
  lifecycleStates,
  type PropertyId,
  withoutLifecycle,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { assetsOnADay } from '../database/duty-standing.js'
import { assets } from '../database/schema/index.js'

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

/** A part of the address as text, and nothing for one that is empty or said twice. */
function said(query: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = query[name]

  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A whole number of the address within its bounds, or the refusal. */
function counted(
  value: string | undefined,
  fallback: number,
  bounds: { readonly least: number; readonly most: number },
  refusal: string,
): number {
  if (value === undefined) {
    return fallback
  }

  const number = Number(value)

  if (!/^\d+$/.test(value) || number < bounds.least || number > bounds.most) {
    throw new BadRequestException(refusal)
  }

  return number
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
  const { filter } = question
  const nothing: AssetRegister = { total: 0, properties: 0, assets: [] }

  // An id that is no id names nothing the person could see.
  if ([filter.propertyId, filter.buildingId].some((id) => id !== undefined && !isUuid(id))) {
    return nothing
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
    return nothing
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

  const onThisDay = await assetsOnADay(tx, today)
  const passing = (rows as Omit<AssetEntry, 'lifecycleState' | 'condition' | 'until'>[])
    .map((row): AssetEntry => {
      const { lifecycleState, condition, until } = onThisDay(row.id)

      return { ...row, lifecycleState, condition, until }
    })
    .filter((entry) => filter.condition === undefined || entry.condition === filter.condition)
    .filter(
      (entry) =>
        filter.lifecycle === undefined ||
        (filter.lifecycle === withoutLifecycle
          ? entry.lifecycleState === null
          : entry.lifecycleState === filter.lifecycle),
    )

  return {
    total: passing.length,
    properties: new Set(passing.map((entry) => entry.propertyId)).size,
    assets: passing.slice(question.offset, question.offset + question.limit),
  }
}
