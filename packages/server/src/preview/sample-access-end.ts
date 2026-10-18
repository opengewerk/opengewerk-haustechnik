import { addDays, type TenantId } from '@opengewerk/haustechnik-domain'
import type { Pool } from 'pg'

import { dayInGermany } from '../today.js'

/**
 * The end of an access in the sample operator (#356), as the board of
 * "Zugänge" with a last day draws it: Lena Vogt works up to a last day about
 * ten weeks ahead, so that "Zugänge" says until when, "Fristen" has the end
 * and the day her data goes, and her dialog says what still hangs on her.
 * Straight into the table, as the auditor's last day.
 */
export async function giveSampleLastDay(admin: Pool, tenantId: TenantId): Promise<void> {
  await admin.query(
    "update memberships set last_day = $1 where tenant_id = $2 and user_id = 'preview-vogt'",
    [addDays(dayInGermany(), 73), tenantId],
  )
}
