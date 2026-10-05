import { BadRequestException } from '@nestjs/common'
import {
  type AssetDuplicate,
  type AssetId,
  assetLimits,
  type DuplicateField,
  duplicateFields,
  duplicateKey,
  possibleDuplicates,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, isNotNull, isNull, or } from 'drizzle-orm'

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

/**
 * The assets that may be the one asked about, those sharing both fields
 * first, then by number. Only assets the person asking sees: the database
 * answers with their areas, as everywhere.
 */
export async function assetDuplicates(
  tx: TenantTransaction,
  question: DuplicateQuestion,
): Promise<AssetDuplicate[]> {
  const asked = duplicateFields.filter((field) => duplicateKey(question[field]) !== null)

  if (asked.length === 0) {
    return []
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

  return possibleDuplicates(
    { id: question.except, serialNumber: question.serialNumber, mark: question.mark },
    known,
  ).map(({ asset, same }) => ({ ...asset, same }) as AssetDuplicate)
}
