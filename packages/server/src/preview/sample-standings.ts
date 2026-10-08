import { randomBytes } from 'node:crypto'

import {
  type DefectId,
  type Identity,
  labelCodeFrom,
  type PropertyId,
} from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { defects, labels, properties } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import type { BehindTheRoutes } from './sample-data.js'

/**
 * What the sample operator has that no route writes yet: how far two defects
 * are beyond found, one set right by a work order and one checked again after
 * that, which the work orders bring (#117), and the labels of a sheet. The
 * defects themselves are reported through their route since #116, the
 * evidence of the duties through the route of a report since #110.
 */
export async function writeSampleStandings(
  database: Database,
  planter: Identity,
  planted: BehindTheRoutes,
): Promise<void> {
  const at = new Date()

  await database.forTenant(planter, async (tx) => {
    for (const defect of planted.defects) {
      await tx
        .update(defects)
        .set(
          defect.status === 'verified'
            ? {
                status: 'verified',
                checkedOn: dayInGermany(at),
                checkNote: 'Bei der Nachprüfung in Ordnung.',
              }
            : { status: 'remedied' },
        )
        .where(eq(defects.id, defect.defectId as DefectId))
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
