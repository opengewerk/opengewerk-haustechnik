import {
  type ApplicationDeadlineKind,
  type Catalogue,
  type DeadlineFacts,
  type DeadlineFilterName,
  rhythmText,
} from '@opengewerk/haustechnik-domain'
import { type DeadlineRules, isUuid } from '@opengewerk/platform-server'
import { eq, inArray, type SQL, sql } from 'drizzle-orm'

import { dutyTitle } from '../database/duty-standing.js'
import type { ApplicationDeadlineColumns } from '../database/schema/deadlines.js'
import {
  assets,
  deadlines,
  defects,
  duties,
  properties,
  rooms,
  roundPlans,
  roundTemplates,
} from '../database/schema/index.js'
import { deadlineKindRegistry } from './registry.js'

/** A filter by a record, by its id: anything else is no id and is refused. */
function byId(column: typeof deadlines.propertyId | typeof deadlines.areaId) {
  return (value: string): SQL | null => (isUuid(value) ? sql`${column} = ${value}` : null)
}

/**
 * What this application says about its deadlines, for the routes of the
 * foundation under `/deadlines` and `/settings/deadlines`: its table and
 * kinds, the sentence for a person who does not work for the operator, and
 * for the list "Fristen" (#104, #75):
 *
 * - an entry names its duty by its title, its defect by its description
 *   (#116) or the plan of a round by its template and rhythm (#113), and
 *   what that hangs on, read in one query each for the whole page
 *   (`DeadlineFacts`);
 * - the search finds the duty or the defect and its asset by the name of the
 *   deadline, and the property by its name;
 * - the list narrows to a property and to an area.
 *
 * Nothing follows a change of a deadline: a reminder makes nothing that
 * would have to follow it. Made by a function because the title of a duty
 * comes from the catalogue of this server.
 */
export function deadlineRulesFor(
  catalogue: Catalogue,
): DeadlineRules<ApplicationDeadlineKind, ApplicationDeadlineColumns> {
  const filters: Readonly<Record<DeadlineFilterName, (value: string) => SQL | null>> = {
    property: byId(deadlines.propertyId),
    area: byId(deadlines.areaId),
  }

  return {
    table: deadlines,
    registry: deadlineKindRegistry,
    describe: async (tx, rows) => {
      const ids = [...new Set(rows.flatMap((row) => (row.dutyId === null ? [] : [row.dutyId])))]
      const defectIds = [
        ...new Set(rows.flatMap((row) => (row.defectId === null ? [] : [row.defectId]))),
      ]
      const found =
        ids.length === 0
          ? []
          : await tx
              .select({
                id: duties.id,
                kind: duties.kind,
                kindVersion: duties.kindVersion,
                label: duties.label,
                buildingId: duties.buildingId,
                roomId: duties.roomId,
                assetId: duties.assetId,
                assetNumber: assets.number,
                assetName: assets.name,
                assetBuildingId: assets.buildingId,
              })
              .from(duties)
              .leftJoin(assets, eq(assets.id, duties.assetId))
              .where(inArray(duties.id, ids))
      const byDuty = new Map<string, (typeof found)[number]>(found.map((duty) => [duty.id, duty]))
      const foundDefects =
        defectIds.length === 0
          ? []
          : await tx
              .select({
                id: defects.id,
                description: defects.description,
                buildingId: defects.buildingId,
                roomId: defects.roomId,
                assetId: defects.assetId,
                assetNumber: assets.number,
                assetName: assets.name,
                assetBuildingId: assets.buildingId,
                assetRoomId: assets.roomId,
                roomBuildingId: rooms.buildingId,
              })
              .from(defects)
              .leftJoin(assets, eq(assets.id, defects.assetId))
              .leftJoin(rooms, eq(rooms.id, defects.roomId))
              .where(inArray(defects.id, defectIds))
      const byDefect = new Map<string, (typeof foundDefects)[number]>(
        foundDefects.map((defect) => [defect.id, defect]),
      )
      const planIds = [
        ...new Set(rows.flatMap((row) => (row.roundPlanId === null ? [] : [row.roundPlanId]))),
      ]
      const foundPlans =
        planIds.length === 0
          ? []
          : await tx
              .select({ plan: roundPlans, title: roundTemplates.title })
              .from(roundPlans)
              .innerJoin(roundTemplates, eq(roundTemplates.id, roundPlans.templateId))
              .where(inArray(roundPlans.id, planIds))
      const byPlan = new Map<string, (typeof foundPlans)[number]>(
        foundPlans.map((found) => [found.plan.id, found]),
      )

      return (row) => {
        if (row.roundPlanId !== null) {
          const found = byPlan.get(row.roundPlanId)
          const facts: DeadlineFacts = {
            follows: 'round',
            roundPlanId: row.roundPlanId,
            title: found?.title ?? row.sourceLabel,
            rhythm: found ? rhythmText(found.plan) : '',
            propertyId: row.propertyId,
            buildingId: found?.plan.buildingId ?? null,
            roomId: null,
            asset: null,
          }

          return { ...facts }
        }

        if (row.defectId !== null) {
          const defect = byDefect.get(row.defectId)
          const facts: DeadlineFacts = {
            follows: 'defect',
            defectId: row.defectId,
            description: defect?.description ?? row.sourceLabel,
            propertyId: row.propertyId,
            // An asset stands in its building and its room, a room in its building.
            buildingId:
              defect?.buildingId ?? defect?.assetBuildingId ?? defect?.roomBuildingId ?? null,
            roomId: defect?.roomId ?? defect?.assetRoomId ?? null,
            asset:
              defect?.assetId && defect.assetName !== null
                ? { id: defect.assetId, number: defect.assetNumber, name: defect.assetName }
                : null,
          }

          return { ...facts }
        }

        const dutyId = row.dutyId ?? ''
        const duty = byDuty.get(dutyId)
        const facts: DeadlineFacts = {
          follows: 'duty',
          dutyId,
          dutyTitle: duty ? dutyTitle(duty, catalogue) : row.sourceLabel,
          propertyId: row.propertyId,
          // An asset stands in its building; a duty at a place names it itself.
          buildingId: duty?.buildingId ?? duty?.assetBuildingId ?? null,
          roomId: duty?.roomId ?? null,
          asset:
            duty?.assetId && duty.assetName !== null
              ? { id: duty.assetId, number: duty.assetNumber, name: duty.assetName }
              : null,
        }

        // A copy, which reads as the record of fields the foundation takes.
        return { ...facts }
      }
    },
    searchIn: (pattern) =>
      sql`exists (select 1 from ${properties} where ${properties.id} = ${deadlines.propertyId} and ${properties.name} ilike ${pattern})`,
    filters,
    sentences: {
      notAColleague: 'Verantwortlich ist jemand, der für diesen Betreiber arbeitet.',
    },
  }
}
