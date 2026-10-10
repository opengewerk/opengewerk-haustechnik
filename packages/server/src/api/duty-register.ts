import { BadRequestException } from '@nestjs/common'
import {
  type AreaId,
  type BuildingId,
  type Catalogue,
  type Duty,
  type DutyAsset,
  type DutyEntry,
  dutyHasEnded,
  type DutyReading,
  type DutyRegister,
  type DutyRegisterFilter,
  dutyRegisterOrder,
  dutyRegisterPage,
  type DutyDueWindow,
  dutyDueWindows,
  type DutyRegisterState,
  dutyRegisterStates,
  endedDuties,
  inDueWindow,
  inRegisterOrder,
  type IsoDate,
  namesAPerson,
  type PropertyId,
  withoutResponsible,
} from '@opengewerk/haustechnik-domain'
import { isUuid, type TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'

import { dutiesOnADay, dutyTitle, type RegisteredDuty } from '../database/duty-standing.js'
import { assets, duties, rooms } from '../database/schema/index.js'
import { counted, said } from './register-question.js'

/**
 * The register of duties (section 4.3 of the concept): what an address asks
 * for, and the page of it the person asking sees.
 *
 * Narrowed and cut into pages here and not in the browser, like the register
 * of assets. What a duty hangs on narrows in the database. Its state is
 * derived (ADR 0002, point 16) and so narrows after the records are read: no
 * column holds it, and none is to. The state of each row is the one
 * `dutiesOnADay` works out, on the day the page is asked for.
 */

/** What a page of the register is asked with. */
export interface DutyRegisterQuestion {
  readonly filter: DutyRegisterFilter
  readonly offset: number
  readonly limit: number
}

/**
 * What an address asks the register for. A state is one of those there are,
 * and a page begins at a whole number and holds no more than the most a page
 * may; anything else is refused rather than read as "everything".
 */
export function dutyRegisterQuestion(
  query: Readonly<Record<string, unknown>>,
): DutyRegisterQuestion {
  const state = said(query, 'state')

  if (state !== undefined && !(dutyRegisterStates as readonly string[]).includes(state)) {
    throw new BadRequestException('Diesen Zustand kennt das Pflichtenverzeichnis nicht.')
  }

  const due = said(query, 'due')

  if (due !== undefined && !(dutyDueWindows as readonly string[]).includes(due)) {
    throw new BadRequestException(`„Fällig“ ist eines von: ${dutyDueWindows.join(', ')}.`)
  }

  const plain = (
    ['propertyId', 'areaId', 'buildingId', 'assetKind', 'dutyKind', 'responsible'] as const
  )
    .map((name) => [name, said(query, name)] as const)
    .filter(([, value]) => value !== undefined)

  return {
    filter: {
      ...(state === undefined ? {} : { state: state as DutyRegisterState }),
      ...(due === undefined ? {} : { due: due as DutyDueWindow }),
      ...(Object.fromEntries(plain) as DutyRegisterFilter),
    },
    offset: counted(
      said(query, 'offset'),
      0,
      { least: 0, most: Number.MAX_SAFE_INTEGER },
      'Eine Seite beginnt bei einer ganzen Zahl ab 0.',
    ),
    limit: counted(
      said(query, 'limit'),
      dutyRegisterPage.size,
      { least: 1, most: dutyRegisterPage.most },
      `Eine Seite hält zwischen 1 und ${dutyRegisterPage.most} Pflichten.`,
    ),
  }
}

/** A duty with how it stands today, as the file of an asset and the page of a room read it. */
export function dutyReading(
  { duty, standing, lastMetOn, lastEvidence }: RegisteredDuty,
  catalogue: Catalogue,
): DutyReading {
  return {
    id: duty.id,
    kind: duty.kind,
    kindVersion: duty.kindVersion,
    label: duty.label,
    basis: duty.basis,
    sourceNote: duty.sourceNote,
    task: duty.task,
    counting: duty.counting,
    intervalDays: duty.intervalDays,
    intervalMonths: duty.intervalMonths,
    endsOn: duty.endsOn,
    title: dutyTitle(duty, catalogue),
    state: standing.state,
    appointment: standing.appointment,
    lastMetOn,
    lastEvidence,
  }
}

/** A row of the register before anybody is named: the person is an id until the instance is asked. */
export type UnnamedDutyEntry = Omit<DutyEntry, 'responsible'>

/** A duty as a row of the register, on a day. */
export function dutyEntry(
  registered: RegisteredDuty,
  asset: DutyAsset | null,
  catalogue: Catalogue,
  today: IsoDate,
): UnnamedDutyEntry {
  const { duty } = registered

  return {
    ...dutyReading(registered, catalogue),
    propertyId: duty.propertyId,
    buildingId: duty.buildingId,
    roomId: duty.roomId,
    assetId: duty.assetId,
    intervalReason: duty.intervalReason,
    responsibleUserId: duty.responsibleUserId,
    performer: duty.performer,
    performerNote: duty.performerNote,
    ended: dutyHasEnded(duty, today),
    asset,
  }
}

/** A page of the register as the database answers it, with the people it names still as ids. */
export interface UnnamedDutyRegister extends Omit<DutyRegister, 'duties' | 'people'> {
  readonly duties: readonly UnnamedDutyEntry[]
  /** Everybody a duty the person asking sees answers for. */
  readonly people: readonly string[]
}

/** What a duty hangs on where that is no asset, as one key: a room, a building or the property. */
function placeKey(entry: UnnamedDutyEntry): string {
  return entry.roomId !== null
    ? `r:${entry.roomId}`
    : entry.buildingId !== null
      ? `b:${entry.buildingId}`
      : `p:${entry.propertyId}`
}

/** What narrows the register in the database: where a duty is and what kind it is. */
export type DutyPlaceFilter = Pick<
  DutyRegisterFilter,
  'propertyId' | 'areaId' | 'buildingId' | 'assetKind' | 'dutyKind'
>

/**
 * Every duty the transaction sees that is where the filter says and of the
 * kind it says, as a row of the register with how it stands on a day, in no
 * order. Null where the filter names a place by something that is no id: it
 * names nothing the person could see.
 *
 * The transaction is the person's, so the rows are the duties of their
 * areas and no other, whatever the filter names.
 */
export async function registeredEntries(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  filter: DutyPlaceFilter,
): Promise<UnnamedDutyEntry[] | null> {
  if (
    [filter.propertyId, filter.areaId, filter.buildingId].some(
      (id) => id !== undefined && !isUuid(id),
    )
  ) {
    return null
  }

  const building = filter.buildingId as BuildingId | undefined
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
    })
    .from(duties)
    .leftJoin(assets, eq(assets.id, duties.assetId))
    .leftJoin(rooms, eq(rooms.id, duties.roomId))
    .where(
      and(
        isNull(duties.deletedAt),
        filter.propertyId === undefined
          ? undefined
          : eq(duties.propertyId, filter.propertyId as PropertyId),
        filter.areaId === undefined ? undefined : eq(duties.areaId, filter.areaId as AreaId),
        // A building holds the duties at itself, at its rooms and at the assets in it.
        building === undefined
          ? undefined
          : or(
              eq(duties.buildingId, building),
              eq(assets.buildingId, building),
              eq(rooms.buildingId, building),
            ),
        filter.assetKind === undefined ? undefined : eq(assets.kind, filter.assetKind),
        filter.dutyKind === undefined ? undefined : eq(duties.kind, filter.dutyKind),
      ),
    )

  const assetOf = new Map(rows.map((row) => [row.duty.id as string, row.asset]))

  return (
    await dutiesOnADay(
      tx,
      today,
      rows.map((row) => row.duty as Duty),
    )
  ).map((registered) =>
    dutyEntry(
      registered,
      (assetOf.get(registered.duty.id) ?? null) as DutyAsset | null,
      catalogue,
      today,
    ),
  )
}

/**
 * A page of the register out of the rows `registeredEntries` read: the
 * duties that pass the rest of the filter, in the order of the register, and
 * how many there are behind the page.
 *
 * The window of days narrows like a place: the counts of the states and of
 * the duties nobody answers for are those within it. Without a state the
 * page holds the duties that have not ended; the ones that have are a list
 * of their own, the newest end first. The counts say how many there are of
 * each, whatever state the page is narrowed to.
 *
 * Narrowed to one person, the page comes without a number (`namesAPerson`):
 * neither how many duties that person answers for nor how many of them are
 * overdue is counted anywhere.
 */
export function registerPage(
  seen: readonly UnnamedDutyEntry[],
  filter: DutyRegisterFilter,
  today: IsoDate,
  offset: number,
  limit: number,
): Omit<UnnamedDutyRegister, 'people'> {
  const inWindow = seen.filter(
    (entry) => filter.due === undefined || inDueWindow(entry, filter.due, today),
  )
  const ofThePerson = inWindow.filter(
    (entry) =>
      filter.responsible === undefined ||
      (filter.responsible === withoutResponsible
        ? entry.responsibleUserId === null
        : entry.responsibleUserId === filter.responsible),
  )
  const passing =
    filter.state === endedDuties
      ? ofThePerson
          .filter((entry) => entry.ended)
          // The newest end first: what ended last is what somebody looks for.
          .sort(
            (left, right) =>
              (right.endsOn ?? '').localeCompare(left.endsOn ?? '') || inRegisterOrder(left, right),
          )
      : ofThePerson
          .filter((entry) => !entry.ended)
          .filter((entry) => filter.state === undefined || entry.state === filter.state)
          .sort(inRegisterOrder)
  const page = passing.slice(offset, offset + limit)
  const atAssets = passing.filter((entry) => entry.assetId !== null)
  const numbers = namesAPerson(filter)
    ? { total: null, assets: null, places: null, counts: null }
    : {
        total: passing.length,
        assets: new Set(atAssets.map((entry) => entry.assetId)).size,
        places: new Set(passing.filter((entry) => entry.assetId === null).map(placeKey)).size,
        counts: countsOf(ofThePerson),
      }

  return {
    ...numbers,
    withoutResponsible: inWindow.filter((entry) => !entry.ended && entry.responsibleUserId === null)
      .length,
    more: offset + page.length < passing.length,
    duties: page,
  }
}

/**
 * A page of the register on a day: the duties that pass every filter, in the
 * order of the register, each with how it stands on that day, and how many
 * there are behind the page (`registerPage`).
 *
 * The transaction is the person's, so the register holds the duties of their
 * areas and no other, whatever the address names.
 */
export async function dutyRegister(
  tx: TenantTransaction,
  catalogue: Catalogue,
  today: IsoDate,
  question: DutyRegisterQuestion,
): Promise<UnnamedDutyRegister> {
  const { filter } = question
  const seen = await registeredEntries(tx, catalogue, today, filter)

  return {
    ...registerPage(seen ?? [], filter, today, question.offset, question.limit),
    people: await peopleNamed(tx),
  }
}

/** How many duties there are of each state, and how many have ended. */
function countsOf(entries: readonly UnnamedDutyEntry[]): Record<DutyRegisterState, number> {
  const running = entries.filter((entry) => !entry.ended)

  return {
    ...(Object.fromEntries(
      dutyRegisterOrder.map((state) => [
        state,
        running.filter((entry) => entry.state === state).length,
      ]),
    ) as Record<(typeof dutyRegisterOrder)[number], number>),
    ended: entries.length - running.length,
  }
}

/** Everybody a duty the transaction sees names as the one who answers for it. */
async function peopleNamed(tx: TenantTransaction): Promise<string[]> {
  const named = await tx
    .selectDistinct({ userId: duties.responsibleUserId })
    .from(duties)
    .where(and(isNull(duties.deletedAt), isNotNull(duties.responsibleUserId)))

  return named.flatMap((row) => (row.userId === null ? [] : [row.userId]))
}
