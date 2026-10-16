import type {
  ActivityId,
  ReportedMaterial,
  StockUnit,
  TenantId,
  WorkOrderMaterialId,
  WorkOrderMaterialLine,
} from '@opengewerk/haustechnik-domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { and, asc, eq, isNull } from 'drizzle-orm'

import {
  articles,
  stockMovements,
  storeArticles,
  stores,
  workOrderMaterials,
} from '../database/schema/index.js'
import { dayInGermany } from '../today.js'

// Material taken for a work order (#326, sections 4.8 and 4.12 of the
// concept). The withdrawal comes from the device, also after a time without a
// connection; the server books it in its store in the same transaction, as a
// booking of the kind "withdrawal" that names it. One withdrawal is booked
// once: the booking names it under a unique key, so a second write of the
// same withdrawal books nothing. Whatever lay in the store, it is booked; a
// stock below zero says so until a count corrects it, and is no conflict
// (decided on 15.10.2026).

/** Books a withdrawal in its store, once, in the name of whoever took it. */
export async function bookWithdrawal(
  tx: TenantTransaction,
  tenantId: TenantId,
  materialId: WorkOrderMaterialId,
): Promise<void> {
  const [material] = await tx
    .select()
    .from(workOrderMaterials)
    .where(and(eq(workOrderMaterials.tenantId, tenantId), eq(workOrderMaterials.id, materialId)))

  if (material === undefined) {
    throw new Error('The withdrawal to book is not there')
  }

  // The store shows the article from now on, as after a receipt.
  await tx
    .insert(storeArticles)
    .values({
      tenantId: material.tenantId,
      storeId: material.storeId,
      articleId: material.articleId,
    })
    .onConflictDoNothing()
  await tx
    .insert(stockMovements)
    .values({
      tenantId: material.tenantId,
      storeId: material.storeId,
      articleId: material.articleId,
      kind: 'withdrawal',
      quantityMilli: material.quantityMilli,
      supplierId: null,
      reason: null,
      bookedBy: material.takenBy,
      materialId: material.id,
    })
    .onConflictDoNothing()
}

/**
 * The material of a work order as its page in the office shows it, the first
 * taken first: how much of which article, from which store, on which day. An
 * article no longer kept is named all the same. No person and no price.
 */
export async function materialsOf(
  tx: TenantTransaction,
  activityId: ActivityId,
): Promise<WorkOrderMaterialLine[]> {
  const rows = await tx
    .select({
      material: workOrderMaterials,
      article: { number: articles.number, designation: articles.designation, unit: articles.unit },
      store: stores.name,
    })
    .from(workOrderMaterials)
    .innerJoin(articles, eq(articles.id, workOrderMaterials.articleId))
    .innerJoin(stores, eq(stores.id, workOrderMaterials.storeId))
    .where(and(eq(workOrderMaterials.activityId, activityId), isNull(workOrderMaterials.deletedAt)))
    .orderBy(asc(workOrderMaterials.takenAt), asc(workOrderMaterials.id))

  return rows.map(({ material, article, store }) => ({
    id: material.id,
    quantityMilli: material.quantityMilli,
    unit: article.unit as StockUnit,
    articleId: material.articleId,
    number: article.number,
    designation: article.designation,
    storeId: material.storeId,
    store,
    takenOn: dayInGermany(material.takenAt),
  }))
}

/** The material of a work order as the page of its service report shows it: by key, no store, no price. */
export async function reportedMaterialsOf(
  tx: TenantTransaction,
  activityId: ActivityId,
): Promise<ReportedMaterial[]> {
  return (await materialsOf(tx, activityId)).map(({ id, quantityMilli, unit, designation }) => ({
    id,
    quantityMilli,
    unit,
    designation,
  }))
}
