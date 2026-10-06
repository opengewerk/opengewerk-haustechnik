import {
  type AssetId,
  type Catalogue,
  type DutyId,
  type EvidenceId,
  type Identity,
  type IsoDate,
} from '@opengewerk/haustechnik-domain'
import type { Database } from '@opengewerk/platform-server'
import { eq } from 'drizzle-orm'

import { assets, defects } from '../database/schema/index.js'
import { voidEvidence } from '../evidence/voiding.js'
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
 * fingerprint over it. One duty has evidence that does not simply count
 * (#101): a test that failed, a correction, written as the new evidence that
 * names the one it replaces, and an evidence declared invalid by the function
 * the application declares every evidence invalid with (`voidEvidence`). A
 * defect is a row, found on the day the preview starts. Once a route writes
 * either, the sample data goes through the route and this file goes.
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
    // A correction after the evidence it corrects, whatever day it names.
    const byDay = [...planted.evidence].sort(
      (left, right) =>
        Number(left.corrects !== undefined) - Number(right.corrects !== undefined) ||
        left.performedOn.localeCompare(right.performedOn),
    )
    const context = {
      tenantId: planter.tenantId,
      writtenBy: planter.userId,
      at,
      catalogue,
      nameOf: () => 'Leitung (Vorschau)',
    }
    const written = new Map<string, EvidenceId>()
    const keyOf = (dutyId: string, performedOn: string) => `${dutyId} ${performedOn}`

    for (const evidence of byDay) {
      const replaced =
        evidence.corrects === undefined
          ? undefined
          : written.get(keyOf(evidence.dutyId, evidence.corrects))

      if (evidence.corrects !== undefined && replaced === undefined) {
        throw new Error(
          `Die Beispieldaten berichtigen einen Nachweis vom ${evidence.corrects}, den es nicht gibt.`,
        )
      }

      const { id } = await writeEvidence(tx, context, {
        dutyId: evidence.dutyId as DutyId,
        activityId: null,
        origin: 'report',
        performedOn: evidence.performedOn as IsoDate,
        result: evidence.result ?? 'without_defects',
        resultReason: null,
        performedBy: null,
        examiner: { name: 'Erika Beispiel', organisation: 'Prüfdienst Beispiel GmbH' },
        signatures: [],
        files: [],
        ...(replaced === undefined
          ? {}
          : { replaces: { evidenceId: replaced, reason: 'Im Bericht steht ein anderer Tag.' } }),
      })

      written.set(keyOf(evidence.dutyId, evidence.performedOn), id)

      if (evidence.voidedBecause !== undefined) {
        await voidEvidence(tx, context, { evidenceId: id, reason: evidence.voidedBecause })
      }
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
