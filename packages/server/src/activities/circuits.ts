import {
  type Catalogue,
  type ChartedCircuit,
  circuitsInChartOrder,
  type FormVersions,
  pageAsksCircuits,
  type TenantId,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { shippedCatalogue } from '../catalogue.js'
import { boardSections, circuits, distributionBoards } from '../database/schema/index.js'

/**
 * The circuits of an installation as a form over them takes them (#350): in
 * the order of the chart, as the device works them out from what it holds
 * (`heldPageOf`), so that both give the same page to sign.
 */

/**
 * The circuits of an asset in the order of its chart: its boards that are
 * not marked, and below them their sections and circuits that are not
 * marked, found by their board as on the device.
 */
export async function chartOfAsset(
  tx: TenantTransaction,
  tenantId: TenantId,
  assetId: string,
): Promise<readonly ChartedCircuit[]> {
  const boards = await tx
    .select({
      id: distributionBoards.id,
      kind: distributionBoards.kind,
      designation: distributionBoards.designation,
      position: distributionBoards.position,
    })
    .from(distributionBoards)
    .where(
      and(
        eq(distributionBoards.tenantId, tenantId),
        eq(distributionBoards.assetId, assetId as typeof distributionBoards.$inferSelect.assetId),
        isNull(distributionBoards.deletedAt),
      ),
    )

  if (boards.length === 0) {
    return []
  }

  const boardIds = boards.map((board) => board.id)
  const sections = await tx
    .select({
      id: boardSections.id,
      distributionBoardId: boardSections.distributionBoardId,
      designation: boardSections.designation,
      position: boardSections.position,
    })
    .from(boardSections)
    .where(
      and(
        eq(boardSections.tenantId, tenantId),
        inArray(boardSections.distributionBoardId, boardIds),
        isNull(boardSections.deletedAt),
      ),
    )
  const onBoards = await tx
    .select({
      id: circuits.id,
      distributionBoardId: circuits.distributionBoardId,
      boardSectionId: circuits.boardSectionId,
      designation: circuits.designation,
      consumer: circuits.consumer,
      tripCharacteristic: circuits.tripCharacteristic,
      ratedCurrentMilli: circuits.ratedCurrentMilli,
      ratedResidualCurrentMilli: circuits.ratedResidualCurrentMilli,
      position: circuits.position,
    })
    .from(circuits)
    .where(
      and(
        eq(circuits.tenantId, tenantId),
        inArray(circuits.distributionBoardId, boardIds),
        isNull(circuits.deletedAt),
      ),
    )

  return circuitsInChartOrder(boards, sections, onBoards)
}

let shipped: Catalogue | null = null

/** The forms of the catalogue this build ships, read once. */
export function shippedForms(): FormVersions {
  shipped ??= shippedCatalogue()

  return shipped
}

/**
 * The circuits the page of an activity names: those of its asset where its
 * form has a group over the circuits (`pageAsksCircuits`), and none
 * otherwise, so that every page from before keeps its fingerprint.
 */
export async function circuitsOfPage(
  tx: TenantTransaction,
  activity: {
    readonly tenantId: TenantId
    readonly assetId: string | null
    readonly formKey: string | null
    readonly formVersion: number | null
  },
  catalogue: FormVersions,
): Promise<readonly ChartedCircuit[] | null> {
  return activity.assetId !== null && pageAsksCircuits(catalogue, activity)
    ? chartOfAsset(tx, activity.tenantId, activity.assetId)
    : null
}
