import {
  type ApplicationDeadlineKind,
  type Catalogue,
  type DeadlineFacts,
  type DeadlineFilterName,
  deadlineSubject,
  deadlineTableColumns,
  deadlineWhereWords,
  isAllowed,
  rhythmText,
} from '@opengewerk/haustechnik-domain'
import { type DeadlineRules, isUuid } from '@opengewerk/platform-server'
import { eq, inArray, type SQL, sql } from 'drizzle-orm'

import { placeNamesFor } from '../api/office-tables.js'
import type { Asking } from '../api/places.js'
import { dutyTitle } from '../database/duty-standing.js'
import type { ApplicationDeadlineColumns } from '../database/schema/deadlines.js'
import {
  activities,
  assets,
  attachments,
  contractors,
  contracts,
  deadlines,
  defects,
  duties,
  evidence,
  properties,
  qualifications,
  rooms,
  roundPlans,
  roundTemplates,
  workOrders,
} from '../database/schema/index.js'
import { mayAnswerForDeadlines } from './answerers.js'
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
  /** The names of accounts, for the expiry of a qualification (#337); none in a test that asks for none. */
  namesOf: (userIds: readonly string[]) => Promise<ReadonlyMap<string, string>> = () =>
    Promise.resolve(new Map()),
): DeadlineRules<ApplicationDeadlineKind, ApplicationDeadlineColumns> {
  const filters: Readonly<Record<DeadlineFilterName, (value: string) => SQL | null>> = {
    property: byId(deadlines.propertyId),
    area: byId(deadlines.areaId),
  }

  return {
    table: deadlines,
    registry: deadlineKindRegistry,
    describe: async (tx, rows, identity) => {
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
      // The documents whose day a deadline follows (#327), with what they hang on.
      const documentIds = [
        ...new Set(rows.flatMap((row) => (row.attachmentId === null ? [] : [row.attachmentId]))),
      ]
      const foundDocuments =
        documentIds.length === 0
          ? []
          : await tx
              .select({
                id: attachments.id,
                title: attachments.title,
                kind: attachments.kind,
                buildingId: attachments.buildingId,
                roomId: attachments.roomId,
                assetId: attachments.assetId,
                assetNumber: assets.number,
                assetName: assets.name,
                assetBuildingId: assets.buildingId,
                assetRoomId: assets.roomId,
                roomBuildingId: rooms.buildingId,
                // The firm of a contractor's document (#328), which has no place.
                // Named with the title of the document for whoever reads
                // deadlines, without seeing the firms: the name of a firm and
                // what the deadline of a paper says, its title, the firm and
                // the day, are no secret; the paper with its files is (decided
                // by the maintainer on 16.10.2026, #377).
                contractorId: contractors.id,
                contractorName: contractors.name,
                // The contract of a contract's document (#329), which has no place either.
                contractId: contracts.id,
                contractTitle: contracts.title,
              })
              .from(attachments)
              .leftJoin(assets, eq(assets.id, attachments.assetId))
              .leftJoin(rooms, eq(rooms.id, attachments.roomId))
              .leftJoin(contractors, eq(contractors.id, attachments.contractorId))
              .leftJoin(contracts, eq(contracts.id, attachments.contractId))
              .where(inArray(attachments.id, documentIds))
      const byDocument = new Map<string, (typeof foundDocuments)[number]>(
        foundDocuments.map((document) => [document.id, document]),
      )
      // The contracts whose day to give notice or end a deadline follows (#329),
      // with their firm. Whoever reads deadlines reads what such a deadline
      // says: the title of the contract, the firm and the day.
      const contractIds = [
        ...new Set(rows.flatMap((row) => (row.contractId === null ? [] : [row.contractId]))),
      ]
      const foundContracts =
        contractIds.length === 0
          ? []
          : await tx
              .select({
                id: contracts.id,
                title: contracts.title,
                contractorId: contractors.id,
                contractorName: contractors.name,
              })
              .from(contracts)
              .innerJoin(contractors, eq(contractors.id, contracts.contractorId))
              .where(inArray(contracts.id, contractIds))
      const byContract = new Map<string, (typeof foundContracts)[number]>(
        foundContracts.map((contract) => [contract.id, contract]),
      )
      // The people whose qualification runs out (#337), by the names of their
      // accounts, and only for whoever looks at qualifications: the deadline
      // is read with the right to read deadlines, the person is not.
      const namesThePeople = isAllowed(identity as Asking, 'qualification.read')
      const qualificationIds = [
        ...new Set(
          rows.flatMap((row) => (row.qualificationId === null ? [] : [row.qualificationId])),
        ),
      ]
      const foundQualifications =
        qualificationIds.length === 0
          ? []
          : await tx
              .select({ id: qualifications.id, userId: qualifications.userId })
              .from(qualifications)
              .where(inArray(qualifications.id, qualificationIds))
      const byQualification = new Map(foundQualifications.map((each) => [each.id, each.userId]))
      const names =
        foundQualifications.length === 0 || !namesThePeople
          ? new Map<string, string>()
          : await namesOf([...new Set(foundQualifications.map((each) => each.userId))])
      // The people whose access ends or whose data goes (#356), by the names
      // of their accounts, and only for whoever keeps the accesses: the
      // deadline is read with the right to read deadlines, the person is not.
      const keepsTheAccesses = isAllowed(identity as Asking, 'membership.write')
      const members = [
        ...new Set(rows.flatMap((row) => (row.memberUserId === null ? [] : [row.memberUserId]))),
      ]
      const memberNames =
        members.length === 0 || !keepsTheAccesses
          ? new Map<string, string>()
          : await namesOf(members)
      // The evidence whose retention ends (#340), with its duty and where that hangs.
      const evidenceIds = [
        ...new Set(rows.flatMap((row) => (row.evidenceId === null ? [] : [row.evidenceId]))),
      ]
      const foundEvidence =
        evidenceIds.length === 0
          ? []
          : await tx
              .select({
                id: evidence.id,
                number: evidence.number,
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
              .from(evidence)
              .innerJoin(duties, eq(duties.id, evidence.dutyId))
              .leftJoin(assets, eq(assets.id, duties.assetId))
              .where(inArray(evidence.id, evidenceIds))
      const byEvidence = new Map<string, (typeof foundEvidence)[number]>(
        foundEvidence.map((each) => [each.id, each]),
      )
      // The assets and the accepted work orders whose warranty ends (#329).
      const warrantyAssetIds = [
        ...new Set(
          rows.flatMap((row) => (row.warrantyAssetId === null ? [] : [row.warrantyAssetId])),
        ),
      ]
      const warrantyOrderIds = [
        ...new Set(
          rows.flatMap((row) => (row.warrantyOrderId === null ? [] : [row.warrantyOrderId])),
        ),
      ]
      const foundAssets =
        warrantyAssetIds.length === 0
          ? []
          : await tx
              .select({
                id: assets.id,
                number: assets.number,
                name: assets.name,
                buildingId: assets.buildingId,
                roomId: assets.roomId,
              })
              .from(assets)
              .where(inArray(assets.id, warrantyAssetIds))
      const byAsset = new Map<string, (typeof foundAssets)[number]>(
        foundAssets.map((asset) => [asset.id, asset]),
      )
      const foundOrders =
        warrantyOrderIds.length === 0
          ? []
          : await tx
              .select({
                id: workOrders.id,
                activityId: activities.id,
                number: workOrders.number,
                title: activities.title,
                buildingId: activities.buildingId,
                roomId: activities.roomId,
                assetId: activities.assetId,
                assetNumber: assets.number,
                assetName: assets.name,
                assetBuildingId: assets.buildingId,
                assetRoomId: assets.roomId,
                roomBuildingId: rooms.buildingId,
              })
              .from(workOrders)
              .innerJoin(activities, eq(activities.id, workOrders.activityId))
              .leftJoin(assets, eq(assets.id, activities.assetId))
              .leftJoin(rooms, eq(rooms.id, activities.roomId))
              .where(inArray(workOrders.id, warrantyOrderIds))
      const byOrder = new Map<string, (typeof foundOrders)[number]>(
        foundOrders.map((order) => [order.id, order]),
      )

      return (row) => {
        if (row.attachmentId !== null) {
          const document = byDocument.get(row.attachmentId)
          const facts: DeadlineFacts = {
            follows: 'document',
            attachmentId: row.attachmentId,
            title: document?.title ?? row.sourceLabel,
            documentKind: document?.kind ?? null,
            propertyId: row.propertyId,
            contractor:
              document?.contractorId === null || document?.contractorId === undefined
                ? null
                : { id: document.contractorId, name: document.contractorName ?? '' },
            contract:
              document?.contractId === null || document?.contractId === undefined
                ? null
                : { id: document.contractId, title: document.contractTitle ?? '' },
            buildingId:
              document?.buildingId ?? document?.assetBuildingId ?? document?.roomBuildingId ?? null,
            roomId: document?.roomId ?? document?.assetRoomId ?? null,
            asset:
              document?.assetId === null || document?.assetId === undefined
                ? null
                : {
                    id: document.assetId,
                    number: document.assetNumber,
                    name: document.assetName ?? '',
                  },
          }

          return { ...facts }
        }

        // The end of the retention of an evidence (#340): its number and its duty.
        if (row.evidenceId !== null) {
          const held = byEvidence.get(row.evidenceId)
          const facts: DeadlineFacts = {
            follows: 'evidence',
            evidence: {
              id: row.evidenceId,
              number: held?.number ?? row.sourceLabel,
              dutyTitle: held ? dutyTitle(held, catalogue) : row.sourceLabel,
            },
            propertyId: row.propertyId ?? '',
            buildingId: held?.buildingId ?? held?.assetBuildingId ?? null,
            roomId: held?.roomId ?? null,
            asset:
              held?.assetId && held.assetName !== null
                ? { id: held.assetId, number: held.assetNumber, name: held.assetName }
                : null,
          }

          return { ...facts }
        }

        // The expiry of a qualification (#337): its kind, which its source
        // writes, and the person, by the name of the account.
        if (row.qualificationId !== null) {
          const held = byQualification.get(row.qualificationId)
          const facts: DeadlineFacts = {
            follows: 'qualification',
            propertyId: null,
            qualification: {
              id: row.qualificationId,
              kindLabel: row.sourceLabel,
              personName: !namesThePeople
                ? null
                : held === undefined
                  ? 'Unbekanntes Konto'
                  : (names.get(held) ?? 'Unbekanntes Konto'),
            },
          }

          return { ...facts }
        }

        // The end of an access or the day its data goes (#356): the person, for whoever keeps the accesses.
        if (row.memberUserId !== null) {
          const facts: DeadlineFacts = {
            follows: 'membership',
            propertyId: null,
            membership: {
              userId: keepsTheAccesses ? row.memberUserId : '',
              personName: keepsTheAccesses
                ? (memberNames.get(row.memberUserId) ?? 'Unbekanntes Konto')
                : null,
            },
          }

          return { ...facts }
        }

        // A delegation of duties (#336), named by the person it goes to, which its source writes.
        if (row.delegationId !== null) {
          const facts: DeadlineFacts = {
            follows: 'delegation',
            propertyId: null,
            delegation: { id: row.delegationId, delegateName: row.sourceLabel },
          }

          return { ...facts }
        }

        if (row.contractId !== null) {
          const contract = byContract.get(row.contractId)
          const facts: DeadlineFacts = {
            follows: 'contract',
            propertyId: null,
            contract: { id: row.contractId, title: contract?.title ?? row.sourceLabel },
            contractor: {
              id: contract?.contractorId ?? '',
              name: contract?.contractorName ?? '',
            },
          }

          return { ...facts }
        }

        if (row.warrantyAssetId !== null) {
          const asset = byAsset.get(row.warrantyAssetId)
          const facts: DeadlineFacts = {
            follows: 'warranty',
            workOrder: null,
            propertyId: row.propertyId ?? '',
            buildingId: asset?.buildingId ?? null,
            roomId: asset?.roomId ?? null,
            asset: {
              id: row.warrantyAssetId,
              number: asset?.number ?? null,
              name: asset?.name ?? row.sourceLabel,
            },
          }

          return { ...facts }
        }

        if (row.warrantyOrderId !== null) {
          const order = byOrder.get(row.warrantyOrderId)
          const facts: DeadlineFacts = {
            follows: 'warranty',
            workOrder: {
              id: order?.activityId ?? row.warrantyOrderId,
              number: order?.number ?? '',
              title: order?.title ?? row.sourceLabel,
            },
            propertyId: row.propertyId ?? '',
            buildingId:
              order?.buildingId ?? order?.assetBuildingId ?? order?.roomBuildingId ?? null,
            roomId: order?.roomId ?? order?.assetRoomId ?? null,
            asset:
              order?.assetId && order.assetName !== null
                ? { id: order.assetId, number: order.assetNumber, name: order.assetName }
                : null,
          }

          return { ...facts }
        }

        if (row.meterPropertyId !== null) {
          const facts: DeadlineFacts = {
            follows: 'meter',
            propertyId: row.propertyId ?? '',
            buildingId: null,
            roomId: null,
            asset: null,
          }

          return { ...facts }
        }

        if (row.roundPlanId !== null) {
          const found = byPlan.get(row.roundPlanId)
          const facts: DeadlineFacts = {
            follows: 'round',
            roundPlanId: row.roundPlanId,
            title: found?.title ?? row.sourceLabel,
            rhythm: found ? rhythmText(found.plan) : '',
            propertyId: row.propertyId ?? '',
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
            propertyId: row.propertyId ?? '',
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
          propertyId: row.propertyId ?? '',
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
    // By the name of the property, or of the firm whose document it follows (#328),
    // or of the firm whose contract it follows (#329).
    searchIn: (pattern) =>
      sql`(exists (select 1 from ${properties} where ${properties.id} = ${deadlines.propertyId} and ${properties.name} ilike ${pattern})
        or exists (select 1 from ${attachments} join ${contractors} on ${contractors.id} = ${attachments.contractorId}
                    where ${attachments.id} = ${deadlines.attachmentId} and ${contractors.name} ilike ${pattern})
        or exists (select 1 from ${contracts} join ${contractors} on ${contractors.id} = ${contracts.contractorId}
                    where ${contracts.id} = ${deadlines.contractId} and ${contractors.name} ilike ${pattern}))`,
    filters,
    // The list names, and a person of a deadline is, only somebody who sees
    // its area (#473).
    mayAnswer: mayAnswerForDeadlines,
    sentences: {
      notAColleague: 'Verantwortlich ist jemand, der für diesen Betreiber arbeitet.',
      outsideThePlace: 'Verantwortlich ist jemand, der den Bereich dieser Frist sieht.',
    },
    // The list as a table (#236): what a deadline is called and what it hangs
    // on, as the list names them; the places only for whoever reads them, and
    // the number and the name of an asset only for whoever reads assets.
    listAsTable: {
      name: 'Fristen',
      columns: [deadlineTableColumns.where],
      cells: async (tx, identity) => {
        const names = await placeNamesFor(tx, identity as Asking)
        const assets = isAllowed(identity as Asking, 'asset.read')

        return (row) => {
          const facts = row as unknown as DeadlineFacts

          return {
            subject: deadlineSubject(facts),
            cells: [deadlineWhereWords(facts, names, assets)],
          }
        }
      },
      narrowedToAPerson:
        'Auf eine Person eingegrenzt gibt es die Fristen als Tabelle nur für die Leitung.',
    },
  }
}
