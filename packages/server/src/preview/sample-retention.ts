import type { TenantId } from '@opengewerk/haustechnik-domain'
import type { Pool } from 'pg'

/**
 * What hangs on no evidence and whose retention has ended (#412), so that
 * "Aufbewahrung" proposes something and "Fristen" names it: an inspection of
 * the elevator closed as not performed in 2018, and a defect at it remedied
 * and checked again in 2019, which leaves the elevator in order. Straight into the tables as their owner, which alone may give a
 * row the day it ended from before; the application writes that day itself.
 */
export async function giveSampleRetention(admin: Pool, tenantId: TenantId): Promise<void> {
  await admin.query(
    `insert into activities (tenant_id, property_id, area_id, asset_id, kind, title, status,
                             closing_reason, ended_on)
     select tenant_id, property_id, area_id, id, 'inspection', 'Sichtprüfung der Kabinenbeleuchtung',
            'not_performed', 'Der Aufzug war stillgelegt.', '2018-06-12'
       from assets where tenant_id = $1 and name = 'Aufzug Haus A'`,
    [tenantId],
  )
  await admin.query(
    `insert into defects (tenant_id, property_id, area_id, asset_id, description, found_on, status,
                          remedied_on, checked_on)
     select tenant_id, property_id, area_id, id, 'Kabinenlicht flackert', '2019-10-02', 'verified',
            '2019-11-04', '2019-11-20'
       from assets where tenant_id = $1 and name = 'Aufzug Haus A'`,
    [tenantId],
  )
}
