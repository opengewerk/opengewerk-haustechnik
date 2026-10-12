import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import {
  adoption,
  type AssetValue,
  type BuildingKind,
  type Catalogue,
  type Duty,
  type DutyAsset,
  dutyHasEnded,
  type DutyId,
  dutyLapseWords,
  dutyUpdate,
  type DutyUpdateEntry,
  type DutyUpdates,
  type FederalState,
  type IsoDate,
  keeping,
  type UpdatePlace,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import { dutyTitle } from '../database/duty-standing.js'
import { assets, buildings, duties, properties } from '../database/schema/index.js'

/**
 * What a new version of a package means for the duties that are confirmed
 * (section 2.3 of the concept, ADR 0005, point 10, #139): which of them the
 * catalogue of this server says something new about, and the two decisions,
 * taking the newest version over or leaving a duty as it is with a reason.
 *
 * Nothing is kept of the report itself: it is worked out on the day it is
 * read, from the duties and the catalogue. What is kept is the decision, on
 * the duty, and the log of changes says who made it.
 *
 * The transaction is the person's, so every duty read or written here is one
 * of their areas; a duty of another area is not there for them.
 */

/** A duty from the catalogue with what an update asks about it: its asset, and where it stands. */
interface SeenDuty {
  readonly duty: Duty
  readonly asset: DutyAsset | null
  readonly place: UpdatePlace
}

/** The duties from the catalogue that are not removed, these or every one, each with its place. */
async function seenDuties(tx: TenantTransaction, dutyIds?: readonly string[]): Promise<SeenDuty[]> {
  if (dutyIds?.length === 0) {
    return []
  }

  const rows = await tx
    .select({
      duty: duties,
      asset: {
        id: assets.id,
        number: assets.number,
        name: assets.name,
        kind: assets.kind,
        buildingId: assets.buildingId,
        roomId: assets.roomId,
      },
      values: assets.values,
      buildingKinds: buildings.kinds,
      federalState: properties.federalState,
    })
    .from(duties)
    .innerJoin(properties, eq(properties.id, duties.propertyId))
    .leftJoin(assets, eq(assets.id, duties.assetId))
    .leftJoin(buildings, eq(buildings.id, assets.buildingId))
    .where(
      and(
        isNull(duties.deletedAt),
        isNotNull(duties.kind),
        dutyIds === undefined ? undefined : inArray(duties.id, dutyIds as DutyId[]),
      ),
    )

  return rows.map((row) => {
    const asset = (row.asset ?? null) as DutyAsset | null
    const federalState = row.federalState as FederalState

    return {
      duty: row.duty as Duty,
      asset,
      place: {
        state: federalState,
        subject:
          asset === null
            ? null
            : {
                assetKind: asset.kind,
                values: (row.values ?? {}) as Readonly<Record<string, AssetValue>>,
                buildingKinds: (row.buildingKinds ?? []) as readonly BuildingKind[],
                federalState,
              },
      },
    }
  })
}

/** Where one duty stands, as an update asks: for the page of a duty. */
export async function updatePlaceOf(
  tx: TenantTransaction,
  duty: Duty,
): Promise<UpdatePlace | null> {
  const [seen] = await seenDuties(tx, [duty.id])

  return seen?.place ?? null
}

function byText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The duties the catalogue says something new about, in the areas of the
 * person asking: by kind, then by the number of the asset, so that the duties
 * of one kind stand together as the office decides on them.
 */
export async function dutyUpdates(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
): Promise<DutyUpdates> {
  const entries: DutyUpdateEntry[] = []

  for (const { duty, asset, place } of await seenDuties(tx)) {
    const update = dutyHasEnded(duty, today) ? null : dutyUpdate(catalogue, duty, place, today)

    if (update !== null && duty.kind !== null) {
      entries.push({
        id: duty.id,
        kind: duty.kind,
        title: dutyTitle(duty, catalogue),
        propertyId: duty.propertyId,
        asset,
        intervalDays: duty.intervalDays,
        intervalMonths: duty.intervalMonths,
        update,
      })
    }
  }

  return {
    entries: entries.sort(
      (left, right) =>
        byText(left.kind, right.kind) ||
        byText(left.asset?.number ?? '', right.asset?.number ?? '') ||
        byText(left.id, right.id),
    ),
  }
}

/** Taking the newest version over, or leaving the duties as they are with this reason. */
export type UpdateDecision = 'adopt' | { readonly keep: string }

/**
 * One decision for many duties at once (section 2.3: "Je betroffener Pflicht
 * übernimmt er die neue Fassung oder lässt die Pflicht, wie sie ist, mit
 * Begründung", in a batch for duties of a kind). One transaction: every duty
 * of the batch, or none where one of them is refused, and the refusal names
 * the duty.
 */
export async function decideUpdates(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  dutyIds: readonly string[],
  decision: UpdateDecision,
): Promise<Duty[]> {
  const missing = 'Eine Pflicht des Stapels gibt es nicht oder nicht mehr.'

  if (!dutyIds.every(isUuid)) {
    throw new NotFoundException(missing)
  }

  const seen = new Map(
    (await seenDuties(tx, dutyIds)).map((each) => [each.duty.id as string, each]),
  )
  const decided: Duty[] = []

  for (const id of dutyIds) {
    const found = seen.get(id)

    if (found === undefined) {
      throw new NotFoundException(missing)
    }

    const { duty, asset, place } = found
    const at = asset === null ? '' : ` an ${[asset.number, asset.name].filter(Boolean).join(' ')}`
    const named = `${dutyTitle(duty, catalogue)}${at}`

    if (dutyHasEnded(duty, today)) {
      throw new ConflictException(
        `${named}: Diese Pflicht ist beendet; eine beendete Pflicht ändert sich nicht mehr.`,
      )
    }

    const update = dutyUpdate(catalogue, duty, place, today)

    if (update === null) {
      throw new ConflictException(
        `${named}: Für diese Pflicht sagt der Katalog nichts Neues; es gibt nichts zu entscheiden.`,
      )
    }

    if (decision === 'adopt' && update.lapse !== null) {
      throw new ConflictException(
        `${named}: ${dutyLapseWords[update.lapse]} Übernommen wird sie deshalb nicht; die Pflicht bleibt, bis jemand sie beendet.`,
      )
    }

    const result =
      decision === 'adopt'
        ? adoption(catalogue, duty, place.state, today)
        : keeping(catalogue, duty, place, decision.keep, today)

    if ('problem' in result) {
      throw new BadRequestException(`${named}: ${result.problem}`)
    }

    const [written] = await tx
      .update(duties)
      .set(result.values)
      .where(and(eq(duties.id, duty.id), isNull(duties.deletedAt)))
      .returning()

    decided.push(written as Duty)
  }

  return decided
}
