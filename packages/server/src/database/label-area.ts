import { isLabelCode, type TenantId } from '@opengewerk/haustechnik-domain'
import type { Database, TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

/** A label that takes a report without an account: its operator and its area, and nothing else. */
export interface OpenLabel {
  readonly tenantId: TenantId
  readonly areaId: string
}

/** What the change log names as the reason of a report without an account. */
export const outsideReason = 'report.outside'

/**
 * Whether a code opens the page of a label (#332): the operator and the area
 * of a valid label at a room or an asset, whose operator switched the page
 * on; nothing for every other code, the same for each reason. Asked outside
 * any operator, through the one function that looks past them for this,
 * `label_open_to_reports`. Neither answer leaves the server: the page is told
 * the name of a room or that the label is closed.
 */
export async function openLabel(database: Database, code: string): Promise<OpenLabel | null> {
  if (!isLabelCode(code)) {
    return null
  }

  const rows = await database.forInstance(
    async (tx) =>
      (
        await tx.execute<{ tenant_id: string; area_id: string }>(
          sql`select tenant_id, area_id from label_open_to_reports(${code})`,
        )
      ).rows,
    undefined,
    outsideReason,
  )
  const [found] = rows

  return found === undefined
    ? null
    : { tenantId: found.tenant_id as TenantId, areaId: found.area_id }
}

/**
 * The operator and the area of an address for an answer not yet confirmed,
 * by the hash of the secret of its link (S12 of the review of phase 2);
 * nothing for every other hash. Asked outside any operator, through the one
 * function that looks past them for this, `contact_to_confirm`.
 */
export async function contactToConfirm(
  database: Database,
  sha256: string,
): Promise<OpenLabel | null> {
  const rows = await database.forInstance(
    async (tx) =>
      (
        await tx.execute<{ tenant_id: string; area_id: string }>(
          sql`select tenant_id, area_id from contact_to_confirm(${sha256})`,
        )
      ).rows,
    undefined,
    outsideReason,
  )
  const [found] = rows

  return found === undefined
    ? null
    : { tenantId: found.tenant_id as TenantId, areaId: found.area_id }
}

/**
 * The work for a report without an account, inside the operator of its label
 * and in the area of that label alone (#332, ADR 0003).
 *
 * A transaction without a person sees no row with a place: the functions
 * behind the policy read the areas of the person, and there is none. This
 * one names the area of the label, which `session_areas()` takes only while
 * no person is set, so the policies stay as they are and the report sees the
 * one area its label lies in, and nothing beside it. It names nobody: the log
 * says the reason and no person. A test of this package holds the list of the
 * files that may name the setting.
 */
export function inLabelArea<Result>(
  database: Database,
  label: OpenLabel,
  work: (tx: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  return database.forTenant({ tenantId: label.tenantId, reason: outsideReason }, async (tx) => {
    // Local to the transaction, like the tenant the foundation sets.
    await tx.execute(sql`select set_config('app.label_area', ${label.areaId}, true)`)

    return work(tx)
  })
}
