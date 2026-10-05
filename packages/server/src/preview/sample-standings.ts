import {
  type AssetId,
  type Catalogue,
  type DutyId,
  type Identity,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { assets, defects } from '../database/schema/index.js'
import { writeEvidence } from '../evidence/write.js'
import { dayInGermany } from '../today.js'
import type { PlantedStandings } from './sample-data.js'

/**
 * What the sample operator has that no route writes yet: the evidence of its
 * duties and the defects of its assets (#87), so that the register of assets
 * shows an asset in order, one due, one overdue and one with an open defect.
 *
 * The evidence is written by the function the application writes every
 * evidence with (`writeEvidence`), as the report of an examiner from outside:
 * with its number from the sequence, the frozen state of the day and the
 * fingerprint over it. A defect is a row, found on the day the preview
 * starts. Once a route writes either, the sample data goes through the route
 * and this file goes.
 */
export async function writeSampleStandings(
  database: Database,
  planter: Identity,
  catalogue: Catalogue,
  planted: PlantedStandings,
): Promise<void> {
  const at = new Date()

  await database.forTenant(planter, async (tx) => {
    // In the order they were performed, so that the numbers run with the days.
    const byDay = [...planted.evidence].sort((left, right) =>
      left.performedOn.localeCompare(right.performedOn),
    )

    for (const evidence of byDay) {
      await writeEvidence(
        tx,
        {
          tenantId: planter.tenantId,
          writtenBy: planter.userId,
          at,
          catalogue,
          nameOf: () => 'Leitung (Vorschau)',
        },
        {
          dutyId: evidence.dutyId as DutyId,
          activityId: null,
          origin: 'report',
          performedOn: evidence.performedOn as IsoDate,
          result: 'without_defects',
          resultReason: null,
          performedBy: null,
          examiner: { name: 'Erika Beispiel', organisation: 'Prüfdienst Beispiel GmbH' },
          signatures: [],
          files: [],
        },
      )
    }

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
  })
}
