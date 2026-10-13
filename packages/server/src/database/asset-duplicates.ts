import { BadRequestException } from '@nestjs/common'
import {
  type AssetDuplicate,
  type AssetDuplicates,
  type AssetId,
  assetLimits,
  type DuplicateField,
  duplicateFields,
  duplicateKey,
  possibleDuplicates,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, isNotNull, isNull, or, sql } from 'drizzle-orm'

import { assets } from './schema/index.js'

/**
 * The possible duplicates of an asset (section 4.2 of the concept), for the
 * route the form in the office asks, and for whatever else enters assets: the
 * import and the exchange with a device ask here as well.
 *
 * What a duplicate is, `domain` says, and it is asked here for every asset
 * that carries a serial number or a mark, rather than said a second time in
 * SQL: lowering a text and taking the spaces out of it is not the same in the
 * database as on a device, and an asset the database compares differently
 * would be a duplicate nobody is told about. Read are two short columns of
 * the assets of one tenant.
 */

/** What somebody asks with: a serial number, a mark or both, and the asset that is being changed. */
export interface DuplicateQuestion {
  readonly serialNumber: string | null
  readonly mark: string | null
  readonly except: AssetId | null
}

const limits = {
  serialNumber: assetLimits.serialNumber,
  mark: assetLimits.mark,
} as const satisfies Readonly<Record<DuplicateField, number>>

/**
 * What an address asks about duplicates, or the refusal: at least one of the
 * two fields, each no longer than an asset holds it, and for an asset that is
 * being changed its own id, so that it is not named as its own duplicate.
 */
export function duplicateQuestion(query: Readonly<Record<string, unknown>>): DuplicateQuestion {
  const said = (field: DuplicateField): string | null => {
    const value = query[field]

    if (value === undefined || value === '') {
      return null
    }

    if (typeof value !== 'string' || value.length > limits[field]) {
      throw new BadRequestException(
        'Gefragt wird mit einer Seriennummer und einem Kennzeichen, wie eine Anlage sie trägt.',
      )
    }

    return value
  }
  const except = query['except']

  if (except !== undefined && (typeof except !== 'string' || !isUuid(except))) {
    throw new BadRequestException('Die Anlage, die ausgenommen wird, steht als Kennung.')
  }

  const question = {
    serialNumber: said('serialNumber'),
    mark: said('mark'),
    except: (except ?? null) as AssetId | null,
  }

  if (duplicateFields.every((field) => duplicateKey(question[field]) === null)) {
    throw new BadRequestException(
      'Nach einer Dublette wird mit einer Seriennummer oder einem Kennzeichen gefragt.',
    )
  }

  return question
}

/** A row of `asset_duplicate_candidates`, as the rule of `domain` reads it. */
export interface DuplicateCandidateRow {
  readonly id: string
  readonly serialNumber: string | null
  readonly mark: string | null
}

/**
 * The assets of the tenant whose digits fit one of the serial numbers or one
 * of the marks asked, past the areas, through the one function that may look
 * there (`asset_duplicate_candidates`, ADR 0003, addenda on #99, #171 and
 * #255). What a duplicate is, `domain` says of what comes back.
 *
 * Asked with lists (#255): a table that is imported has up to ten thousand
 * lines, and asked line by line each question would read every asset again.
 * Each list goes as one parameter. A text with a zero byte in it is left
 * out: the database holds no such text, so no asset carries it.
 */
export async function duplicateCandidatesOfList(
  tx: TenantTransaction,
  asked: Readonly<Record<DuplicateField, readonly string[]>>,
): Promise<DuplicateCandidateRow[]> {
  const said = (field: DuplicateField) =>
    asked[field].filter((value) => duplicateKey(value) !== null && !value.includes('\u0000'))
  const serialNumbers = said('serialNumber')
  const marks = said('mark')

  if (serialNumbers.length === 0 && marks.length === 0) {
    return []
  }

  const { rows } = await tx.execute<{
    id: string
    serial_number: string | null
    mark: string | null
  }>(
    sql`select id, serial_number, mark
          from asset_duplicate_candidates(
            ${sql.param(serialNumbers)}::text[], ${sql.param(marks)}::text[])`,
  )

  return rows.map((row) => ({ id: row.id, serialNumber: row.serial_number, mark: row.mark }))
}

/**
 * The same for one asset: the question of the exchange with a device and of
 * the route of the office, asked with lists of one.
 */
export function duplicateCandidates(
  tx: TenantTransaction,
  asked: Readonly<Record<DuplicateField, unknown>>,
): Promise<DuplicateCandidateRow[]> {
  const said = (field: DuplicateField) => {
    const value = asked[field]

    return typeof value === 'string' ? [value] : []
  }

  return duplicateCandidatesOfList(tx, { serialNumber: said('serialNumber'), mark: said('mark') })
}

/**
 * The assets that may be the one asked about, those sharing both fields
 * first, then by number. Named are only assets the person asking sees: the
 * database answers with their areas, as everywhere.
 *
 * Found is one beyond their areas as well (ADR 0003, addendum on #171): two
 * people who enter the stock of two areas make the same asset twice as
 * easily as two in one. Of such an asset the answer says the field it
 * shares, which whoever asks typed, and nothing else: not which asset, not
 * where, not how many.
 *
 * Past the areas looks only whoever enters assets (`pastAreas`), which the
 * route decides by their right: the question is there for the form that makes
 * an asset, and the exchange with a device asks it under the same right.
 * Somebody who reads assets and no more is named what they see, as before.
 */
export async function assetDuplicates(
  tx: TenantTransaction,
  question: DuplicateQuestion,
  pastAreas: boolean,
): Promise<AssetDuplicates> {
  const asked = duplicateFields.filter((field) => duplicateKey(question[field]) !== null)

  if (asked.length === 0) {
    return { assets: [], elsewhere: [] }
  }

  const column = { serialNumber: assets.serialNumber, mark: assets.mark } as const
  const known = await tx
    .select({
      id: assets.id,
      number: assets.number,
      name: assets.name,
      kind: assets.kind,
      propertyId: assets.propertyId,
      buildingId: assets.buildingId,
      roomId: assets.roomId,
      serialNumber: assets.serialNumber,
      mark: assets.mark,
    })
    .from(assets)
    .where(and(isNull(assets.deletedAt), or(...asked.map((field) => isNotNull(column[field])))))
    .orderBy(asc(assets.number), asc(assets.name))

  const candidate = {
    id: question.except,
    serialNumber: question.serialNumber,
    mark: question.mark,
  }
  // Every asset the person sees that carries one of the two fields. What the
  // function finds beside them lies beyond their areas.
  const seen = new Set<string>(known.map((asset) => asset.id))
  const everywhere = pastAreas ? await duplicateCandidates(tx, question) : []
  const beyond = possibleDuplicates(candidate, everywhere).filter(
    ({ asset }) => !seen.has(asset.id),
  )

  return {
    assets: possibleDuplicates(candidate, known).map(
      ({ asset, same }) => ({ ...asset, same }) as AssetDuplicate,
    ),
    elsewhere: duplicateFields.filter((field) => beyond.some(({ same }) => same.includes(field))),
  }
}
