import {
  type ApplicationDeadlineKind,
  type Catalogue,
  type DeadlineFilterName,
  type DutyDeadlineFacts,
} from '@opengewerk/haustechnik-domain'
import { type DeadlineRules, isUuid } from '@opengewerk/platform-server'
import { eq, inArray, type SQL, sql } from 'drizzle-orm'

import { dutyTitle } from '../database/duty-standing.js'
import type { ApplicationDeadlineColumns } from '../database/schema/deadlines.js'
import { assets, deadlines, duties, properties } from '../database/schema/index.js'
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
 * - an entry names its duty by its title and what the duty hangs on, read
 *   in one query for the whole page (`DutyDeadlineFacts`);
 * - the search finds the duty and its asset by the name of the deadline, and
 *   the property by its name;
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
      const ids = [...new Set(rows.map((row) => row.dutyId))]
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

      return (row) => {
        const duty = byDuty.get(row.dutyId)
        const facts: DutyDeadlineFacts = {
          dutyId: row.dutyId,
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
