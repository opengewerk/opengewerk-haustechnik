import {
  addDays,
  addMonths,
  type AssetId,
  type Identity,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'
import type { Database, TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import {
  assets,
  meterExchanges,
  meterPauses,
  meterPoints,
  meterReadings,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'

/** The measuring points of the sample operator, by the name they were taken in with. */
export const sampleMeters = {
  school: 'Hauptwasserzähler Schulhaus',
  gym: 'Unterzähler Sporthalle',
  houseA: 'Hauptwasserzähler Haus A',
  kitchen: 'Unterzähler Teeküche',
  workshop: 'Wasserzähler Werkstatt',
  house2: 'Hauptwasserzähler Haus 2',
} as const

/**
 * The readings of the sample meters and what they hold beside their assets
 * (#119), written behind the routes as two years of readings would have come:
 * the main water meter of the school with every month of two years, one
 * reading corrected, a pause in the summer, a note and the reading of this
 * month still missing; its sub meter read this month; the main meter of Haus
 * A with its meter replaced two months ago; the meter of the workshop locked;
 * the one of Haus 2 resting since last month.
 */
export async function giveSampleMeters(database: Database, planter: Identity): Promise<void> {
  const today = dayInGermany()
  const current = `${today.slice(0, 7)}-01` as IsoDate
  const back = (months: number) => addMonths(current, -months)

  await database.forTenant(planter, async (tx) => {
    const meterOf = async (name: string) => {
      const [found] = await tx
        .select()
        .from(assets)
        .where(and(eq(assets.name, name), isNull(assets.deletedAt)))

      if (found === undefined) {
        throw new Error(`Die Messstelle „${name}“ der Beispieldaten gibt es nicht.`)
      }

      return found
    }
    const place = (asset: { propertyId: string; areaId: string; id: string }) => ({
      tenantId: planter.tenantId,
      propertyId: asset.propertyId as never,
      areaId: asset.areaId as never,
      assetId: asset.id as AssetId,
    })
    const reading = async (
      asset: { propertyId: string; areaId: string; id: string },
      keyDate: IsoDate,
      valueMilli: number,
      by: string,
      source: 'by_hand' | 'reading_round' | 'round',
      readOn: IsoDate = keyDate,
    ) =>
      (
        await tx
          .insert(meterReadings)
          .values({ ...place(asset), keyDate, readOn, valueMilli, source, recordedBy: by })
          .returning({ id: meterReadings.id })
      )[0]?.id

    // The school: two years, the summer resting, one reading corrected.
    const school = await meterOf(sampleMeters.school)
    let value = 4_100_000
    const monthly = [41, 44, 52, 49, 51, 38, 12, 0, 46, 50, 47, 43]

    for (let months = 25; months >= 1; months -= 1) {
      const keyDate = back(months)

      if (months === 2) {
        continue
      }

      value += (monthly[months % 12] ?? 45) * 1_000 + 300
      const id = await reading(
        school,
        keyDate,
        months === 5 ? value - 36_000 : value,
        months % 3 === 0 ? 'preview-roth' : 'preview-wendt',
        months % 2 === 0 ? 'round' : 'reading_round',
        months === 13 ? addDays(keyDate, -1) : keyDate,
      )

      if (months === 5 && id !== undefined) {
        await tx.insert(meterReadings).values({
          ...place(school),
          keyDate,
          readOn: keyDate,
          valueMilli: value,
          source: 'by_hand',
          correctsId: id,
          correctionReason: 'Zahlendreher',
          recordedBy: 'preview-roth',
        })
      }
    }

    await tx.insert(meterPauses).values({
      ...place(school),
      startsOn: back(2),
      endsOn: addDays(back(1), 14),
      reason: 'Sommerferien, Hauptleitung abgesperrt',
    })
    await pointFor(tx, place(school), {
      note: 'Schacht im Hof, Deckel schwer. Zutritt nur mit dem Hausmeister.',
      noteBy: 'preview-roth',
      notedOn: addDays(today, -210),
    })

    // Its sub meter, read this month.
    const gym = await meterOf(sampleMeters.gym)

    for (const [months, figure] of [
      [2, 1_180_200],
      [1, 1_194_800],
      [0, 1_204_600],
    ] as const) {
      await reading(gym, back(months), figure, 'preview-wendt', 'reading_round')
    }

    await pointFor(tx, place(gym), { mainMeterId: school.id })

    // Haus A: the meter replaced two months ago.
    const houseA = await meterOf(sampleMeters.houseA)

    await reading(houseA, back(4), 812_400, 'preview-vogt', 'round')
    await reading(houseA, back(3), 829_100, 'preview-vogt', 'round')
    await tx.insert(meterExchanges).values({
      ...place(houseA),
      exchangedOn: addDays(back(3), 12),
      oldNumber: houseA.meterNumber ?? 'WZ-1001',
      oldEndMilli: 836_700,
      newNumber: 'WZ-1001-N',
      newStartMilli: 0,
    })
    await tx.update(assets).set({ meterNumber: 'WZ-1001-N' }).where(eq(assets.id, houseA.id))
    await reading(houseA, back(2), 11_300, 'preview-vogt', 'round')
    await reading(houseA, back(1), 28_900, 'preview-vogt', 'round')
    await pointFor(tx, place(houseA), { conversionFactor: 1, controlId: 'GLT-HA-WZ01' })

    const kitchen = await meterOf(sampleMeters.kitchen)

    await reading(kitchen, back(1), 96_400, 'preview-vogt', 'round')
    await pointFor(tx, place(kitchen), { mainMeterId: houseA.id })

    // The workshop: locked.
    const workshop = await meterOf(sampleMeters.workshop)

    await reading(workshop, back(2), 2_048_000, 'preview-vogt', 'by_hand')
    await reading(workshop, back(1), 2_061_500, 'preview-vogt', 'by_hand')
    await pointFor(tx, place(workshop), {
      lockReason: 'Schacht nach Starkregen überflutet, nicht betreten.',
      lockedOn: addDays(today, -3),
    })

    // Haus 2: resting since last month, with no end yet.
    const house2 = await meterOf(sampleMeters.house2)

    await reading(house2, back(2), 9_018_700, 'preview-wendt', 'reading_round')
    await tx.insert(meterPauses).values({
      ...place(house2),
      startsOn: back(1),
      reason: 'Haus 2 leer, Hauptleitung abgesperrt',
    })
  })
}

/** Where a row of a measuring point belongs. */
type PointPlace = Pick<
  typeof meterPoints.$inferInsert,
  'tenantId' | 'propertyId' | 'areaId' | 'assetId'
>

/** What a measuring point carries beside its asset, written once. */
async function pointFor(
  tx: TenantTransaction,
  at: PointPlace,
  values: Partial<typeof meterPoints.$inferInsert>,
): Promise<void> {
  await tx.insert(meterPoints).values({ ...at, ...values })
}
