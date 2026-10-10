import { randomBytes } from 'node:crypto'

import {
  type ActivityId,
  type Catalogue,
  type Identity,
  labelCodeFrom,
  type PropertyId,
} from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { pageFingerprint, pageOf, takeSignature } from '../activities/signing.js'
import { activities, labels, properties } from '../database/schema/index.js'
import { dayInGermany } from '../today.js'
import { previewColleagues } from './preview-database.js'
import type { BehindTheRoutes } from './sample-data.js'

/** A signature as a finger draws it on a telephone, in the units of `signatureBox`. */
const sampleSignature =
  'M80,260L170,150L240,290L330,120L420,280L510,140L600,260L700,180L820,230L920,200'

/**
 * What the sample operator has that no route writes: the signatures under
 * the work orders, which a device sends with the day the work was done
 * (#117), and the labels of a sheet. The defects are reported through their
 * route since #116, the evidence of the duties through the route of a report
 * since #110, and a work order follows its signature through its routes
 * (`decideSampleOrders`).
 */
export async function writeSampleStandings(
  database: Database,
  planter: Identity,
  planted: BehindTheRoutes,
  catalogue: Catalogue,
): Promise<void> {
  const at = new Date()

  await database.forTenant(planter, async (tx) => {
    // Signed by the person who leads the order, on the day of the planting.
    for (const order of planted.orders) {
      const id = order.activityId as ActivityId

      await tx
        .update(activities)
        .set({ status: 'started', performedOn: dayInGermany(at) })
        .where(eq(activities.id, id))

      const [row] = await tx.select().from(activities).where(eq(activities.id, id))

      if (row === undefined) {
        throw new Error(`Den Auftrag ${order.activityId} der Beispieldaten gibt es nicht.`)
      }

      await takeSignature(
        tx,
        {
          tenantId: planter.tenantId,
          writtenBy: order.leads,
          at,
          catalogue,
          nameOf: (userId) =>
            previewColleagues.find((colleague) => colleague.id === userId)?.name ??
            'Unbekanntes Konto',
        },
        {
          activityId: id,
          role: 'signer',
          signedAt: at,
          deviceInfo: 'Telefon',
          path: sampleSignature,
          typedName: null,
          pageFingerprint: pageFingerprint(await pageOf(tx, row)),
        },
      )
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
