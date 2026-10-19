import { type Identity } from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { assets, inverters, pvModules, pvStrings } from '../database/schema/index.js'

/** The PV installation of the sample operator the structure hangs on. */
export const samplePvInstallation = 'PV-Anlage Dach Halle 1'

/**
 * The PV structure below the PV installation of the sample operator (#461),
 * written behind the routes as an electrician would have taken it up on the
 * roof: one inverter in the store of the hall with its two MPP inputs, a
 * string of twelve modules of 400 Wp on each, every module with the serial
 * number from its label. Made-up makers, models and numbers, as in every
 * sample, and as the boards of the canvas draw them.
 */
export async function giveSamplePhotovoltaic(database: Database, planter: Identity): Promise<void> {
  await database.forTenant(planter, async (tx) => {
    const [installation] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.name, samplePvInstallation), isNull(assets.deletedAt)))

    if (installation === undefined) {
      throw new Error(`Die Anlage „${samplePvInstallation}“ der Beispieldaten gibt es nicht.`)
    }

    const place = {
      tenantId: planter.tenantId,
      assetId: installation.id,
      propertyId: installation.propertyId,
      areaId: installation.areaId,
    }
    const [inverter] = await tx
      .insert(inverters)
      .values({
        ...place,
        designation: 'WR 1',
        location: 'E.02 Lager, an der Nordwand',
        manufacturer: 'Beispielwandler',
        model: 'BW 10.0',
        serialNumber: 'BW10-2305-0417',
        ratedPowerW: 10_000,
        mppInputs: 2,
        position: 1,
      })
      .returning({ id: inverters.id })

    if (inverter === undefined) {
      return
    }

    for (const input of [1, 2]) {
      const [pvString] = await tx
        .insert(pvStrings)
        .values({
          ...place,
          inverterId: inverter.id,
          designation: `String ${String(input)}`,
          mppInput: input,
          position: input,
        })
        .returning({ id: pvStrings.id })

      if (pvString === undefined) {
        continue
      }

      await tx.insert(pvModules).values(
        Array.from({ length: 12 }, (_, index) => ({
          ...place,
          pvStringId: pvString.id,
          manufacturer: 'Beispielsolar',
          model: 'BS 400 M',
          serialNumber: `BS4-2306-${String(1100 + (input - 1) * 12 + index + 1)}`,
          ratedPowerW: 400,
          position: index + 1,
        })),
      )
    }
  })
}
