import { addDays, type TenantId } from '@opengewerk/haustechnik-domain'
import type { Pool } from 'pg'

import { dayInGermany } from '../today.js'

/**
 * The auditor from outside of the sample operator (#339), as the board of
 * "Zugänge" with an auditor draws it: an access up to a last day six weeks ahead,
 * limited to the school centre and the kinds of the assets there, and the
 * reads of a morning in the log the Leitung sees. Straight into the tables:
 * a read is written by a request of the auditor, and the preview has none.
 * A viewer who is an auditor (`PREVIEW_ROLE=auditor`) gets the same last day
 * and limits, so that the register shows what an auditor sees.
 */
export const sampleAuditorId = 'preview-seidel'

export async function giveSampleAuditor(
  admin: Pool,
  tenantId: TenantId,
  viewerId: string | null,
): Promise<void> {
  const today = dayInGermany()
  const auditors = viewerId === null ? [sampleAuditorId] : [sampleAuditorId, viewerId]

  await admin.query(
    'update memberships set last_day = $1 where tenant_id = $2 and user_id = any($3)',
    [addDays(today, 44), tenantId, auditors],
  )

  const { rows: school } = await admin.query<{ id: string }>(
    "select id from properties where tenant_id = $1 and name like 'Schulzentrum%' order by name limit 1",
    [tenantId],
  )
  const property = school[0]?.id

  if (property === undefined) {
    return
  }

  await admin.query(
    `insert into member_limit_properties (tenant_id, user_id, property_id)
     select $1, unnest($2::text[]), $3`,
    [tenantId, auditors, property],
  )

  const { rows: kinds } = await admin.query<{ kind: string }>(
    `select distinct a.kind from assets a join duties d on d.asset_id = a.id
      where a.tenant_id = $1 and a.property_id = $2 order by a.kind limit 2`,
    [tenantId, property],
  )

  for (const { kind } of kinds) {
    await admin.query(
      `insert into member_limit_asset_kinds (tenant_id, user_id, asset_kind)
       select $1, unnest($2::text[]), $3`,
      [tenantId, auditors, kind],
    )
  }

  const { rows: duty } = await admin.query<{ id: string }>(
    `select d.id from duties d join assets a on a.id = d.asset_id
      where d.tenant_id = $1 and d.property_id = $2 and a.kind = any($3) order by d.id limit 1`,
    [tenantId, property, kinds.map((row) => row.kind)],
  )
  const { rows: proof } = await admin.query<{ id: string }>(
    `select e.id from evidence e join duties d on d.id = e.duty_id join assets a on a.id = d.asset_id
      where e.tenant_id = $1 and e.property_id = $2 and a.kind = any($3) order by e.number desc limit 1`,
    [tenantId, property, kinds.map((row) => row.kind)],
  )
  const reads = [
    { minutes: 11, route: '/duties/register', path: '/duties/register', query: null },
    ...(duty[0] === undefined
      ? []
      : [{ minutes: 12, route: '/duties/:id', path: `/duties/${duty[0].id}`, query: null }]),
    ...(proof[0] === undefined
      ? []
      : [{ minutes: 13, route: '/evidence/:id', path: `/evidence/${proof[0].id}`, query: null }]),
    {
      minutes: 14,
      route: '/duties/evidence-register/pdf',
      path: '/duties/evidence-register/pdf',
      query: `propertyId=${property}&attach=1`,
    },
  ]

  for (const read of reads) {
    await admin.query(
      `insert into auditor_reads (tenant_id, user_id, read_at, route, path, query)
       values ($1, $2, ($3::date + time '09:00' + make_interval(mins => $4)) at time zone 'Europe/Berlin', $5, $6, $7)`,
      [tenantId, sampleAuditorId, today, read.minutes, read.route, read.path, read.query],
    )
  }
}
