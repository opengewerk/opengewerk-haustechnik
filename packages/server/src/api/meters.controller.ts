import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import {
  addMonths,
  type Asset,
  type AssetId,
  type Catalogue,
  consumptionByKeyDate,
  type IsoDate,
  isKeyDate,
  keyDateFor,
  keyDatesBetween,
  type MeterDetails,
  type MeterEntry,
  meterExchangeProblems,
  type MeterExchange,
  type MeterList,
  type MeterListState,
  meterListStates,
  type MeterMedium,
  meterMedia,
  type MeterPause,
  meterPauseProblems,
  type MeterPoint,
  meterPointProblems,
  type MeterReading,
  type MeterReadingLine,
  meterReadingProblems,
  meterRestsOn,
  type MeterRow,
  type MeterState,
  readingDoubt,
  validReadings,
} from '@opengewerk/haustechnik-domain'
import {
  accountsOf,
  CurrentIdentity,
  Database,
  isUuid,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import { CATALOGUE } from '../catalogue.js'
import {
  assets,
  meterExchanges,
  meterPauses,
  meterPoints,
  meterReadings,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { RequiresPermission } from './authorization.js'
import { type Asking, fieldsOf, refuse } from './places.js'
import { said } from './register-question.js'

const missing = 'Diese Messstelle gibt es nicht oder nicht mehr.'
const missingReading = 'Diesen Stand gibt es an dieser Messstelle nicht.'
const missingPause = 'Diese Stilllegung gibt es an dieser Messstelle nicht.'
const unknownAccount = 'Unbekanntes Konto'

/** The day as the screens write it, `01.10.2026`. */
function germanDay(day: IsoDate): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/** The key date of a month: its first day. The one of today is the current one. */
function keyDateOfMonth(day: IsoDate): IsoDate {
  return `${day.slice(0, 7)}-01` as IsoDate
}

/** What a measuring point holds, as the pages are worked out from it. */
interface Held {
  readonly asset: Asset
  readonly point: MeterPoint | null
  readonly readings: readonly MeterReading[]
  readonly exchanges: readonly MeterExchange[]
  readonly pauses: readonly MeterPause[]
}

/**
 * The meters in the office (section 4.9 of the concept, #119): the list
 * "Zähler" with the reading for a key date, the page of a measuring point
 * with its readings, its consumption and its history, a reading entered or
 * corrected by hand, the replacement of its meter, the periods it rests, its
 * lock, its note and what only a measuring point carries.
 *
 * A measuring point is an asset whose kind is a meter: it has a meter number
 * and a unit (#20). Reading is `asset.read`; entering a reading is
 * `reading.write`, which every role holds; the replacement, the pauses, the
 * lock, the note and the rest are `asset.write`, the care of the assets.
 *
 * A reading is never changed. A wrong one is corrected by a new one for the
 * same key date, which names it and the reason; from then on that one counts.
 * Consumption is worked out from the readings that count, every time, and
 * never kept.
 */
@Controller('meters')
export class MetersController {
  constructor(
    private readonly database: Database,
    @Inject(CATALOGUE) private readonly catalogue: Catalogue,
  ) {}

  /**
   * The measuring points the person asking sees, with their last reading and
   * how each stands for the key date asked (the current one unless one is
   * named), narrowed to a property, a medium and a state.
   */
  @Get()
  @RequiresPermission('asset.read')
  async list(
    @CurrentIdentity() identity: Asking,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<MeterList> {
    const today = dayInGermany()
    const keyDate = (said(query, 'keyDate') ?? keyDateOfMonth(today)) as IsoDate
    const state = (said(query, 'state') ?? 'all') as MeterListState
    const propertyId = said(query, 'property') ?? null
    const medium = said(query, 'medium') ?? null

    if (!isKeyDate(keyDate)) {
      throw new BadRequestException('Der Stichtag ist der erste Tag eines Monats.')
    }

    if (!(meterListStates as readonly string[]).includes(state)) {
      throw new BadRequestException(`Der Stand ist einer von: ${meterListStates.join(', ')}.`)
    }

    if (medium !== null && !(meterMedia as readonly string[]).includes(medium)) {
      throw new BadRequestException(`Das Medium ist eines von: ${meterMedia.join(', ')}.`)
    }

    if (propertyId !== null && !isUuid(propertyId)) {
      throw new BadRequestException('Diese Liegenschaft gibt es bei diesem Betreiber nicht.')
    }

    const held = await this.database.forTenant(identity, async (tx) => {
      const meters = await tx
        .select()
        .from(assets)
        .where(
          and(
            isNotNull(assets.meterNumber),
            isNull(assets.deletedAt),
            ...(propertyId === null ? [] : [eq(assets.propertyId, propertyId as never)]),
          ),
        )
        .orderBy(asc(assets.mark), asc(assets.name), asc(assets.id))

      return heldOf(tx, meters as Asset[])
    })
    const entries = held
      .map((each) => this.entryOf(each, keyDate, today))
      .filter((entry) => medium === null || entry.medium === medium)
    const counted = (wanted: MeterState) => entries.filter((entry) => entry.state === wanted).length

    return {
      keyDate,
      total: entries.length,
      properties: new Set(entries.map((entry) => entry.propertyId)).size,
      counts: { missing: counted('missing'), paused: counted('paused'), locked: counted('locked') },
      meters: state === 'all' ? entries : entries.filter((entry) => entry.state === state),
    }
  }

  /** The page of a measuring point. */
  @Get(':id')
  @RequiresPermission('asset.read')
  read(@CurrentIdentity() identity: Asking, @Param('id') id: string): Promise<MeterDetails> {
    return this.page(identity, id)
  }

  /**
   * A reading entered by hand, or the correction of one: for the key date
   * of the day it was read on, or of the reading it corrects. A measuring
   * point that is locked takes none; a key date has one reading that counts,
   * and a figure smaller than the reading before it or larger than the one
   * after it is refused with the reason, since a replaced meter is entered as
   * a replacement.
   */
  @Post(':id/readings')
  @RequiresPermission('reading.write')
  async addReading(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MeterDetails> {
    const values = fieldsOf(
      body,
      ['readOn', 'valueMilli', 'correctsId', 'correctionReason'],
      ['correctsId', 'correctionReason'],
    )

    refuse(
      meterReadingProblems({
        readOn: values.readOn ?? null,
        valueMilli: values.valueMilli ?? null,
        correctsId: values.correctsId ?? null,
        correctionReason: values.correctionReason ?? null,
      }),
    )

    const readOn = values.readOn as IsoDate
    const valueMilli = values.valueMilli as number
    const correctsId = (values.correctsId ?? null) as string | null

    if (readOn > dayInGermany()) {
      throw new BadRequestException('Abgelesen wird heute oder früher, nicht in der Zukunft.')
    }

    await this.database.forTenant(identity, async (tx) => {
      const held = await heldMeter(tx, id, true)
      const valid = validReadings(held.readings)
      const corrected =
        correctsId === null ? null : held.readings.find((reading) => reading.id === correctsId)

      if (correctsId !== null && corrected === undefined) {
        throw new NotFoundException(missingReading)
      }

      // A lock keeps anybody from the meter; a wrong figure read before it is
      // still corrected, which needs nobody at the meter.
      if (
        correctsId === null &&
        held.point?.lockReason !== null &&
        held.point?.lockReason !== undefined
      ) {
        throw new ConflictException(
          `Die Messstelle ist gesperrt: ${held.point.lockReason}. Abgelesen wird, wenn die Sperre aufgehoben ist.`,
        )
      }

      if (corrected !== null && corrected !== undefined && !valid.includes(corrected)) {
        throw new ConflictException(
          'Dieser Stand ist schon berichtigt. Berichtigt wird der, der gilt.',
        )
      }

      const keyDate = corrected?.keyDate ?? keyDateFor(readOn)

      if (corrected === null && valid.some((reading) => reading.keyDate === keyDate)) {
        throw new ConflictException(
          `Für den Stichtag ${germanDay(keyDate)} gibt es einen Stand. Ein falscher wird berichtigt.`,
        )
      }

      const doubt = readingDoubt(
        { keyDate, readOn, valueMilli },
        {
          readings: valid.filter((reading) => reading !== corrected),
          exchanges: held.exchanges,
          pauses: held.pauses,
          conversionFactor: held.point?.conversionFactor ?? null,
        },
        held.asset.meterUnit ?? 'cubic_metres',
      )

      if (doubt !== null) {
        throw new ConflictException(doubt)
      }

      await tx.insert(meterReadings).values({
        tenantId: identity.tenantId,
        propertyId: held.asset.propertyId,
        areaId: held.asset.areaId,
        assetId: held.asset.id,
        keyDate,
        readOn,
        valueMilli,
        source: 'by_hand',
        correctsId: (correctsId ?? null) as never,
        correctionReason: (values.correctionReason ?? null) as string | null,
        recordedBy: identity.userId,
      })
    })

    return this.page(identity, id)
  }

  /**
   * The replacement of the meter on a day: the last figure of the old one,
   * the number and the first figure of the new one. The measuring point
   * takes the new number; its readings and its history stay.
   */
  @Post(':id/exchanges')
  @RequiresPermission('asset.write')
  async exchange(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MeterDetails> {
    const values = fieldsOf(body, ['exchangedOn', 'oldEndMilli', 'newNumber', 'newStartMilli'])

    refuse(
      meterExchangeProblems({
        exchangedOn: values.exchangedOn ?? null,
        oldEndMilli: values.oldEndMilli ?? null,
        newNumber: values.newNumber ?? null,
        newStartMilli: values.newStartMilli ?? null,
      }),
    )

    const exchangedOn = values.exchangedOn as IsoDate
    const oldEndMilli = values.oldEndMilli as number
    const newNumber = values.newNumber as string

    if (exchangedOn > dayInGermany()) {
      throw new BadRequestException('Getauscht wird heute oder früher, nicht in der Zukunft.')
    }

    await this.database.forTenant(identity, async (tx) => {
      const held = await heldMeter(tx, id, true)
      const oldNumber = held.asset.meterNumber ?? ''
      const before = validReadings(held.readings)
        .filter((reading) => reading.readOn <= exchangedOn)
        .sort((left, right) => (left.readOn < right.readOn ? 1 : -1))[0]

      if (newNumber === oldNumber) {
        throw new BadRequestException('Der neue Zähler hat eine andere Nummer als der alte.')
      }

      if (held.exchanges.some((each) => each.exchangedOn === exchangedOn)) {
        throw new ConflictException(
          `Am ${germanDay(exchangedOn)} ist an dieser Messstelle schon ein Tausch eingetragen.`,
        )
      }

      if (before !== undefined && oldEndMilli < before.valueMilli) {
        throw new ConflictException(
          `Der Endstand ist kleiner als der letzte Stand des alten Zählers vom ${germanDay(before.keyDate)}.`,
        )
      }

      await tx.insert(meterExchanges).values({
        tenantId: identity.tenantId,
        propertyId: held.asset.propertyId,
        areaId: held.asset.areaId,
        assetId: held.asset.id,
        exchangedOn,
        oldNumber,
        oldEndMilli,
        newNumber,
        newStartMilli: values.newStartMilli as number,
      })
      await tx.update(assets).set({ meterNumber: newNumber }).where(eq(assets.id, held.asset.id))
    })

    return this.page(identity, id)
  }

  /** A period the measuring point rests, from a day and on request to a day, with the reason. */
  @Post(':id/pauses')
  @RequiresPermission('asset.write')
  async pause(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MeterDetails> {
    const values = fieldsOf(body, ['startsOn', 'endsOn', 'reason'], ['endsOn'])

    refuse(
      meterPauseProblems({
        startsOn: values.startsOn ?? null,
        endsOn: values.endsOn ?? null,
        reason: values.reason ?? null,
      }),
    )

    const startsOn = values.startsOn as IsoDate
    const endsOn = (values.endsOn ?? null) as IsoDate | null

    await this.database.forTenant(identity, async (tx) => {
      const held = await heldMeter(tx, id, false)

      if (held.pauses.some((each) => overlaps(each, { startsOn, endsOn }))) {
        throw new ConflictException('In dieser Zeit ruht die Messstelle schon.')
      }

      await tx.insert(meterPauses).values({
        tenantId: identity.tenantId,
        propertyId: held.asset.propertyId,
        areaId: held.asset.areaId,
        assetId: held.asset.id,
        startsOn,
        endsOn,
        reason: values.reason as string,
      })
    })

    return this.page(identity, id)
  }

  /** The end of a period the measuring point rests, which had none. */
  @Put(':id/pauses/:pauseId')
  @RequiresPermission('asset.write')
  async endPause(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Param('pauseId') pauseId: string,
    @Body() body: unknown,
  ): Promise<MeterDetails> {
    const values = fieldsOf(body, ['endsOn'])

    await this.database.forTenant(identity, async (tx) => {
      const held = await heldMeter(tx, id, false)
      const pause = held.pauses.find((each) => each.id === pauseId)

      if (pause === undefined) {
        throw new NotFoundException(missingPause)
      }

      if (pause.endsOn !== null) {
        throw new ConflictException('Diese Stilllegung hat schon ein Ende.')
      }

      refuse(
        meterPauseProblems({
          startsOn: pause.startsOn,
          endsOn: values.endsOn ?? null,
          reason: pause.reason,
        }),
      )

      if (typeof values.endsOn !== 'string') {
        throw new BadRequestException('Der letzte Tag fehlt.')
      }

      await tx
        .update(meterPauses)
        .set({ endsOn: values.endsOn })
        .where(eq(meterPauses.id, pause.id))
    })

    return this.page(identity, id)
  }

  /** The lock of the measuring point with its reason: it takes no reading until it is lifted. */
  @Put(':id/lock')
  @RequiresPermission('asset.write')
  async lock(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MeterDetails> {
    const values = fieldsOf(body, ['lockReason'])

    if (typeof values.lockReason !== 'string' || values.lockReason === '') {
      throw new BadRequestException('Eine Sperre nennt ihren Grund.')
    }

    refuse(meterPointProblems({ lockReason: values.lockReason }))

    await this.database.forTenant(identity, async (tx) => {
      const held = await heldMeter(tx, id, false)

      await this.pointOf(tx, identity, held, {
        lockReason: values.lockReason as string,
        lockedOn: dayInGermany(),
      })
    })

    return this.page(identity, id)
  }

  /** The lock lifted: the measuring point takes readings again. */
  @Delete(':id/lock')
  @RequiresPermission('asset.write')
  async unlock(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
  ): Promise<MeterDetails> {
    await this.database.forTenant(identity, async (tx) => {
      const held = await heldMeter(tx, id, false)

      if (held.point?.lockReason === null || held.point === null) {
        throw new ConflictException('Diese Messstelle ist nicht gesperrt.')
      }

      await this.pointOf(tx, identity, held, { lockReason: null, lockedOn: null })
    })

    return this.page(identity, id)
  }

  /** The note of the measuring point, written in the name of the person asking; none removes it. */
  @Put(':id/note')
  @RequiresPermission('asset.write')
  async note(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MeterDetails> {
    const values = fieldsOf(body, ['note'], ['note'])
    const note = (values.note ?? null) as string | null

    refuse(meterPointProblems({ note }))

    await this.database.forTenant(identity, async (tx) => {
      const held = await heldMeter(tx, id, false)

      await this.pointOf(
        tx,
        identity,
        held,
        note === null
          ? { note: null, noteBy: null, notedOn: null }
          : { note, noteBy: identity.userId, notedOn: dayInGermany() },
      )
    })

    return this.page(identity, id)
  }

  /**
   * What only the measuring point carries: its conversion factor, the main
   * meter it counts under, a measuring point of the same property and not
   * one that counts under it, and its id in the building management system.
   */
  @Put(':id')
  @RequiresPermission('asset.write')
  async change(
    @CurrentIdentity() identity: Asking,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MeterDetails> {
    const values = fieldsOf(
      body,
      ['conversionFactor', 'mainMeterId', 'controlId'],
      ['mainMeterId', 'controlId'],
    )

    refuse(meterPointProblems(values))

    await this.database.forTenant(identity, async (tx) => {
      const held = await heldMeter(tx, id, false)
      const mainMeterId = (values.mainMeterId ?? null) as AssetId | null

      if (mainMeterId !== null) {
        await mainMeterFor(tx, held.asset, mainMeterId)
      }

      await this.pointOf(tx, identity, held, {
        ...(values.conversionFactor === undefined
          ? {}
          : { conversionFactor: values.conversionFactor as number | null }),
        ...(values.mainMeterId === undefined ? {} : { mainMeterId }),
        ...(values.controlId === undefined ? {} : { controlId: values.controlId as string | null }),
      })
    })

    return this.page(identity, id)
  }

  /** The row of what the measuring point carries, made the first time something of it is said. */
  private async pointOf(
    tx: TenantTransaction,
    identity: Asking,
    held: Held,
    change: Partial<typeof meterPoints.$inferInsert>,
  ): Promise<void> {
    if (held.point === null) {
      await tx.insert(meterPoints).values({
        tenantId: identity.tenantId,
        propertyId: held.asset.propertyId,
        areaId: held.asset.areaId,
        assetId: held.asset.id,
        ...change,
      })

      return
    }

    await tx.update(meterPoints).set(change).where(eq(meterPoints.id, held.point.id))
  }

  /** The page of a measuring point, worked out from what it holds. */
  private async page(identity: Asking, id: string): Promise<MeterDetails> {
    const today = dayInGermany()
    const read = await this.database.forTenant(identity, async (tx) => {
      const held = await heldMeter(tx, id, false)
      const related = [held.point?.mainMeterId ?? null].filter((each) => each !== null)
      const main =
        related.length === 0
          ? []
          : await tx
              .select({ id: assets.id, mark: assets.mark, name: assets.name })
              .from(assets)
              .where(and(inArray(assets.id, related), isNull(assets.deletedAt)))
      const subs = await tx
        .select({ id: assets.id, mark: assets.mark, name: assets.name })
        .from(meterPoints)
        .innerJoin(assets, eq(assets.id, meterPoints.assetId))
        .where(and(eq(meterPoints.mainMeterId, held.asset.id), isNull(assets.deletedAt)))
        .orderBy(asc(assets.mark), asc(assets.name))

      return { held, main: main[0] ?? null, subs }
    })
    const { held } = read
    const accounts = await accountsOf(
      this.database,
      [
        ...new Set([
          ...held.readings.map((reading) => reading.recordedBy),
          ...(held.point?.noteBy ? [held.point.noteBy] : []),
        ]),
      ],
      identity.userId,
    )
    const nameOf = (userId: string) => accounts.get(userId)?.name ?? unknownAccount
    const current = keyDateOfMonth(today)
    const valid = validReadings(held.readings)
    const consumption = consumptionByKeyDate({
      readings: valid,
      exchanges: held.exchanges,
      pauses: held.pauses,
      conversionFactor: held.point?.conversionFactor ?? null,
    })
    const lineOf = (reading: MeterReading): MeterReadingLine => ({
      id: reading.id,
      keyDate: reading.keyDate,
      readOn: reading.readOn,
      valueMilli: reading.valueMilli,
      source: reading.source,
      name: nameOf(reading.recordedBy),
      correctsId: reading.correctsId,
      correctionReason: reading.correctionReason,
      valid: valid.includes(reading),
    })
    const first = [...held.readings].sort((left, right) =>
      left.keyDate < right.keyDate ? -1 : 1,
    )[0]?.keyDate
    const last = [...held.readings].sort((left, right) =>
      left.keyDate < right.keyDate ? 1 : -1,
    )[0]?.keyDate
    const until = last !== undefined && last > current ? last : current
    const rows: MeterRow[] =
      first === undefined
        ? [
            {
              keyDate: current,
              state: stateOn(held, current, today),
              reading: null,
              corrected: [],
              consumption: null,
            },
          ]
        : [...keyDatesBetween(first, until)].reverse().map((keyDate) => {
            const reading = valid.find((each) => each.keyDate === keyDate)

            return {
              keyDate,
              state: stateOn(held, keyDate, today),
              reading: reading === undefined ? null : lineOf(reading),
              corrected: held.readings
                .filter((each) => each.keyDate === keyDate && !valid.includes(each))
                .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
                .map(lineOf),
              consumption: consumption.get(keyDate) ?? null,
            }
          })
    const history = [...keyDatesBetween(addMonths(until, -23), until)].reverse().map((keyDate) => ({
      keyDate,
      consumption: consumption.get(keyDate) ?? null,
      previousYear: consumption.get(addMonths(keyDate, -12)) ?? null,
    }))
    const point = held.point

    return {
      ...this.entryOf(held, current, today),
      kind: held.asset.kind,
      currentKeyDate: current,
      conversionFactor: point?.conversionFactor ?? null,
      controlId: point?.controlId ?? null,
      mainMeter:
        read.main === null
          ? null
          : { assetId: read.main.id, mark: read.main.mark, name: read.main.name },
      subMeters: read.subs.map((each) => ({ assetId: each.id, mark: each.mark, name: each.name })),
      note:
        point?.note === null ||
        point?.note === undefined ||
        point.noteBy === null ||
        point.notedOn === null
          ? null
          : { text: point.note, name: nameOf(point.noteBy), on: point.notedOn },
      lock:
        point?.lockReason === null || point?.lockReason === undefined || point.lockedOn === null
          ? null
          : { reason: point.lockReason, on: point.lockedOn },
      pauses: [...held.pauses]
        .sort((left, right) => (left.startsOn < right.startsOn ? 1 : -1))
        .map(({ id: pauseId, startsOn, endsOn, reason }) => ({
          id: pauseId,
          startsOn,
          endsOn,
          reason,
        })),
      exchanges: [...held.exchanges]
        .sort((left, right) => (left.exchangedOn < right.exchangedOn ? 1 : -1))
        .map((exchange) => ({
          id: exchange.id,
          exchangedOn: exchange.exchangedOn,
          oldNumber: exchange.oldNumber,
          oldEndMilli: exchange.oldEndMilli,
          newNumber: exchange.newNumber,
          newStartMilli: exchange.newStartMilli,
        })),
      rows,
      history,
    }
  }

  /** A measuring point as the list shows it, for a key date. */
  private entryOf(held: Held, keyDate: IsoDate, today: IsoDate): MeterEntry {
    const { asset } = held
    const last = [...validReadings(held.readings)].sort((left, right) =>
      left.keyDate < right.keyDate ? 1 : -1,
    )[0]

    return {
      assetId: asset.id,
      propertyId: asset.propertyId,
      areaId: asset.areaId,
      buildingId: asset.buildingId,
      roomId: asset.roomId,
      number: asset.number,
      mark: asset.mark,
      name: asset.name,
      medium: this.mediumOf(asset.kind, today),
      unit: asset.meterUnit ?? 'cubic_metres',
      meterNumber: asset.meterNumber ?? '',
      mainMeterId: held.point?.mainMeterId ?? null,
      lastReading:
        last === undefined
          ? null
          : { keyDate: last.keyDate, readOn: last.readOn, valueMilli: last.valueMilli },
      state: stateOn(held, keyDate, today),
    }
  }

  private mediumOf(kind: string, on: IsoDate): MeterMedium | null {
    return this.catalogue.assetKind(kind, on)?.definition.meter?.medium ?? null
  }
}

/** How a measuring point stands for a key date. */
function stateOn(held: Held, keyDate: IsoDate, today: IsoDate): MeterState {
  if (held.point?.lockReason !== null && held.point?.lockReason !== undefined && keyDate <= today) {
    return 'locked'
  }

  if (meterRestsOn(held.pauses, keyDate)) {
    return 'paused'
  }

  return validReadings(held.readings).some((reading) => reading.keyDate === keyDate)
    ? 'present'
    : 'missing'
}

/** Whether two periods share a day; one without an end lasts. */
function overlaps(
  left: Pick<MeterPause, 'startsOn' | 'endsOn'>,
  right: Pick<MeterPause, 'startsOn' | 'endsOn'>,
): boolean {
  return (
    (left.endsOn === null || right.startsOn <= left.endsOn) &&
    (right.endsOn === null || left.startsOn <= right.endsOn)
  )
}

/**
 * The asset of a measuring point and what it holds, as the person asking
 * sees it: an asset with a meter, not marked, in their areas. Held, the
 * asset is read with the lock of a change, so that two readings for the
 * same key date at the same moment wait for each other.
 */
async function heldMeter(tx: TenantTransaction, id: string, lock: boolean): Promise<Held> {
  if (!isUuid(id)) {
    throw new NotFoundException(missing)
  }

  const query = tx
    .select()
    .from(assets)
    .where(
      and(eq(assets.id, id as AssetId), isNotNull(assets.meterNumber), isNull(assets.deletedAt)),
    )
  const [asset] = lock ? await query.for('no key update') : await query

  if (asset === undefined) {
    throw new NotFoundException(missing)
  }

  return (await heldOf(tx, [asset as Asset]))[0] as Held
}

/** What each of some measuring points holds, read at once. */
async function heldOf(tx: TenantTransaction, meters: readonly Asset[]): Promise<Held[]> {
  if (meters.length === 0) {
    return []
  }

  const ids = meters.map((meter) => meter.id)
  const points = await tx.select().from(meterPoints).where(inArray(meterPoints.assetId, ids))
  const readings = await tx
    .select()
    .from(meterReadings)
    .where(and(inArray(meterReadings.assetId, ids), isNull(meterReadings.deletedAt)))
  const exchanges = await tx
    .select()
    .from(meterExchanges)
    .where(and(inArray(meterExchanges.assetId, ids), isNull(meterExchanges.deletedAt)))
  const pauses = await tx
    .select()
    .from(meterPauses)
    .where(and(inArray(meterPauses.assetId, ids), isNull(meterPauses.deletedAt)))

  return meters.map((asset) => ({
    asset,
    point: (points.find((point) => point.assetId === asset.id) ?? null) as MeterPoint | null,
    readings: readings.filter((reading) => reading.assetId === asset.id) as MeterReading[],
    exchanges: exchanges.filter((exchange) => exchange.assetId === asset.id) as MeterExchange[],
    pauses: pauses.filter((pause) => pause.assetId === asset.id) as MeterPause[],
  }))
}

/**
 * The main meter a measuring point is to count under: a measuring point of
 * the same property, not the point itself and not one that counts under it,
 * at any depth.
 */
async function mainMeterFor(tx: TenantTransaction, meter: Asset, mainMeterId: AssetId) {
  const sentence =
    'Hauptzähler ist eine andere Messstelle derselben Liegenschaft, die nicht unter dieser zählt.'

  if (!isUuid(mainMeterId) || mainMeterId === meter.id) {
    throw new BadRequestException(sentence)
  }

  const [main] = await tx
    .select({ id: assets.id, propertyId: assets.propertyId })
    .from(assets)
    .where(and(eq(assets.id, mainMeterId), isNotNull(assets.meterNumber), isNull(assets.deletedAt)))

  if (main === undefined || main.propertyId !== meter.propertyId) {
    throw new BadRequestException(sentence)
  }

  // Walk up from the main meter: this one must not come up on the way.
  let above: AssetId | null = mainMeterId

  for (let depth = 0; above !== null && depth < 50; depth += 1) {
    if (above === meter.id) {
      throw new BadRequestException(sentence)
    }

    const [next]: { mainMeterId: AssetId | null }[] = await tx
      .select({ mainMeterId: meterPoints.mainMeterId })
      .from(meterPoints)
      .where(eq(meterPoints.assetId, above))

    above = next?.mainMeterId ?? null
  }
}
