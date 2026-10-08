import { randomBytes } from 'node:crypto'

import {
  type AssetId,
  type Identity,
  labelCodeFrom,
  type PropertyId,
} from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { assets, defects, labels, properties } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import type { BehindTheRoutes } from './sample-data.js'

/**
 * What the sample operator has that no route writes yet: the defects of its
 * assets (#87), so that the register of assets shows an asset with an open
 * defect, and the labels of a sheet. A defect is a row, found on the day the
 * preview starts. The evidence of the duties goes through the route of a
 * report since #110 (`sendSampleReports` in `sample-data.ts`). Once a route
 * writes a defect, the sample data goes through the route and this file goes.
 */
export async function writeSampleStandings(
  database: Database,
  planter: Identity,
  planted: BehindTheRoutes,
): Promise<void> {
  const at = new Date()

  await database.forTenant(planter, async (tx) => {
    for (const defect of planted.defects) {
      const [asset] = await tx
        .select({ propertyId: assets.propertyId, areaId: assets.areaId })
        .from(assets)
        .where(eq(assets.id, defect.assetId as AssetId))

      if (asset === undefined) {
        throw new Error(`Die Anlage ${defect.assetId} der Beispieldaten gibt es nicht.`)
      }

      await tx.insert(defects).values({
        tenantId: planter.tenantId,
        propertyId: asset.propertyId,
        areaId: asset.areaId,
        assetId: defect.assetId as AssetId,
        description: defect.description,
        foundOn: dayInGermany(at),
      })
    }

    // The labels of a sheet: on their property and on nothing else, each with
    // a code of its own, as the route that prints a sheet makes them.
    for (const sheet of planted.sheets) {
      const [property] = await tx
        .select({ areaId: properties.areaId })
        .from(properties)
        .where(eq(properties.id, sheet.propertyId as PropertyId))

      if (property === undefined) {
        throw new Error(`Die Liegenschaft ${sheet.propertyId} der Beispieldaten gibt es nicht.`)
      }

      await tx.insert(labels).values(
        Array.from({ length: sheet.labels }, () => ({
          tenantId: planter.tenantId,
          propertyId: sheet.propertyId as PropertyId,
          areaId: property.areaId,
          code: labelCodeFrom(randomBytes(10)),
        })),
      )
    }
  })
}
